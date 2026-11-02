use serde::{Deserialize, Serialize};

/// A usage row ready to be written to SQLite.
pub struct OllamaLogInsert {
    pub request_id: String,
    pub model: String,
    pub endpoint: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub cached_prompt_tokens: i64,
    pub created_at: i64,
    pub duration_ms: Option<i64>,
}

/// A DeepSeek balance record parsed from the API and ready to persist.
pub struct BalanceInfoInput {
    pub currency: String,
    pub total_balance: String,
    pub granted_balance: Option<String>,
    pub topped_up_balance: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cached_input_tokens: i64,
    pub total_tokens: i64,
    pub requests: i64,
    pub today_input_tokens: i64,
    pub today_output_tokens: i64,
    pub today_cached_input_tokens: i64,
    pub today_tokens: i64,
    pub today_requests: i64,
    /// Cached input divided by total input, in the 0.0–1.0 range.
    pub cache_hit_rate: f64,
    pub today_cache_hit_rate: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cached_input_tokens: i64,
    pub total_tokens: i64,
    pub requests: i64,
    pub cache_hit_rate: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsage {
    /// Local calendar date in `YYYY-MM-DD` format.
    pub date: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cached_input_tokens: i64,
    pub total_tokens: i64,
    pub requests: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaLog {
    pub id: i64,
    pub model: String,
    pub endpoint: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cached_input_tokens: i64,
    pub total_tokens: i64,
    pub cache_hit_rate: f64,
    pub created_at: i64,
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BalanceSnapshot {
    pub is_available: bool,
    pub total_balance: String,
    pub currency: String,
    pub granted_balance: Option<String>,
    pub topped_up_balance: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStatus {
    pub running: bool,
    pub bind_address: String,
    pub upstream_url: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepSeekSyncStatus {
    pub last_success_at: Option<i64>,
    pub last_error: Option<String>,
    pub last_error_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepSeekStatus {
    pub has_api_key: bool,
    pub key_source: Option<String>,
    pub last_success_at: Option<i64>,
    pub last_error: Option<String>,
    pub last_error_at: Option<i64>,
    pub balances: Vec<BalanceSnapshot>,
    pub poll_interval_secs: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummary {
    pub generated_at: i64,
    pub range_days: u32,
    pub totals: Totals,
    pub streak_days: u32,
    pub models: Vec<ModelUsage>,
    /// Always covers the last 365 local days so the heatmap is stable.
    pub daily: Vec<DailyUsage>,
    pub recent: Vec<OllamaLog>,
    pub latest_balance: Option<BalanceSnapshot>,
    pub proxy: ProxyStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearDataResult {
    pub ollama_logs: usize,
    pub deepseek_balances: usize,
}

/// Events are written to a Tokio broadcast channel and forwarded to the
/// frontend by [`crate::state::spawn_event_forwarder`]. The broadcast layer
/// keeps the proxy decoupled from Tauri window/event APIs.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MetricEvent {
    OllamaUsage {
        model: String,
        input_tokens: i64,
        output_tokens: i64,
        cached_input_tokens: i64,
        total_tokens: i64,
        timestamp: i64,
    },
    DeepSeekBalance {
        is_available: bool,
        balance: String,
        currency: String,
        timestamp: i64,
    },
}

/// Deserialized DeepSeek balance API response.
#[derive(Debug, Deserialize)]
pub struct DeepSeekBalanceResponse {
    pub is_available: bool,
    #[serde(default)]
    pub balance_infos: Vec<DeepSeekBalanceInfo>,
}

#[derive(Debug, Deserialize)]
pub struct DeepSeekBalanceInfo {
    pub currency: String,
    pub total_balance: String,
    #[serde(default)]
    pub granted_balance: Option<String>,
    #[serde(default)]
    pub topped_up_balance: Option<String>,
}
