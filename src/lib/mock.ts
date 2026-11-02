import type {
  BalanceSnapshot,
  DailyUsage,
  DashboardSummary,
  DeepSeekStatus,
  ModelUsage,
  OllamaLog,
  Settings,
  SettingsView,
} from "./types";
import { toDateKey, todayKey } from "./format";

const MODEL_NAMES = [
  "llama3.2:latest",
  "qwen2.5-coder:7b",
  "deepseek-r1:8b",
  "mistral:7b",
];

// Deterministic pseudo-random values keep the browser preview stable across
// refreshes. Real data always comes from the Rust backend.
function noise(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

function dateKeyDaysAgo(daysAgo: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return toDateKey(date);
}

function buildDaily(): DailyUsage[] {
  const daily: DailyUsage[] = [];

  for (let offset = 364; offset >= 0; offset -= 1) {
    const seed = 364 - offset;
    const weekday = new Date(
      new Date().setDate(new Date().getDate() - offset),
    ).getDay();
    const weekendFactor = weekday === 0 || weekday === 6 ? 0.35 : 1;
    const active = noise(seed) > 0.24;
    const total = active
      ? Math.floor((700 + noise(seed + 11) * 16_000) * weekendFactor)
      : 0;
    const prompt = Math.floor(total * (0.58 + noise(seed + 3) * 0.2));
    const cached = Math.floor(prompt * (0.18 + noise(seed + 5) * 0.42));

    daily.push({
      date: dateKeyDaysAgo(offset),
      inputTokens: prompt,
      outputTokens: total - prompt,
      cachedInputTokens: cached,
      totalTokens: total,
      requests: active ? 1 + Math.floor(noise(seed + 17) * 9) : 0,
    });
  }

  return daily;
}

function buildModels(
  totalTokens: number,
  inputTokens: number,
  totalRequests: number,
): ModelUsage[] {
  const shares = [0.44, 0.28, 0.18, 0.1];
  return MODEL_NAMES.map((model, index) => {
    const total = Math.floor(totalTokens * shares[index]);
    const input = Math.floor(inputTokens * shares[index]);
    const output = Math.max(0, total - input);
    const cached = Math.floor(input * (0.24 + index * 0.07));
    return {
      model,
      inputTokens: input,
      outputTokens: output,
      cachedInputTokens: cached,
      totalTokens: total,
      requests: Math.floor(totalRequests * shares[index]),
      cacheHitRate: input > 0 ? Math.min(1, cached / input) : 0,
    };
  });
}

export function mockDashboard(rangeDays = 30): DashboardSummary {
  const daily = buildDaily();
  const range = daily.slice(-Math.min(Math.max(rangeDays, 1), 365));
  const totalTokens = range.reduce((sum, day) => sum + day.totalTokens, 0);
  const inputTokens = range.reduce((sum, day) => sum + day.inputTokens, 0);
  const outputTokens = range.reduce((sum, day) => sum + day.outputTokens, 0);
  const cachedInputTokens = range.reduce(
    (sum, day) => sum + day.cachedInputTokens,
    0,
  );
  const requests = range.reduce((sum, day) => sum + day.requests, 0);
  const today = daily[daily.length - 1] ?? {
    date: todayKey(),
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
    requests: 0,
  };
  const cacheHitRate = inputTokens > 0 ? cachedInputTokens / inputTokens : 0;
  const todayCacheHitRate =
    today.inputTokens > 0 ? today.cachedInputTokens / today.inputTokens : 0;

  let streakDays = 0;
  for (let index = daily.length - 1; index >= 0; index -= 1) {
    if (daily[index].totalTokens > 0) streakDays += 1;
    else break;
  }

  const recent: OllamaLog[] = Array.from({ length: 8 }, (_, index) => {
    const model = MODEL_NAMES[index % MODEL_NAMES.length];
    const prompt = 240 + Math.floor(noise(index + 31) * 1800);
    const completion =
      index % 3 === 0 ? 0 : Math.floor(noise(index + 47) * 900);
    const cached = Math.floor(prompt * (0.15 + noise(index + 53) * 0.5));
    return {
      id: 1000 - index,
      model,
      endpoint: index % 4 === 0 ? "/v1/chat/completions" : "/api/chat",
      inputTokens: prompt,
      outputTokens: completion,
      cachedInputTokens: cached,
      totalTokens: prompt + completion,
      cacheHitRate: prompt > 0 ? Math.min(1, cached / prompt) : 0,
      createdAt: Math.floor(Date.now() / 1000) - index * 780,
      durationMs: 900 + Math.floor(noise(index + 61) * 7000),
    };
  });

  return {
    generatedAt: Math.floor(Date.now() / 1000),
    rangeDays,
    totals: {
      inputTokens,
      outputTokens,
      cachedInputTokens,
      totalTokens,
      requests,
      todayInputTokens: today.inputTokens,
      todayOutputTokens: today.outputTokens,
      todayCachedInputTokens: today.cachedInputTokens,
      todayTokens: today.totalTokens,
      todayRequests: today.requests,
      cacheHitRate,
      todayCacheHitRate,
    },
    streakDays,
    models: buildModels(totalTokens, inputTokens, requests),
    daily,
    recent,
    latestBalance: {
      isAvailable: true,
      totalBalance: "24.86",
      currency: "USD",
      grantedBalance: "3.20",
      toppedUpBalance: "21.66",
      createdAt: Math.floor(Date.now() / 1000) - 420,
    },
    proxy: {
      running: true,
      bindAddress: "127.0.0.1:11435",
      upstreamUrl: "http://127.0.0.1:11434",
      error: null,
    },
  };
}

export function mockBalanceHistory(
  since: number,
  until: number,
  currency = "USD",
): BalanceSnapshot[] {
  const step = 3_600;
  const first = Math.ceil(since / step) * step;
  // The requested `until` is the end of the selected period, which can be in
  // the future. Only synthesize samples that could exist today.
  const last = Math.min(until, Math.floor(Date.now() / 1000));
  if (last <= first) return [];

  const count = Math.floor((last - first) / step);
  const snapshots: BalanceSnapshot[] = [];
  // Walk backwards from the latest snapshot so the chart ends at the balance
  // shown on the card.
  let balance = 24.86;

  for (let index = count; index >= 0; index -= 1) {
    const at = first + index * step;
    const seed = Math.floor(at / step);
    const spend = noise(seed) * 0.045;
    const topUp = noise(seed + 41) > 0.997 ? 5 + noise(seed + 43) * 5 : 0;

    snapshots.push({
      isAvailable: true,
      totalBalance: balance.toFixed(2),
      currency,
      grantedBalance: "3.20",
      toppedUpBalance: Math.max(0, balance - 3.2).toFixed(2),
      createdAt: at,
    });

    balance = Math.max(0.5, balance + spend - topUp);
  }

  return snapshots.reverse();
}

export const mockSettings: Settings = {
  upstreamUrl: "http://127.0.0.1:11434",
  proxyPort: 11435,
  deepseekPollIntervalSecs: 900,
  deepseekBaseUrl: "https://api.deepseek.com",
  startMinimized: false,
  closeToTray: true,
  widgetAlwaysOnTop: true,
  showWidgetOnStart: false,
};

export const mockSettingsView: SettingsView = {
  settings: mockSettings,
  hasDeepseekApiKey: true,
  deepseekKeySource: "settings",
  restartRequired: false,
};

export const mockDeepSeekStatus: DeepSeekStatus = {
  hasApiKey: true,
  keySource: "settings",
  lastSuccessAt: Math.floor(Date.now() / 1000) - 420,
  lastError: null,
  lastErrorAt: null,
  balances: [
    {
      isAvailable: true,
      totalBalance: "24.86",
      currency: "USD",
      grantedBalance: "3.20",
      toppedUpBalance: "21.66",
      createdAt: Math.floor(Date.now() / 1000) - 420,
    },
  ],
  pollIntervalSecs: 900,
};
