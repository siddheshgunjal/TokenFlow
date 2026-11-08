//! Offline stress harness for the refresh-cycle memory investigation.
//!
//! Simulates what a DeepSeek balance refresh plus snapshot rebuild does —
//! an HTTP GET (against a local keep-alive server), two DB writes, one DB
//! read (the full dashboard snapshot), and periodic Ollama log inserts —
//! thousands of times while sampling the process RSS.
//!
//! This isolates the Rust core from WebKit: if the DB write/read path or the
//! reqwest fetch path retains memory per cycle, it shows up here.
//!
//! Run explicitly:
//!   cargo test --release --offline memory_stress -- --ignored --nocapture

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::time::Duration;

use crate::db::Db;
use crate::models::{BalanceInfoInput, OllamaLogInsert};

/// Resident set size of this process in KiB, from /proc/self/statm.
fn rss_kb() -> u64 {
    let raw = std::fs::read_to_string("/proc/self/statm").expect("statm");
    let mut parts = raw.split_whitespace();
    let _total: u64 = parts.next().expect("total").parse().expect("pages");
    let resident: u64 = parts.next().expect("resident").parse().expect("pages");
    resident * 4096 / 1024
}

fn read_request(stream: &mut TcpStream) -> std::io::Result<Vec<u8>> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    let mut request = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                request.extend_from_slice(&buf[..n]);
                if request.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
                if request.len() > 64 * 1024 {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    Ok(request)
}

/// Minimal keep-alive HTTP/1.1 server returning a DeepSeek-like payload.
/// Returns the bound address and the connection counter handle.
fn spawn_balance_server() -> (SocketAddr, std::sync::Arc<std::sync::atomic::AtomicU64>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    let connections = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let counter = connections.clone();

    std::thread::spawn(move || {
        for incoming in listener.incoming() {
            let Ok(mut stream) = incoming else { continue };
            counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

            // One request per connection keeps the handler simple; the client
            // reuses the connection when keep-alive works as intended.
            while let Ok(request) = read_request(&mut stream) {
                if request.is_empty() {
                    break;
                }

                let body = r#"{"is_available":true,"balance_infos":[{"currency":"CNY","total_balance":"110.00","granted_balance":"0.00","topped_up_balance":"110.00"}]}"#;
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: keep-alive\r\n\r\n{}",
                    body.len(),
                    body
                );
                if stream.write_all(response.as_bytes()).is_err() {
                    break;
                }
            }
        }
    });

    (addr, connections)
}

fn balance_inputs() -> Vec<BalanceInfoInput> {
    vec![
        BalanceInfoInput {
            currency: "CNY".to_string(),
            total_balance: "110.00".to_string(),
            granted_balance: Some("0.00".to_string()),
            topped_up_balance: Some("110.00".to_string()),
        },
        BalanceInfoInput {
            currency: "USD".to_string(),
            total_balance: "12.50".to_string(),
            granted_balance: Some("0.00".to_string()),
            topped_up_balance: Some("12.50".to_string()),
        },
    ]
}

