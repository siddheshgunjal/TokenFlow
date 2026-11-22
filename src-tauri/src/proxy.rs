use std::{
    net::SocketAddr,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};

use axum::{
    body::Body,
    extract::State,
    http::{
        header::{HeaderName, HeaderValue},
        HeaderMap, Request, StatusCode,
    },
    response::{IntoResponse, Response},
    routing::{any, get},
    Json, Router,
};
use futures_util::{stream, StreamExt};
use serde_json::json;
use tokio::net::TcpListener;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

use crate::{
    models::{OllamaLogInsert, ProxyStatus, TimingSource},
    state::{AppState, ProxyActivityGuard},
};

const MAX_BODY_BYTES: usize = 64 * 1024 * 1024;
const MAX_INSPECT_BUFFER_BYTES: usize = 16 * 1024 * 1024;

static REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct ProxyContext {
    state: AppState,
    client: reqwest::Client,
    upstream_url: String,
}

/// Spawns the loopback proxy. A bind failure is reported through `proxy-status`
/// and through the dashboard rather than crashing the desktop app.
pub fn spawn(state: AppState) {
    tauri::async_runtime::spawn(async move {
        if let Err(err) = run(state).await {
            tracing::error!(%err, "Ollama proxy stopped unexpectedly");
        }
    });
}

async fn run(state: AppState) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let settings = state.settings();
    let bind_address = SocketAddr::from(([127, 0, 0, 1], settings.proxy_port));

    // `no_proxy` is important: a developer's HTTP_PROXY must never route local
    // Ollama traffic through a remote proxy.
    let client = reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(5))
        // Ollama traffic to one loopback host needs a couple of warm
        // connections; cap the idle pool so a long-lived proxy cannot
        // accumulate sockets across client churn.
        .pool_max_idle_per_host(2)
        .pool_idle_timeout(Duration::from_secs(30))
        .user_agent(concat!("TokenFlow/", env!("CARGO_PKG_VERSION")))
        .build()?;

    let app = Router::new()
        .route("/health", get(health))
        .fallback(any(proxy_handler))
        .layer(cors_layer())
        .with_state(ProxyContext {
            state: state.clone(),
            client,
            upstream_url: settings.upstream_url.clone(),
        });

    match TcpListener::bind(bind_address).await {
        Ok(listener) => {
            state.update_proxy_status(ProxyStatus {
                running: true,
                bind_address: bind_address.to_string(),
                upstream_url: settings.upstream_url.clone(),
                error: None,
            });
            tracing::info!(
                %bind_address,
                upstream = %settings.upstream_url,
                "Ollama proxy listening"
            );
            axum::serve(listener, app).await?;
        }
        Err(err) => {
            let message = format!("Could not bind {bind_address}: {err}");
            state.update_proxy_status(ProxyStatus {
                running: false,
                bind_address: bind_address.to_string(),
                upstream_url: settings.upstream_url,
                error: Some(message.clone()),
            });
            tracing::error!(%message, "Ollama proxy could not start");
        }
    }

    Ok(())
}

async fn health(State(ctx): State<ProxyContext>) -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(json!({
            "ok": true,
            "service": "tokenflow-proxy",
            "version": env!("CARGO_PKG_VERSION"),
            "upstream": ctx.upstream_url,
        })),
    )
}

