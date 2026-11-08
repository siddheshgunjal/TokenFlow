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
    models::{OllamaLogInsert, ProxyStatus},
    state::AppState,
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
    let inspector = StreamInspector::new(ctx.state, request_id, endpoint, status.as_u16(), started);

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
    buffer: Vec<u8>,
    model: Option<String>,
    recorded: bool,
}

impl StreamInspector {
    fn new(
        state: AppState,
        request_id: String,
        endpoint: String,
        status: u16,
        started: Instant,
    ) -> Self {
        Self {
            state,
            request_id,
            endpoint,
            status,
            started,
            buffer: Vec::with_capacity(8 * 1024),
            model: None,
            recorded: false,
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
