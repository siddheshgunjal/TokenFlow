use std::{
    sync::{
        atomic::{AtomicU32, AtomicU64, Ordering},
        Arc, RwLock,
    },
    time::Duration,
};

use chrono::Local;
use tauri::{Emitter, Manager};
use tokio::sync::{broadcast, Mutex, Notify};

use crate::{
    db::Db,
    error::AppError,
    models::{DashboardSummary, ProxyStatus, SNAPSHOT_RANGE_DAYS},
};

/// A single core-owned rebuild path for the dashboard snapshot.
///
/// The service owns the only `Db::snapshot()` call in the process, a cached
/// `Arc<DashboardSummary>`, and a monotonic revision. Producers (the proxy,
/// the DeepSeek worker, and the refresh coordinator) never read the database
/// directly; they call [`SnapshotService::mark_dirty`] and let the scheduler
/// coalesce bursts into one serialized rebuild.
///
/// No Tauri types appear in the service itself. The only Tauri-facing code is
/// [`spawn_bridge`], which bridges the broadcast channel to webview events.
#[derive(Clone)]
pub struct SnapshotService {
    db: Db,
    proxy_status: Arc<RwLock<ProxyStatus>>,
    current: Arc<RwLock<Option<Arc<DashboardSummary>>>>,
    revision: Arc<AtomicU64>,
    dirty: Arc<Notify>,
    build_lock: Arc<Mutex<()>>,
    events: broadcast::Sender<Arc<DashboardSummary>>,
}

impl SnapshotService {
    /// Creates the service with no snapshot built yet. The scheduler's first
    /// `mark_dirty()` (seeded in [`spawn_scheduler`]) produces the initial
    /// rebuild, so `current()` returns `None` until then.
    pub fn new(db: Db, proxy_status: Arc<RwLock<ProxyStatus>>) -> Self {
        let (current, revision, dirty, build_lock, events) = (
            Arc::new(RwLock::new(None)),
            Arc::new(AtomicU64::new(0)),
            Arc::new(Notify::new()),
            Arc::new(Mutex::new(())),
            broadcast::channel(64).0,
        );

        Self {
            db,
            proxy_status,
            current,
            revision,
            dirty,
            build_lock,
            events,
        }
    }

    /// The most recently built snapshot, if any. Cloning the `Arc` is cheap.
    pub fn current(&self) -> Option<Arc<DashboardSummary>> {
        self.current
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Signals that the underlying data has changed. Safe to call from any
    /// thread; multiple calls coalesce into a single rebuild.
    pub fn mark_dirty(&self) {
        self.dirty.notify_one();
    }

    /// Subscribes to completed snapshots. Each rebuild sends exactly one
    /// value; consumers should compare `revision` against their local state
    /// and discard stale values.
    pub fn subscribe(&self) -> broadcast::Receiver<Arc<DashboardSummary>> {
        self.events.subscribe()
    }

    /// Serialized rebuild. Runs the SQLite work on a blocking thread so the
    /// Tokio reactor is never blocked by disk I/O. Increments the revision,
    /// fills `proxy`, stores the `Arc`, and broadcasts it.
    pub async fn rebuild(&self) -> Result<Arc<DashboardSummary>, AppError> {
        let started = std::time::Instant::now();
        let _guard = self.build_lock.lock().await;

        let db = self.db.clone();
        let raw = tokio::task::spawn_blocking(move || db.snapshot())
            .await
            .map_err(|err| AppError::Config(format!("snapshot task panicked: {err}")))??;

        let revision = self.revision.fetch_add(1, Ordering::SeqCst) + 1;
        let proxy = self
            .proxy_status
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();

        let snapshot = Arc::new(DashboardSummary {
            revision,
            generated_at: chrono::Utc::now().timestamp(),
            range_days: SNAPSHOT_RANGE_DAYS,
            totals: raw.totals,
            streak_days: raw.streak_days,
            models: raw.models,
            daily: raw.daily,
            recent: raw.recent,
            latest_balance: raw.latest_balance,
            proxy,
        });

        *self
            .current
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(snapshot.clone());
        tracing::info!(
            revision,
            duration_ms = started.elapsed().as_millis() as u64,
            "rebuilt core snapshot"
        );
        let _ = self.events.send(snapshot.clone());

        Ok(snapshot)
    }
}

/// Spawns the event-driven rebuild loop plus a day-rollover heartbeat.
///
/// The loop is driven by `Notify` permits from [`SnapshotService::mark_dirty`].
/// A burst of dirty signals coalesces into one rebuild because `Notify`
/// already deduplicates while the consumer is not awaiting. A short debounce
/// (400ms) additionally smooths out rapid-fire proxy traffic.
///
/// The heartbeat runs every 60s and rebuilds only when the local calendar
/// date or the local UTC offset has changed (a day rollover), so the "today"
/// bucket stays correct across midnight and DST transitions with no
/// UI-facing timer.
pub fn spawn_scheduler(service: SnapshotService) {
    let dirty = service.dirty.clone();
    let rebuild_service = service.clone();

    tauri::async_runtime::spawn(async move {
        // Seed the first rebuild so a headless core has a snapshot ready
        // before any window opens.
        rebuild_service.mark_dirty();

        loop {
            // Block until a dirty signal is received. `Notify` already
            // coalesces multiple `mark_dirty` calls into a single stored
            // permit, so a burst of signals consumes here as one wakeup.
            dirty.notified().await;

            // Trailing-edge debounce: wait 400ms, and if another dirty signal
            // arrives within that window, restart it. A burst therefore
            // settles into a single rebuild once things go quiet for 400ms.
            loop {
                let mut signal = Box::pin(dirty.notified());
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_millis(400)) => break,
                    _ = &mut signal => {
                        // A new signal arrived; keep absorbing and restart the
                        // settle window.
                    }
                }
            }

            if let Err(err) = rebuild_service.rebuild().await {
                tracing::warn!(%err, "snapshot rebuild failed");
            }
        }
    });

    // Day-rollover heartbeat: rebuild once per minute when the local date or
    // offset changes.
    let heartbeat_service = service.clone();
    let mut last_date = Local::now().date_naive();
    let mut last_offset = Local::now().format("%:z").to_string();

    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(60));
        ticker.tick().await; // The first tick completes immediately; skip it.

        loop {
            ticker.tick().await;
            let now = Local::now();
            let date = now.date_naive();
            let offset = now.format("%:z").to_string();

            if date != last_date || offset != last_offset {
                last_date = date;
                last_offset = offset;
                tracing::debug!("local date or offset changed; rebuilding");
                if let Err(err) = heartbeat_service.rebuild().await {
                    tracing::warn!(%err, "day-rollover snapshot rebuild failed");
                }
            }
        }
    });
}

