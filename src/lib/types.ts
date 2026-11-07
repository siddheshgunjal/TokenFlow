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
  /** Destroy the hidden widget after this many seconds; 0 keeps it warm. */
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