async fn proxy_handler(State(ctx): State<ProxyContext>, request: Request<Body>) -> Response {
    // Held for the request and its streamed response; the idle re-exec checks
    // this counter before replacing the process.
    let activity = ctx.state.proxy_activity.begin();
    let started = Instant::now();
    let method = request.method().clone();
    let endpoint = request.uri().path().to_string();
    let path_and_query = request
        .uri()
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or("/")
        .to_string();
    let request_id = new_request_id();

    let target = match build_target(&ctx.upstream_url, &path_and_query) {
        Ok(target) => target,
        Err(message) => return error_response(StatusCode::BAD_GATEWAY, message),
    };

    let headers = filtered_request_headers(request.headers());
    let (_, body) = request.into_parts();

    let body_bytes = match axum::body::to_bytes(body, MAX_BODY_BYTES).await {
        Ok(bytes) => bytes,
        Err(_) => {
            return error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Request body exceeded the 64 MiB proxy limit or could not be read.",
            )
        }
    };

    let mut upstream_request = ctx.client.request(method, target).headers(headers);
    if !body_bytes.is_empty() {
        upstream_request = upstream_request.body(body_bytes);
    }

    // A second clock for stream-derived `/v1` estimates. `started` remains the
    // request-wide duration; this one anchors the first-content marker.
    let upstream_started = Instant::now();

    let upstream_response = match upstream_request.send().await {
        Ok(response) => response,
        Err(err) => {
            tracing::warn!(%err, endpoint = %endpoint, "Ollama upstream request failed");
            return error_response(
                StatusCode::BAD_GATEWAY,
                format!(
                    "Ollama is not reachable at {}. Is Ollama running?",
                    ctx.upstream_url
                ),
            );
        }
    };

    let status = upstream_response.status();
    let response_headers = filtered_response_headers(upstream_response.headers());
    let inspector = StreamInspector::new(
        ctx.state,
        request_id,
        endpoint,
        status.as_u16(),
        started,
        upstream_started,
        activity,
    );

    let body_stream = upstream_response.bytes_stream();
    let inspected_stream = stream::unfold(
        (body_stream, inspector),
        |(mut stream, mut inspector)| async move {
            match stream.next().await {
                Some(Ok(bytes)) => {
                    inspector.push(&bytes);
                    Some((Ok::<_, std::io::Error>(bytes), (stream, inspector)))
                }
                Some(Err(err)) => {
                    inspector.abort(&err.to_string());
                    Some((Err(std::io::Error::other(err)), (stream, inspector)))
                }
                None => {
                    inspector.finish();
                    None
                }
            }
        },
    );

    let mut response = Response::new(Body::from_stream(inspected_stream));
    *response.status_mut() = status;
    *response.headers_mut() = response_headers;
    response
}

/// Inspects NDJSON (native Ollama) and SSE (OpenAI-compatible) responses without
/// altering the bytes delivered to the client.
struct StreamInspector {
    state: AppState,
    request_id: String,
    endpoint: String,
    status: u16,
    started: Instant,
    /// Anchor for stream-derived `/v1` estimates (first-content timing).
    upstream_started: Instant,
    buffer: Vec<u8>,
    model: Option<String>,
    recorded: bool,
    /// First content chunk after `upstream_started`, if any.
    first_content_at: Option<Instant>,
    /// Most recent content chunk, if any.
    last_content_at: Option<Instant>,
    /// Number of content chunks observed (for the `/v1` estimate guard).
    content_chunks: u32,
    /// Native timings reported by Ollama, if present. Always preferred over
    /// stream-derived estimates.
    native_timings: Option<UpstreamTimings>,
    /// Released when the response stream ends or the client disconnects.
    _activity: ProxyActivityGuard,
}

/// Upstream-reported inference durations in nanoseconds, tagged with their
/// source so native and estimated values are never blended.
#[derive(Debug, Clone, Copy)]
struct UpstreamTimings {
    prompt_eval_ns: Option<i64>,
    eval_ns: Option<i64>,
    source: TimingSource,
}

impl StreamInspector {
    fn new(
        state: AppState,
        request_id: String,
        endpoint: String,
        status: u16,
        started: Instant,
        upstream_started: Instant,
        activity: ProxyActivityGuard,
    ) -> Self {
        Self {
            state,
            request_id,
            endpoint,
            status,
            started,
            upstream_started,
            buffer: Vec::with_capacity(8 * 1024),
            model: None,
            recorded: false,
            first_content_at: None,
            last_content_at: None,
            content_chunks: 0,
            native_timings: None,
            _activity: activity,
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        if self.recorded || self.status >= 400 {
            return;
        }

        self.buffer.extend_from_slice(bytes);
        self.drain_complete_lines();

        if self.buffer.len() > MAX_INSPECT_BUFFER_BYTES {
            tracing::warn!(
                endpoint = %self.endpoint,
                "response inspection buffer exceeded 16 MiB; skipping metrics for this request"
            );
            self.buffer.clear();
            self.recorded = true;
        }
    }

    fn drain_complete_lines(&mut self) {
        while let Some(position) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = self.buffer.drain(..=position).collect();
            self.inspect_line(&line);

            if self.recorded {
                self.buffer.clear();
                break;
            }
        }
    }