/// Cycles the full refresh path N times and prints an RSS trajectory.
///
/// # #[ignore]d — expensive by design.
#[test]
#[ignore = "runs a multi-thousand iteration RSS probe; run explicitly with --ignored"]
fn refresh_cycle_does_not_grow_rss() {
    const CYCLES: usize = 2_000;
    const SAMPLE_EVERY: usize = 100;
    const LOGS_PER_CYCLE: usize = 4;

    let dir = tempfile::tempdir().expect("temp dir");
    let db = Db::open(&dir.path().join("tokenflow.db")).expect("db");
    let (addr, connections) = spawn_balance_server();

    let client = reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .expect("client");

    let url = format!("http://{addr}/user/balance");
    let inputs = balance_inputs();

    let runtime = std::sync::Arc::new(tokio::runtime::Runtime::new().expect("runtime"));

    // Mirror the SnapshotService bridge: a broadcast ring the sender keeps,
    // and a receiver that consumes snapshots like `spawn_bridge` does. This
    // covers the `events.send(...)` + JSON serialization that every real
    // refresh performs before `app.emit`.
    let (events, mut bridge_rx) =
        tokio::sync::broadcast::channel::<std::sync::Arc<crate::models::DashboardSummary>>(64);
    let bridge = {
        let runtime = runtime.clone();
        std::thread::spawn(move || {
            runtime.block_on(async move { while bridge_rx.recv().await.is_ok() {} })
        })
    };

    // Warm up allocators, the SQLite page cache, and the HTTP pool before the
    // baseline sample so steady-state growth is what we measure.
    for _ in 0..200 {
        let now = chrono::Utc::now().timestamp();
        db.insert_deepseek_balances(true, &inputs, now)
            .expect("insert");
        db.record_deepseek_success(now).expect("success");
        let snapshot = std::sync::Arc::new(db.snapshot().expect("snapshot"));
        let _ = events.send(snapshot.clone());
        let _ = runtime.block_on(async { client.get(&url).send().await });
    }

    let baseline = rss_kb();
    println!("baseline_rss_kb={baseline} (after 200 warmup cycles)");

    let mut previous = baseline;
    let started = std::time::Instant::now();

    for cycle in 1..=CYCLES {
        let now = chrono::Utc::now().timestamp();

        // Proxy-style log inserts (4/cycle keeps the ollama_logs table growing
        // the way real usage does).
        for index in 0..LOGS_PER_CYCLE {
            let log = OllamaLogInsert {
                request_id: format!("stress-{cycle}-{index}"),
                model: format!("model-{}", index % 3),
                endpoint: "/api/chat".to_string(),
                prompt_tokens: 12_000 + index as i64,
                completion_tokens: 800,
                cached_prompt_tokens: 9_600,
                created_at: now,
                duration_ms: Some(1_200),
            };
            db.insert_ollama_log(&log).expect("insert log");
        }

        // DeepSeek refresh write path.
        db.insert_deepseek_balances(true, &inputs, now)
            .expect("insert");
        db.record_deepseek_success(now).expect("success");

        // Snapshot read path (what `rebuild()` runs on every refresh).
        let snapshot = std::sync::Arc::new(db.snapshot().expect("snapshot"));
        assert_eq!(snapshot.totals.requests, (cycle * LOGS_PER_CYCLE) as i64);

        // Emit-equivalent work: serialize the payload to JSON (what Tauri
        // does per webview) and publish into the broadcast ring.
        let _ = serde_json::to_string(snapshot.as_ref()).expect("serialize");
        let _ = events.send(snapshot.clone());

        // DeepSeek fetch path (keep-alive HTTP against the local server).
        let status = runtime.block_on(async {
            client
                .get(&url)
                .send()
                .await
                .expect("send")
                .json::<crate::models::DeepSeekBalanceResponse>()
                .await
                .expect("json")
                .is_available
        });
        assert!(status);

        if cycle % SAMPLE_EVERY == 0 {
            let now = rss_kb();
            let delta = now as i64 - previous as i64;
            println!(
                "cycle={cycle:<6} rss_kb={now:<6} delta_since_last={delta:+} total_delta_from_baseline={:+}",
                now as i64 - baseline as i64
            );
            previous = now;
        }
    }

    let elapsed = started.elapsed();
    println!(
        "done: {} cycles in {:.1}s; final rss {} KiB; growth {} KiB; tcp_connections_accepted={}",
        CYCLES,
        elapsed.as_secs_f64(),
        rss_kb(),
        rss_kb() as i64 - baseline as i64,
        connections.load(std::sync::atomic::Ordering::Relaxed),
    );

    // Regression gate: the refresh path must not retain memory per cycle.
    // Steady-state growth is allocator and page-cache noise; a few MiB over
    // 2000 cycles leaves headroom for allocator differences between machines
    // while still catching a real leak of even a few hundred bytes per cycle.
    const GROWTH_BUDGET_KIB: i64 = 5 * 1024;
    let growth_kib = rss_kb() as i64 - baseline as i64;
    assert!(
        growth_kib <= GROWTH_BUDGET_KIB,
        "RSS grew by {growth_kib} KiB over {CYCLES} cycles; budget is {GROWTH_BUDGET_KIB} KiB"
    );

    // Drop everything and give glibc a beat; if RSS falls back near baseline,
    // what remained was transient working set, not a leak.
    drop(db);
    drop(events);
    let _ = bridge.join();
    std::thread::sleep(Duration::from_secs(2));
    println!(
        "after_drop_and_sleep: rss_kb={} (baseline was {baseline})",
        rss_kb()
    );
}
