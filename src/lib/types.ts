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
   * Idle window before the hidden widget's renderer is killed. On Linux the
   * core recycle follows 5 s later; 0 disables both.
   */
  widgetEvictionSecs: number;
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
