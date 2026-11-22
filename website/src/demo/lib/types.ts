export type TimingSource = "native" | "estimated";

export interface Totals {
  newInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
  todayPeakContextTokens: number;
  latestContextTokens: number;
  latestCachedInputTokens: number;
  todayNewInputTokens: number;
  todayOutputTokens: number;
  todayTokens: number;
  todayRequests: number;
  cacheHitRate: number;
  todayCacheHitRate: number;
  /** Time-weighted generation rate over native rows in the range. */
  generationTokensPerSec: number | null;
  /** Time-weighted prefill rate over native rows in the range. */
  prefillTokensPerSec: number | null;
  /** Time-weighted generation rate over estimated (`/v1`) rows in the range. */
  estimatedGenerationTokensPerSec: number | null;
  /** Time-weighted prefill rate over estimated (`/v1`) rows in the range. */
  estimatedPrefillTokensPerSec: number | null;
  /** Native rows in the range with any duration. */
  timedRequests: number;
  /** Estimated rows in the range with any duration. */
  estimatedRequests: number;
  /** Time-weighted generation rate over native rows today. */
  todayGenerationTokensPerSec: number | null;
  /** Time-weighted prefill rate over native rows today. */
  todayPrefillTokensPerSec: number | null;
  /** Time-weighted generation rate over estimated (`/v1`) rows today. */
  todayEstimatedGenerationTokensPerSec: number | null;
  /** Time-weighted prefill rate over estimated (`/v1`) rows today. */
  todayEstimatedPrefillTokensPerSec: number | null;
  /** Native rows today with any duration. */
  todayTimedRequests: number;
  /** Estimated rows today with any duration. */
  todayEstimatedRequests: number;
}

export interface ModelUsage {
  model: string;
  newInputTokens: number;
  outputTokens: number;
  contextTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  requests: number;
  cacheHitRate: number;
}

export interface DailyUsage {
  date: string;
  newInputTokens: number;
  outputTokens: number;
  contextTokens: number;
  cachedInputTokens: number;
  contextProcessedTokens: number;
  cachedProcessedTokens: number;
  totalTokens: number;
  requests: number;
  cacheHitRate: number;
}

/** Per-hour token bucket for a single day. */
export interface HourlyUsage {
  /** Local hour, 0–23. */
  hour: number;
  newInputTokens: number;
  outputTokens: number;
  /** newInputTokens + outputTokens. */
  totalTokens: number;
  requests: number;
  /** Sum of per-request prompt sizes this hour. Cache-rate denominator. */
  contextProcessedTokens: number;
  /** Sum of cached prefixes this hour. Cache-rate numerator. */
  cachedProcessedTokens: number;
  /** Token-weighted cache share, 0.0–1.0. */
  cacheHitRate: number;
}

/** Per-model hourly buckets for one day. Always 24 entries, hour 0–23. */
export interface ModelHourlyUsage {
  model: string;
  hours: HourlyUsage[];
}

/** Read-only, lazy payload for one calendar day. Not part of `DashboardSummary`. */
export interface DayUsageDetail {
  /** Local calendar date in `YYYY-MM-DD` format. */
  date: string;
  /** Always 24 entries, hour 0–23, all models combined. */
  hours: HourlyUsage[];
  /** Models active that day, sorted by total tokens desc, then model asc. */
  models: ModelHourlyUsage[];
}

export interface OllamaLog {
  id: number;
  model: string;
  endpoint: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  cacheHitRate: number;
  createdAt: number;
  durationMs: number | null;
  /** Per-request generation rate; `null` when no timing was captured. */
  generationTokensPerSec: number | null;
  /** Per-request prefill rate; `null` when no timing was captured. */
  prefillTokensPerSec: number | null;
  /** Prompt processing time, in milliseconds; `null` when not timed. */
  promptEvalDurationMs: number | null;
  /** Generation time, in milliseconds; `null` when not timed. */
  evalDurationMs: number | null;
  /** `null` when no timing data was captured for this request. */
  timingSource: TimingSource | null;
}

export interface BalanceSnapshot {
  isAvailable: boolean;
  totalBalance: string;
  currency: string;
  grantedBalance: string | null;
  toppedUpBalance: string | null;
  createdAt: number;
}

export interface ProxyStatus {
  running: boolean;
  bindAddress: string;
  upstreamUrl: string;
  error: string | null;
}

