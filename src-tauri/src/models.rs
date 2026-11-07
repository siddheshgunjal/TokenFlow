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
    /// Sum of newly evaluated prompt tokens (uncached) over the range.
    pub new_input_tokens: i64,
    /// Sum of generated tokens over the range.
    pub output_tokens: i64,
    /// `new_input_tokens + output_tokens`.
    pub total_tokens: i64,
    pub requests: i64,
    /// Largest prompt size observed today. Context is a gauge, so it is not
    /// summed across requests.
    pub today_peak_context_tokens: i64,
    /// Prompt size of the most recent request today.
    pub latest_context_tokens: i64,
    /// Cached prefix reported by the most recent request today.
    pub latest_cached_input_tokens: i64,
    pub today_new_input_tokens: i64,
    pub today_output_tokens: i64,
    pub today_tokens: i64,
    pub today_requests: i64,
    /// Token-weighted cache share: sum(cached) / sum(prompt), 0.0–1.0.
    pub cache_hit_rate: f64,
    pub today_cache_hit_rate: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    /// Sum of newly evaluated prompt tokens.
    pub new_input_tokens: i64,
    pub output_tokens: i64,
    /// Largest prompt size observed for this model in the range.
    pub context_tokens: i64,
    /// Cached prefix reported by the request that produced `context_tokens`.
    pub cached_input_tokens: i64,
    /// `new_input_tokens + output_tokens`.
    pub total_tokens: i64,
    pub requests: i64,
    /// Token-weighted cache share: sum(cached) / sum(prompt), 0.0–1.0.
    pub cache_hit_rate: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsage {
    /// Local calendar date in `YYYY-MM-DD` format.
    pub date: String,
    /// Sum of newly evaluated prompt tokens that day.
    pub new_input_tokens: i64,
    pub output_tokens: i64,
    /// Largest prompt size observed that day.
    pub context_tokens: i64,
    /// Cached prefix reported by the request that produced `context_tokens`.
    pub cached_input_tokens: i64,
    /// Sum of per-request prompt sizes. Used only as the cache-rate denominator.
    pub context_processed_tokens: i64,
    /// Sum of per-request cached prefixes. Used only as the cache-rate numerator.
    pub cached_processed_tokens: i64,
    /// `new_input_tokens + output_tokens`.
    pub total_tokens: i64,
    pub requests: i64,
    /// Token-weighted cache share for the day, 0.0–1.0.
    pub cache_hit_rate: f64,
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

/// Per-hour token bucket for a single day. The two denominator fields are
/// mandatory so the UI can compute a token-weighted cache rate for any scope;
/// averaging pre-computed hourly rates would be wrong.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HourlyUsage {
    /// Local hour, 0–23.
    pub hour: u32,
    pub new_input_tokens: i64,
    pub output_tokens: i64,
    /// new_input_tokens + output_tokens.
    pub total_tokens: i64,
    pub requests: i64,
    /// Sum of per-request prompt sizes in this hour. Cache-rate denominator.
    pub context_processed_tokens: i64,
    /// Sum of cached prefixes in this hour. Cache-rate numerator.
    pub cached_processed_tokens: i64,
    /// Token-weighted cache share: sum(cached) / sum(prompt), 0.0–1.0.
    pub cache_hit_rate: f64,
}

/// Per-model hourly buckets for one day. Always 24 entries, hour 0..=23.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelHourlyUsage {
    pub model: String,
    /// Always 24 entries, hour 0..=23.
    pub hours: Vec<HourlyUsage>,
}

/// Read-only, lazy payload for a single calendar day. This is not part of
/// [`DashboardSummary`]; it is built on demand by `get_day_usage_detail`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayUsageDetail {
    /// Local calendar date in `YYYY-MM-DD` format.
    pub date: String,
    /// Always 24 entries, hour 0..=23, all models combined.
    pub hours: Vec<HourlyUsage>,
    /// Models active that day, sorted by total tokens desc, then model asc.
    pub models: Vec<ModelHourlyUsage>,
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
    /// Monotonic; increments on every rebuild. The UI uses it to discard stale
    /// events that arrive out of order.
    pub revision: u64,
    pub generated_at: i64,
    /// Always [`SNAPSHOT_RANGE_DAYS`]. There is no per-window range parameter.
    pub range_days: u32,
    pub totals: Totals,
    pub streak_days: u32,
    pub models: Vec<ModelUsage>,
    /// Covers the last 365 local days so the heatmap is stable.
    pub daily: Vec<DailyUsage>,
    pub recent: Vec<OllamaLog>,
    pub latest_balance: Option<BalanceSnapshot>,
    pub proxy: ProxyStatus,
}

/// The dashboard range is owned by the core. Windows no longer pass their own
/// window size; they all render the same fixed-range snapshot.
pub const SNAPSHOT_RANGE_DAYS: u32 = 30;

/// Result of a unified manual refresh. The snapshot is always valid; a
/// DeepSeek failure is reported alongside it as a non-fatal error.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshResult {
    pub snapshot: DashboardSummary,
    /// Non-fatal DeepSeek failure. The snapshot is still valid.
    pub deepseek_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearDataResult {
    pub ollama_logs: usize,
    pub deepseek_balances: usize,
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