    /// Non-streaming JSON responses generally have no trailing newline, so the
    /// tail must be inspected when the upstream stream ends.
    fn finish(&mut self) {
        if self.recorded || self.buffer.is_empty() {
            return;
        }

        let tail = std::mem::take(&mut self.buffer);
        self.inspect_line(&tail);
    }

    fn abort(&mut self, error: &str) {
        if !self.recorded {
            tracing::warn!(
                endpoint = %self.endpoint,
                %error,
                "Ollama stream ended before usage was reported"
            );
        }
        self.buffer.clear();
        self.recorded = true;
    }

    fn inspect_line(&mut self, raw: &[u8]) {
        let Ok(line) = std::str::from_utf8(raw) else {
            return;
        };

        let line = line.trim();
        let line = line.strip_prefix("data:").unwrap_or(line).trim();
        if line.is_empty() || line == "[DONE]" {
            return;
        }

        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            return;
        };

        if let Some(model) = value.get("model").and_then(|value| value.as_str()) {
            if !model.is_empty() {
                self.model = Some(model.to_string());
            }
        }

        // Stream-derived `/v1` estimates: track the first/last content chunk
        // so a prefill (TTFT) and generation (first-to-last) span can be
        // estimated. Only `/v1/*` streaming endpoints are estimated; native
        // `/api/*` paths always use the reported durations instead.
        if self.endpoint.starts_with("/v1/") && has_stream_content(&value) {
            let now = Instant::now();
            if self.first_content_at.is_none() {
                self.first_content_at = Some(now);
            }
            self.last_content_at = Some(now);
            self.content_chunks += 1;
        }

        // Native Ollama reports prompt/generation durations on the final
        // object. Capture them before recording; they always win over any
        // stream-derived estimate.
        let prompt_ns = json_ns(&value, "prompt_eval_duration");
        let eval_ns = json_ns(&value, "eval_duration");
        if prompt_ns.is_some() || eval_ns.is_some() {
            self.native_timings = Some(UpstreamTimings {
                prompt_eval_ns: prompt_ns,
                eval_ns,
                source: TimingSource::Native,
            });
        }

        // OpenAI-compatible responses (including final SSE usage chunks).
        if let Some(usage) = value.get("usage") {
            let prompt = usage
                .get("prompt_tokens")
                .and_then(|value| value.as_i64())
                .unwrap_or(0);
            let completion = usage
                .get("completion_tokens")
                .and_then(|value| value.as_i64())
                .unwrap_or(0);
            let cached = usage
                .get("prompt_tokens_details")
                .and_then(|details| details.get("cached_tokens"))
                .and_then(|value| value.as_i64())
                .unwrap_or(0);
            if prompt > 0 || completion > 0 {
                self.record(prompt, completion, cached);
            }
        }