export interface DashboardSummary {
  /** Monotonic; increments on every core rebuild. Used to discard stale events. */
  revision: number;
  generatedAt: number;
  rangeDays: number;
  totals: Totals;
  streakDays: number;
  models: ModelUsage[];
  daily: DailyUsage[];
  recent: OllamaLog[];
  latestBalance: BalanceSnapshot | null;
  proxy: ProxyStatus;
}

/** Result of a unified manual refresh. The snapshot is always valid. */
export interface RefreshResult {
  snapshot: DashboardSummary;
  /** Non-fatal DeepSeek failure. The snapshot is still valid. */
  deepseekError: string | null;
}

export interface Settings {
  upstreamUrl: string;
  proxyPort: number;
  deepseekPollIntervalSecs: number;
  deepseekBaseUrl: string;
  startMinimized: boolean;
  closeToTray: boolean;
  widgetAlwaysOnTop: boolean;
  showWidgetOnStart: boolean;
  /**
   * Re-exec the Linux core after this many seconds with no visible window and
   * no proxy traffic; 0 disables the recycle.
   */
  idleRecycleSecs: number;
  launchAtLogin: boolean;
}

export type DeepSeekKeySource = "environment" | "keychain" | "legacy";

export interface SettingsView {
  settings: Settings;
  hasDeepseekApiKey: boolean;
  deepseekKeySource: DeepSeekKeySource | null;
  deepseekKeyError: string | null;
  restartRequired: boolean;
  launchAtLoginSupported: boolean;
  launchAtLoginError: string | null;
}

export interface DeepSeekStatus {
  hasApiKey: boolean;
  keySource: DeepSeekKeySource | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  balances: BalanceSnapshot[];
  pollIntervalSecs: number;
}

export interface ModelCatalogEntry {
  model: string;
  requestsTotal: number;
  tokensTotal: number;
  requestsRecent: number;
  tokensRecent: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface ModelMutationResult {
  rowsAffected: number;
  models: string[];
  target: string | null;
}

/** One model's usage, cache, and time-weighted speed over the range. */
export interface ModelPerformanceEntry {
  model: string;
  requests: number;
  newInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitRate: number;
  /** Time-weighted generation rate over native rows. */
  generationTokensPerSec: number | null;
  /** Time-weighted prefill rate over native rows. */
  prefillTokensPerSec: number | null;
  /** Time-weighted generation rate over estimated (`/v1`) rows. */
  estimatedGenerationTokensPerSec: number | null;
  /** Time-weighted prefill rate over estimated (`/v1`) rows. */
  estimatedPrefillTokensPerSec: number | null;
  /** Native rows in the range with any duration. */
  timedRequests: number;
  /** Estimated rows in the range with any duration. */
  estimatedRequests: number;
  /** All-time most recent request, so inactive models still show history. */
  lastSeenAt: number;
}

/**
 * Read-only, lazy overall-speed payload for an arbitrary time window. Anchored
 * to the dashboard's selected day and Day/Week/Month range so the Model speed
 * card shows dynamic values instead of a fixed range. Not part of the core
 * snapshot; the widget never calls it.
 */
export interface SpeedSummary {
  since: number;
  until: number;
  /** Every request in the window, timed or not. Coverage denominator. */
  requests: number;
  /** Time-weighted generation rate over native rows. */
  generationTokensPerSec: number | null;
  /** Time-weighted prefill rate over native rows. */
  prefillTokensPerSec: number | null;
  /** Time-weighted generation rate over estimated (`/v1`) rows. */
  estimatedGenerationTokensPerSec: number | null;
  /** Time-weighted prefill rate over estimated (`/v1`) rows. */
  estimatedPrefillTokensPerSec: number | null;
  /** Native rows in the window with any duration. */
  timedRequests: number;
  /** Estimated rows in the window with any duration. */
  estimatedRequests: number;
}

/**
 * Read-only, lazy per-model performance payload. Covers every distinct model
 * ever recorded (not just the snapshot's top-12); fetched on demand for the
 * Speed tab.
 */
export interface ModelPerformance {
  rangeDays: number;
  models: ModelPerformanceEntry[];
}

export interface ClearDataResult {
  ollamaLogs: number;
  deepseekBalances: number;
}

export interface OllamaUsageEvent {
  type: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  timestamp: number;
}

export interface DeepSeekBalanceEvent {
  type: string;
  isAvailable: boolean;
  balance: string;
  currency: string;
  timestamp: number;
}