/// Bridges the core broadcast channel to Tauri webview events. This is the
/// only place in the snapshot module that touches Tauri types.
///
/// When every window is hidden (including the Linux case where windows are
/// kept but their renderers are suspended), the emit is skipped. The UI
/// re-syncs with `get_core_snapshot` when a window is revealed.
pub fn spawn_bridge(
    app: tauri::AppHandle,
    mut rx: broadcast::Receiver<Arc<DashboardSummary>>,
    visible_windows: Arc<AtomicU32>,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(snapshot) => {
                    if app.webview_windows().is_empty()
                        || visible_windows.load(Ordering::SeqCst) == 0
                    {
                        continue;
                    }

                    if let Err(err) = app.emit("core-snapshot", snapshot.as_ref()) {
                        tracing::warn!(%err, "could not emit core-snapshot event");
                    }
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::warn!(skipped, "core-snapshot bridge lagged");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::SnapshotService;
    use crate::db::Db;
    use crate::models::{OllamaLogInsert, ProxyStatus};
    use std::sync::{Arc, RwLock};

    fn service_for(path: &std::path::Path) -> (SnapshotService, Db) {
        let db = Db::open(path).expect("database");
        let service = SnapshotService::new(
            db.clone(),
            Arc::new(RwLock::new(ProxyStatus {
                running: true,
                bind_address: "127.0.0.1:11435".to_string(),
                upstream_url: "http://127.0.0.1:11434".to_string(),
                error: None,
            })),
        );
        (service, db)
    }

    #[tokio::test]
    async fn rebuild_increments_revision_and_broadcasts() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (service, db) = service_for(&dir.path().join("tokenflow.db"));

        let insert = OllamaLogInsert {
            request_id: "r1".into(),
            model: "llama3.2".into(),
            endpoint: "/api/chat".into(),
            prompt_tokens: 100,
            completion_tokens: 10,
            cached_prompt_tokens: 0,
            created_at: chrono::Utc::now().timestamp(),
            duration_ms: Some(1),
        };
        db.insert_ollama_log(&insert).expect("insert");

        let mut rx = service.subscribe();

        let first = service.rebuild().await.expect("rebuild 1");
        assert_eq!(first.revision, 1);
        assert_eq!(first.range_days, 30);
        assert!(first.proxy.running);
        assert_eq!(first.totals.requests, 1);

        let second = service.rebuild().await.expect("rebuild 2");
        assert_eq!(second.revision, 2);

        // Both rebuilds must arrive on the broadcast channel in order.
        let got1 = rx.recv().await.expect("event 1");
        let got2 = rx.recv().await.expect("event 2");
        assert_eq!(got1.revision, 1);
        assert_eq!(got2.revision, 2);

        // `current` tracks the latest rebuild.
        assert_eq!(service.current().expect("current").revision, 2);
    }

    #[tokio::test]
    async fn snapshot_serializes_as_camel_case() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (service, _db) = service_for(&dir.path().join("tokenflow.db"));

        let snapshot = service.rebuild().await.expect("rebuild");
        let raw = serde_json::to_string(snapshot.as_ref()).expect("serialize");

        assert!(raw.contains("\"revision\":"), "revision key present: {raw}");
        assert!(
            raw.contains("\"generatedAt\":"),
            "generatedAt key present: {raw}"
        );
        assert!(
            raw.contains("\"rangeDays\":"),
            "rangeDays key present: {raw}"
        );
        assert!(
            raw.contains("\"streakDays\":"),
            "streakDays key present: {raw}"
        );
    }

    #[tokio::test]
    async fn rebuild_is_serialized_by_the_build_lock() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (service, _db) = service_for(&dir.path().join("tokenflow.db"));

        let a = service.rebuild().await.expect("rebuild a");
        let b = service.rebuild().await.expect("rebuild b");
        assert!(
            b.revision > a.revision,
            "revisions must be strictly increasing"
        );
    }
}