        // Native Ollama `/api/generate` and `/api/chat` final object.
        if value
            .get("done")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
        {
            let prompt = value
                .get("prompt_eval_count")
                .and_then(|value| value.as_i64())
                .unwrap_or(0);
            let completion = value
                .get("eval_count")
                .and_then(|value| value.as_i64())
                .unwrap_or(0);
            let cached = value
                .get("prompt_eval_cached_count")
                .and_then(|value| value.as_i64())
                .unwrap_or(0);
            self.record(prompt, completion, cached);
        }
    }

    fn record(&mut self, input_tokens: i64, output_tokens: i64, cached_input_tokens: i64) {
        if self.recorded {
            return;
        }
        self.recorded = true;

        let model = self.model.clone().unwrap_or_else(|| "unknown".to_string());
        let input_tokens = input_tokens.max(0);
        let output_tokens = output_tokens.max(0);
        let cached_input_tokens = cached_input_tokens.max(0).min(input_tokens);
        let cache_hit_rate = if input_tokens > 0 {
            cached_input_tokens as f64 / input_tokens as f64
        } else {
            0.0
        };
        let created_at = chrono::Utc::now().timestamp();
        let duration_ms = self.started.elapsed().as_millis().min(i64::MAX as u128) as i64;
        let request_id = self.request_id.clone();
        let endpoint = self.endpoint.clone();
        let state = self.state.clone();

        // Native timings always win. Fall back to a stream-derived estimate for
        // `/v1` streaming requests; native `/api/*` paths are never estimated.
        let (prompt_ns, eval_ns, timing_source) = match self.native_timings {
            Some(native) => (native.prompt_eval_ns, native.eval_ns, Some(native.source)),
            None if self.endpoint.starts_with("/v1/") => estimate_timings(
                self.upstream_started,
                self.first_content_at,
                self.last_content_at,
                Instant::now(),
                self.content_chunks,
                input_tokens,
                output_tokens,
            ),
            None => (None, None, None),
        };

        // SQLite is blocking; keep it off the stream's async worker thread.
        tokio::task::spawn_blocking(move || {
            let insert = OllamaLogInsert {
                request_id,
                model: model.clone(),
                endpoint: endpoint.clone(),
                prompt_tokens: input_tokens,
                completion_tokens: output_tokens,
                cached_prompt_tokens: cached_input_tokens,
                created_at,
                duration_ms: Some(duration_ms),
                prompt_eval_duration_ns: prompt_ns,
                eval_duration_ns: eval_ns,
                timing_source,
            };

            match state.db.insert_ollama_log(&insert) {
                Ok(true) => {
                    tracing::info!(
                        model = %model,
                        input_tokens,
                        output_tokens,
                        cached_input_tokens,
                        cache_hit_rate,
                        endpoint = %endpoint,
                        timing_source = timing_source.map(|source| source.as_str()).unwrap_or("none"),
                        "recorded Ollama usage"
                    );
                    // The snapshot service coalesces this with other dirty
                    // signals into a single rebuild; no direct DB read here.
                    state.snapshots.mark_dirty();
                }
                Ok(false) => {
                    tracing::debug!(endpoint = %endpoint, "duplicate usage event ignored");
                }
                Err(err) => {
                    tracing::warn!(
                        %err,
                        endpoint = %endpoint,
                        "could not persist Ollama usage"
                    );
                }
            }
        });
    }
}

/// Reads a nanosecond duration from a JSON object. Accepts unsigned, signed,
/// and floating point values (some clients send floats) and rejects zero or
/// negative durations so they can never produce a rate.
fn json_ns(value: &serde_json::Value, key: &str) -> Option<i64> {
    value
        .get(key)
        .and_then(|value| {
            value
                .as_u64()
                .map(|n| n.min(i64::MAX as u64) as i64)
                .or_else(|| value.as_i64())
                .or_else(|| value.as_f64().map(|n| n.round() as i64))
        })
        .filter(|n| *n > 0)
}

/// Returns `true` when a `/v1` stream chunk carries real content: a non-empty
/// `delta.content`/`delta.reasoning_content`, a non-empty `choices[].text`, or
/// a non-empty `tool_calls` array. Empty deltas are skipped so the
/// first-content marker reflects genuine generation.
fn has_stream_content(value: &serde_json::Value) -> bool {
    let Some(choices) = value.get("choices").and_then(|value| value.as_array()) else {
        return false;
    };
    choices.iter().any(|choice| {
        if let Some(delta) = choice.get("delta") {
            for key in ["content", "reasoning_content"] {
                if delta
                    .get(key)
                    .and_then(|value| value.as_str())
                    .is_some_and(|text| !text.is_empty())
                {
                    return true;
                }
            }
            if delta
                .get("tool_calls")
                .and_then(|value| value.as_array())
                .is_some_and(|calls| !calls.is_empty())
            {
                return true;
            }
        }
        choice
            .get("text")
            .and_then(|value| value.as_str())
            .is_some_and(|text| !text.is_empty())
    })
}

