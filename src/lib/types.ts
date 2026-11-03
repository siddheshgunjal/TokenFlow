export interface Totals {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  requests: number;
  todayInputTokens: number;
  todayOutputTokens: number;
  todayCachedInputTokens: number;
  todayTokens: number;
  todayRequests: number;
  cacheHitRate: number;
  todayCacheHitRate: number;
}

export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  requests: number;
  cacheHitRate: number;
}

export interface DailyUsage {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  requests: number;
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

export interface Settings {
  upstreamUrl: string;
  proxyPort: number;
  deepseekPollIntervalSecs: number;
  deepseekBaseUrl: string;
  startMinimized: boolean;
  closeToTray: boolean;
  widgetAlwaysOnTop: boolean;
  showWidgetOnStart: boolean;
}

export type DeepSeekKeySource = "environment" | "keychain" | "legacy";

export interface SettingsView {
  settings: Settings;
  hasDeepseekApiKey: boolean;
  deepseekKeySource: DeepSeekKeySource | null;
  deepseekKeyError: string | null;
  restartRequired: boolean;
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
