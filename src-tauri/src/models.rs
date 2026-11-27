use serde::{Deserialize, Serialize};

/// Where a request's inference timings came from. Native values are reported
/// by Ollama; estimated values are derived from `/v1` stream timing and are
/// always approximate. They are stored and aggregated separately and never
/// blended into a single weighted average.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TimingSource {
    Native,
    Estimated,
}

impl TimingSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Native => "native",
            Self::Estimated => "estimated",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "native" => Some(Self::Native),
            "estimated" => Some(Self::Estimated),
            _ => None,
        }
    }
}

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
    /// Native or stream-derived prompt processing time, in nanoseconds.
    pub prompt_eval_duration_ns: Option<i64>,
    /// Native or stream-derived generation time, in nanoseconds.
    pub eval_duration_ns: Option<i64>,
    /// `None` when no timing data was captured for this request.
    pub timing_source: Option<TimingSource>,
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
    /// Time-weighted generation rate over native rows in the range.
    pub generation_tokens_per_sec: Option<f64>,
    /// Time-weighted prefill rate over native rows in the range.
    pub prefill_tokens_per_sec: Option<f64>,
    /// Time-weighted generation rate over estimated (`/v1`) rows in the range.
    pub estimated_generation_tokens_per_sec: Option<f64>,
    /// Time-weighted prefill rate over estimated (`/v1`) rows in the range.
    pub estimated_prefill_tokens_per_sec: Option<f64>,
    /// Native rows in the range with any duration.
    pub timed_requests: i64,
    /// Estimated rows in the range with any duration.
    pub estimated_requests: i64,
    /// Time-weighted generation rate over native rows today.
    pub today_generation_tokens_per_sec: Option<f64>,
    /// Time-weighted prefill rate over native rows today.
    pub today_prefill_tokens_per_sec: Option<f64>,
    /// Time-weighted generation rate over estimated (`/v1`) rows today.
    pub today_estimated_generation_tokens_per_sec: Option<f64>,
    /// Time-weighted prefill rate over estimated (`/v1`) rows today.
    pub today_estimated_prefill_tokens_per_sec: Option<f64>,
    /// Native rows today with any duration.
    pub today_timed_requests: i64,
    /// Estimated rows today with any duration.
    pub today_estimated_requests: i64,
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
    /// Per-request generation rate; `None` when no timing was captured.
    pub generation_tokens_per_sec: Option<f64>,
    /// Per-request prefill rate; `None` when no timing was captured.
    pub prefill_tokens_per_sec: Option<f64>,
    /// Prompt processing time, in milliseconds; `None` when not timed.
    pub prompt_eval_duration_ms: Option<i64>,
    /// Generation time, in milliseconds; `None` when not timed.
    pub eval_duration_ms: Option<i64>,
    /// `None` when no timing data was captured for this request.
    pub timing_source: Option<TimingSource>,
}

/// Read-only, lazy per-model performance payload. This is not part of
/// [`DashboardSummary`]; it is built on demand by `get_model_performance`.
/// It covers every distinct model ever recorded, not just the snapshot's
/// top-12.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPerformance {
    pub range_days: u32,
    pub models: Vec<ModelPerformanceEntry>,
}

/// Read-only, lazy overall-speed payload for an arbitrary time window.
/// Anchored to the dashboard's selected day and Day/Week/Month range, so the
/// Model speed card can show dynamic values instead of a fixed range. This is
/// not part of [`DashboardSummary`] and the widget never calls it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedSummary {
    pub since: i64,
    pub until: i64,
    /// Every request in the window, timed or not. Coverage denominator.
    pub requests: i64,
    /// Time-weighted generation rate over native rows.
    pub generation_tokens_per_sec: Option<f64>,
    /// Time-weighted prefill rate over native rows.
    pub prefill_tokens_per_sec: Option<f64>,
    /// Time-weighted generation rate over estimated (`/v1`) rows.
    pub estimated_generation_tokens_per_sec: Option<f64>,
    /// Time-weighted prefill rate over estimated (`/v1`) rows.
    pub estimated_prefill_tokens_per_sec: Option<f64>,
    /// Native rows in the window with any duration.
    pub timed_requests: i64,
    /// Estimated rows in the window with any duration.
    pub estimated_requests: i64,
}

/// One model's usage, cache, and time-weighted speed over the range. Models
/// with no usage in the range have `requests == 0`, zero tokens, `None`
/// speeds, and their all-time `last_seen_at`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPerformanceEntry {
    pub model: String,
    pub requests: i64,
    pub new_input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    /// Token-weighted cache share: sum(cached) / sum(prompt), 0.0–1.0.
    pub cache_hit_rate: f64,
    /// Time-weighted generation rate over native rows.
    pub generation_tokens_per_sec: Option<f64>,
    /// Time-weighted prefill rate over native rows.
    pub prefill_tokens_per_sec: Option<f64>,
    /// Time-weighted generation rate over estimated (`/v1`) rows.
    pub estimated_generation_tokens_per_sec: Option<f64>,
    /// Time-weighted prefill rate over estimated (`/v1`) rows.
    pub estimated_prefill_tokens_per_sec: Option<f64>,
    /// Native rows in the range with any duration.
    pub timed_requests: i64,
    /// Estimated rows in the range with any duration.
    pub estimated_requests: i64,
    /// All-time most recent request, so inactive models still show history.
    pub last_seen_at: i64,
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

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearDataResult {
    pub ollama_logs: usize,
    pub deepseek_balances: usize,
}

/// The period a request-history export covers. `Date`, `Week`, and `Month`
/// each require a `YYYY-MM-DD` local anchor; `Week` is Sunday-start and
/// `Month` is a calendar month. `All` is unbounded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RequestPeriod {
    All,
    Date,
    Week,
    Month,
}

/// Request-history export filters as sent from the UI. `models` and
/// `endpoints` are empty for "all"; an all-selected list is normalized to
/// empty by the caller before invoking the backend.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestFilters {
    pub period: RequestPeriod,
    /// `YYYY-MM-DD` local anchor. Required for Date/Week/Month; ignored for All.
    pub date: Option<String>,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub endpoints: Vec<String>,
}

/// Distinct models and endpoints available as export filter options.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestFilterOptions {
    pub models: Vec<String>,
    pub endpoints: Vec<String>,
}

/// Live match count for the export dialog, with the resolved half-open window.
/// `since` and `until` are `None` for All time so the bounds serialize safely
/// to JavaScript (avoiding `i64::MAX`, which exceeds `Number.MAX_SAFE_INTEGER`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestCount {
    pub count: i64,
    /// None for All time.
    pub since: Option<i64>,
    /// None for All time.
    pub until: Option<i64>,
}

/// Result of writing a request-history CSV export.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestExportResult {
    pub path: String,
    pub file_name: String,
    pub rows: i64,
    pub since: Option<i64>,
    pub until: Option<i64>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalogEntry {
    pub model: String,
    pub requests_total: i64,
    pub tokens_total: i64,
    pub requests_recent: i64,
    pub tokens_recent: i64,
    pub first_seen_at: i64,
    pub last_seen_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelMutationResult {
    /// Rows deleted or relabeled.
    pub rows_affected: usize,
    /// Effective source names after validation and deduplication.
    pub models: Vec<String>,
    /// `Some(target)` for a merge, `None` for a delete.
    pub target: Option<String>,
}