/// Derives approximate `/v1` durations from stream timing. `ttft` (time to
/// first content) is a lower bound for prefill because it includes queue and
/// load time; the generation span is first-to-last content chunk and includes
/// network jitter. Both are stored as `estimated`, never blended with native
/// values.
///
/// Guards keep single-token responses from producing absurd rates: prefill
/// needs a TTFT of at least 5 ms, generation needs at least two content
/// chunks and a 5 ms span.
fn estimate_timings(
    upstream_started: Instant,
    first_content_at: Option<Instant>,
    last_content_at: Option<Instant>,
    record_at: Instant,
    content_chunks: u32,
    prompt_tokens: i64,
    completion_tokens: i64,
) -> (Option<i64>, Option<i64>, Option<TimingSource>) {
    let Some(first) = first_content_at else {
        return (None, None, None);
    };

    let ttft = first.saturating_duration_since(upstream_started);
    let span = last_content_at
        .and_then(|last| last.checked_duration_since(first))
        .unwrap_or_else(|| record_at.saturating_duration_since(first));

    let prompt_ns = (prompt_tokens > 0 && ttft >= Duration::from_millis(5))
        .then(|| ttft.as_nanos().min(i64::MAX as u128) as i64);

    // Require at least two content chunks and a 5 ms span so single-token
    // responses cannot produce absurd rates.
    let eval_ns =
        (completion_tokens > 0 && content_chunks >= 2 && span >= Duration::from_millis(5))
            .then(|| span.as_nanos().min(i64::MAX as u128) as i64);

    if prompt_ns.is_none() && eval_ns.is_none() {
        (None, None, None)
    } else {
        (prompt_ns, eval_ns, Some(TimingSource::Estimated))
    }
}

fn build_target(upstream_url: &str, path_and_query: &str) -> Result<reqwest::Url, String> {
    let target = format!("{}{}", upstream_url.trim_end_matches('/'), path_and_query);
    reqwest::Url::parse(&target).map_err(|err| format!("Invalid upstream URL: {err}"))
}

fn filtered_request_headers(headers: &HeaderMap) -> HeaderMap {
    headers
        .iter()
        .filter(|(name, _)| {
            !is_hop_by_hop(name)
                && !matches!(name.as_str(), "host" | "content-length" | "accept-encoding")
        })
        .fold(HeaderMap::new(), |mut out, (name, value)| {
            out.append((*name).clone(), (*value).clone());
            out
        })
}

fn filtered_response_headers(headers: &HeaderMap) -> HeaderMap {
    headers
        .iter()
        .filter(|(name, _)| !is_hop_by_hop(name) && name.as_str() != "content-length")
        .fold(HeaderMap::new(), |mut out, (name, value)| {
            out.append((*name).clone(), (*value).clone());
            out
        })
}

fn is_hop_by_hop(name: &HeaderName) -> bool {
    matches!(
        name.as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

/// CORS is limited to loopback and Tauri origins. Native HTTP clients do not
/// send an Origin header and are unaffected. Browser-based clients served from
/// localhost (Open WebUI, for example) can use the proxy without exposing it to
/// arbitrary websites.
fn cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _request_parts| {
            is_allowed_origin(origin)
        }))
        .allow_methods(Any)
        .allow_headers(Any)
}

fn is_allowed_origin(origin: &HeaderValue) -> bool {
    let Ok(origin) = origin.to_str() else {
        return false;
    };

    matches!(
        origin,
        "tauri://localhost"
            | "http://tauri.localhost"
            | "https://tauri.localhost"
            | "http://localhost"
            | "http://127.0.0.1"
            | "http://[::1]"
    ) || origin.starts_with("http://localhost:")
        || origin.starts_with("https://localhost:")
        || origin.starts_with("http://127.0.0.1:")
        || origin.starts_with("https://127.0.0.1:")
        || origin.starts_with("http://[::1]:")
        || origin.starts_with("https://[::1]:")
}

fn new_request_id() -> String {
    let sequence = REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!(
        "{}-{}-{sequence}",
        chrono::Utc::now().timestamp_millis(),
        std::process::id()
    )
}

fn error_response(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": message.into() }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::{estimate_timings, has_stream_content, json_ns, TimingSource};
    use serde_json::json;
    use std::time::{Duration, Instant};

    #[test]
    fn json_ns_reads_ints_floats_and_rejects_nonpositive() {
        assert_eq!(
            json_ns(&json!({"eval_duration": 1_500_000_000}), "eval_duration"),
            Some(1_500_000_000)
        );
        assert_eq!(
            json_ns(&json!({"eval_duration": 1500.4}), "eval_duration"),
            Some(1500)
        );
        assert_eq!(json_ns(&json!({"eval_duration": 0}), "eval_duration"), None);
        assert_eq!(
            json_ns(&json!({"eval_duration": -5}), "eval_duration"),
            None
        );
        assert_eq!(json_ns(&json!({"other": 100}), "eval_duration"), None);
    }

    #[test]
    fn has_stream_content_detects_all_content_shapes() {
        let parse = |raw: &str| serde_json::from_str::<serde_json::Value>(raw).expect("valid json");

        // delta.content
        assert!(has_stream_content(&parse(
            r#"{"choices": [{"delta": {"content": "hi"}}]}"#
        )));
        // delta.reasoning_content
        assert!(has_stream_content(&parse(
            r#"{"choices": [{"delta": {"reasoning_content": "think"}}]}"#
        )));
        // non-empty tool_calls
        assert!(has_stream_content(&parse(
            r#"{"choices": [{"delta": {"tool_calls": [{"id": "1"}]}}]}"#
        )));
        // choices[].text (legacy)
        assert!(has_stream_content(&parse(
            r#"{"choices": [{"text": "hello"}]}"#
        )));

        // Empty deltas and no choices are not content.
        assert!(!has_stream_content(&parse(
            r#"{"choices": [{"delta": {"content": ""}}]}"#
        )));
        assert!(!has_stream_content(&parse(
            r#"{"choices": [{"delta": {}}]}"#
        )));
        assert!(!has_stream_content(&parse(r#"{"choices": []}"#)));
        assert!(!has_stream_content(&parse(
            r#"{"usage": {"prompt_tokens": 5}}"#
        )));
        assert!(!has_stream_content(&parse(r#"{"done": true}"#)));
    }

    #[test]
    fn estimate_timings_requires_content_and_enforces_guards() {
        let started = Instant::now();

        // No content at all -> nothing estimated.
        assert_eq!(
            estimate_timings(started, None, None, Instant::now(), 0, 100, 50),
            (None, None, None)
        );

        let first = started + Duration::from_millis(20);
        let last = first + Duration::from_millis(30);

        // Content present: both prefill (ttft) and generation (span) derived.
        let (prompt_ns, eval_ns, source) =
            estimate_timings(started, Some(first), Some(last), Instant::now(), 5, 100, 50);
        assert_eq!(source, Some(TimingSource::Estimated));
        assert!(prompt_ns.is_some());
        assert!(eval_ns.is_some());

        // Single content chunk -> generation is suppressed, prefill still set.
        let (prompt_ns, eval_ns, source) =
            estimate_timings(started, Some(first), Some(last), Instant::now(), 1, 100, 50);
        assert_eq!(source, Some(TimingSource::Estimated));
        assert!(prompt_ns.is_some());
        assert_eq!(eval_ns, None);

        // Sub-5 ms span -> generation suppressed.
        let tight_last = first + Duration::from_millis(2);
        let (_, eval_ns, _) = estimate_timings(
            started,
            Some(first),
            Some(tight_last),
            Instant::now(),
            5,
            100,
            50,
        );
        assert_eq!(eval_ns, None);

        // Sub-5 ms TTFT -> prefill suppressed.
        let early_first = started + Duration::from_millis(1);
        let (prompt_ns, _, _) = estimate_timings(
            started,
            Some(early_first),
            Some(early_first + Duration::from_millis(40)),
            Instant::now(),
            5,
            100,
            50,
        );
        assert_eq!(prompt_ns, None);

        // No prompt tokens -> no prefill even with content.
        let (prompt_ns, _, _) =
            estimate_timings(started, Some(first), Some(last), Instant::now(), 5, 0, 50);
        assert_eq!(prompt_ns, None);

        // No completion tokens -> no generation.
        let (_, eval_ns, _) =
            estimate_timings(started, Some(first), Some(last), Instant::now(), 5, 100, 0);
        assert_eq!(eval_ns, None);
    }
}
