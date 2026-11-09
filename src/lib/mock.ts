import type {
  BalanceSnapshot,
  DailyUsage,
  DayUsageDetail,
  DashboardSummary,
  DeepSeekStatus,
  ModelHourlyUsage,
  ModelUsage,
  OllamaLog,
  ModelCatalogEntry,
  ModelMutationResult,
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

const MODEL_SHARES = [0.44, 0.28, 0.18, 0.1];

interface MockModel {
  name: string;
  share: number;
  deleted: boolean;
}

let mockModelState: MockModel[] = MODEL_NAMES.map((name, index) => ({
  name,
  share: MODEL_SHARES[index],
  deleted: false,
}));

// Monotonic revision for the mock snapshot. It must increase on every call so
// the core-snapshot revision guard in `useCoreSnapshot` accepts fresh mock
// payloads (a constant revision would be dropped after the first load).
let mockRev = 0;
function mockRevision(): number {
  mockRev += 1;
  return mockRev;
}

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
    const newInput = Math.floor(total * (0.62 + noise(seed + 3) * 0.18));
    const output = Math.max(0, total - newInput);
    const context = active
      ? newInput + Math.floor(newInput * (1.4 + noise(seed + 5) * 2.6)) + 512
      : 0;
    const cached = Math.floor(context * (0.18 + noise(seed + 7) * 0.5));

    daily.push({
      date: dateKeyDaysAgo(offset),
      newInputTokens: newInput,
      outputTokens: output,
      contextTokens: context,
      cachedInputTokens: cached,
      contextProcessedTokens: context,
      cachedProcessedTokens: cached,
      totalTokens: newInput + output,
      requests: active ? 1 + Math.floor(noise(seed + 17) * 9) : 0,
      cacheHitRate: context > 0 ? cached / context : 0,
    });
  }
  return daily;
}

function activeMockModels() {
  return mockModelState.filter((m) => !m.deleted);
}

function retainedMockShare() {
  return mockModelState.reduce(
    (sum, m) => (m.deleted ? sum : sum + m.share),
    0,
  );
}

function normalizeMockShares() {
  const retained = retainedMockShare();
  if (retained === 0) return [];
  return mockModelState
    .filter((m) => !m.deleted)
    .map((m) => m.share / retained);
}

function mockDaily(): DailyUsage[] {
  const baseDaily = buildDaily();
  const retained = retainedMockShare();
  if (retained === 0) {
    return baseDaily.map((d) => ({
      ...d,
      newInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requests: 0,
      contextProcessedTokens: 0,
      cachedProcessedTokens: 0,
    }));
  }
  return baseDaily.map((d) => ({
    ...d,
    newInputTokens: Math.floor(d.newInputTokens * retained),
    outputTokens: Math.floor(d.outputTokens * retained),
    totalTokens: Math.floor(d.totalTokens * retained),
    requests: Math.floor(d.requests * retained),
    contextProcessedTokens: Math.floor(d.contextProcessedTokens * retained),
    cachedProcessedTokens: Math.floor(d.cachedProcessedTokens * retained),
  }));
}

function buildModels(
  totalTokens: number,
  newInputTokens: number,
  totalRequests: number,
): ModelUsage[] {
  const active = activeMockModels();
  if (active.length === 0) return [];
  const shares = normalizeMockShares();

  // Largest-remainder allocation so the per-model totals sum exactly to the
  // grand totals (no token is lost to rounding).
  const totals = distribute(totalTokens, shares);
  const newInputs = distribute(newInputTokens, shares);
  const requests = distribute(totalRequests, shares);

  return active.map((m, index) => {
    const total = totals[index];
    const newInput = newInputs[index];
    const output = Math.max(0, total - newInput);
    const context = Math.floor(newInput * (2.2 + index * 0.6)) + 512;
    const cached = Math.floor(context * (0.24 + index * 0.07));
    return {
      model: m.name,
      newInputTokens: newInput,
      outputTokens: output,
      contextTokens: context,
      cachedInputTokens: cached,
      totalTokens: total,
      requests: requests[index],
      cacheHitRate: context > 0 ? Math.min(1, cached / context) : 0,
    };
  });
}

function distribute(total: number, weights: number[]): number[] {
  if (total <= 0 || weights.length === 0)
    return new Array(weights.length).fill(0);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum <= 0) return new Array(weights.length).fill(0);

  const raw = weights.map((weight) => (total * weight) / weightSum);
  const allocated = raw.map((value) => Math.floor(value));
  let remainder = total - allocated.reduce((sum, value) => sum + value, 0);

  const byFraction = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction);

  let position = 0;
  while (remainder > 0) {
    allocated[byFraction[position % byFraction.length].index] += 1;
    remainder -= 1;
    position += 1;
  }
  return allocated;
}

function activityWeights(seed: number): number[] {
  const weights: number[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const dayness = Math.sin(((hour - 6) / 24) * Math.PI * 2);
    weights.push(0.15 + Math.max(0, dayness) + noise(seed + hour) * 0.4);
  }
  return weights;
}

function seedForDateKey(date: string): number {
  let seed = 0;
  for (let i = 0; i < date.length; i += 1) {
    seed = (seed * 31 + date.charCodeAt(i)) % 1_000_000;
  }
  return seed;
}

function zeroedHours(): ModelHourlyUsage["hours"] {
  return new Array(24).fill(0).map((_, hour) => ({
    hour,
    newInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    requests: 0,
    contextProcessedTokens: 0,
    cachedProcessedTokens: 0,
    cacheHitRate: 0,
  }));
}

export function mockModelCatalog(): ModelCatalogEntry[] {
  const daily = mockDaily();
  const active = activeMockModels();
  if (active.length === 0) return [];

  const totalTokens = daily.reduce((sum, d) => sum + d.totalTokens, 0);
  const totalRequests = daily.reduce((sum, d) => sum + d.requests, 0);
  const recentDaily = daily.slice(-30);
  const recentTokens = recentDaily.reduce((sum, d) => sum + d.totalTokens, 0);
  const recentRequests = recentDaily.reduce((sum, d) => sum + d.requests, 0);

  const now = Date.now();
  const yearAgo = now - 365 * 24 * 60 * 60 * 1000;
  const shares = normalizeMockShares();

  // Largest-remainder allocation so the per-model figures sum exactly to the
  // all-time and recent grand totals.
  const tokensTotal = distribute(totalTokens, shares);
  const requestsTotal = distribute(totalRequests, shares);
  const tokensRecent = distribute(recentTokens, shares);
  const requestsRecent = distribute(recentRequests, shares);

  return active
    .map((m, index) => ({
      model: m.name,
      requestsTotal: requestsTotal[index],
      tokensTotal: tokensTotal[index],
      requestsRecent: requestsRecent[index],
      tokensRecent: tokensRecent[index],
      firstSeenAt: Math.floor(yearAgo / 1000),
      lastSeenAt: Math.floor(now / 1000),
    }))
    .sort(
      (a, b) => b.tokensTotal - a.tokensTotal || a.model.localeCompare(b.model),
    );
}

export function mockDeleteModelData(models: string[]): ModelMutationResult {
  const catalogBefore = mockModelCatalog();
  const targetNames = new Set(models);
  const affectedModels = catalogBefore
    .filter((c) => targetNames.has(c.model))
    .map((c) => c.model);

  const rowsAffected = affectedModels.length * 10;

  affectedModels.forEach((name) => {
    const idx = mockModelState.findIndex((m) => m.name === name);
    if (idx !== -1) mockModelState[idx].deleted = true;
  });

  return { rowsAffected, models: affectedModels, target: null };
}

export function mockMergeModels(
  sources: string[],
  targetModel: string,
): ModelMutationResult {
  const target = targetModel.trim();
  if (!target) throw new Error("A target model name is required.");

  const effectiveSources = sources.filter((s) => s !== target);
  if (effectiveSources.length === 0)
    throw new Error("Select at least one model other than the target.");

  if (!mockModelState.some((m) => m.name === target)) {
    mockModelState.push({ name: target, share: 0, deleted: false });
  }

  const targetIdx = mockModelState.findIndex((m) => m.name === target);
  let combinedShare = 0;

  effectiveSources.forEach((source) => {
    const srcIdx = mockModelState.findIndex((m) => m.name === source);
    if (srcIdx !== -1) {
      combinedShare += mockModelState[srcIdx].share;
      mockModelState[srcIdx].deleted = true;
    }
  });

  mockModelState[targetIdx].share += combinedShare;

  return {
    rowsAffected: effectiveSources.length * 10,
    models: effectiveSources,
    target,
  };
}

export function mockDayUsageDetail(date: string): DayUsageDetail {
  const daily = mockDaily();
  const day = daily.find((d) => d.date === date);
  const active = activeMockModels();

  if (!day || day.requests === 0 || active.length === 0) {
    return { date, hours: zeroedHours(), models: [] };
  }

  const shares = normalizeMockShares();
  const seed = seedForDateKey(date);
  const hourWeights = activityWeights(seed);

  const modelHours: ModelHourlyUsage[] = active.map((m, i) => {
    const share = shares[i];
    const mTotals = distribute(day.totalTokens * share, hourWeights);
    const mNewInput = distribute(day.newInputTokens * share, hourWeights);
    const mContext = distribute(
      day.contextProcessedTokens * share,
      hourWeights,
    );
    const mCached = distribute(day.cachedProcessedTokens * share, hourWeights);
    const mReqs = distribute(day.requests * share, hourWeights);

    const hours = mTotals.map((total, h) => ({
      hour: h,
      newInputTokens: mNewInput[h],
      outputTokens: total - mNewInput[h],
      totalTokens: total,
      requests: mReqs[h],
      contextProcessedTokens: mContext[h],
      cachedProcessedTokens: mCached[h],
      cacheHitRate: mContext[h] > 0 ? mCached[h] / mContext[h] : 0,
    }));

    return { model: m.name, hours };
  });

  const allHours = zeroedHours().map((h) => {
    const hourIdx = h.hour;
    const hTotals = modelHours.reduce(
      (sum, m) => sum + m.hours[hourIdx].totalTokens,
      0,
    );
    const hNewInput = modelHours.reduce(
      (sum, m) => sum + m.hours[hourIdx].newInputTokens,
      0,
    );
    const hOutput = modelHours.reduce(
      (sum, m) => sum + m.hours[hourIdx].outputTokens,
      0,
    );
    const hReqs = modelHours.reduce(
      (sum, m) => sum + m.hours[hourIdx].requests,
      0,
    );
    const hContext = modelHours.reduce(
      (sum, m) => sum + m.hours[hourIdx].contextProcessedTokens,
      0,
    );
    const hCached = modelHours.reduce(
      (sum, m) => sum + m.hours[hourIdx].cachedProcessedTokens,
      0,
    );

    return {
      hour: hourIdx,
      newInputTokens: hNewInput,
      outputTokens: hOutput,
      totalTokens: hTotals,
      requests: hReqs,
      contextProcessedTokens: hContext,
      cachedProcessedTokens: hCached,
      cacheHitRate: hContext > 0 ? hCached / hContext : 0,
    };
  });

  return { date, hours: allHours, models: modelHours };
}

export function mockCoreSnapshot(): DashboardSummary {
  return mockDashboard(30);
}

export function mockDashboard(rangeDays = 30): DashboardSummary {
  const daily = mockDaily();
  const active = activeMockModels();
  const range = daily.slice(-Math.min(Math.max(rangeDays, 1), 365));

  const totalTokens = range.reduce((sum, d) => sum + d.totalTokens, 0);
  const newInputTokens = range.reduce((sum, d) => sum + d.newInputTokens, 0);
  const outputTokens = range.reduce((sum, d) => sum + d.outputTokens, 0);
  const requests = range.reduce((sum, d) => sum + d.requests, 0);

  const processedContext = range.reduce(
    (sum, d) => sum + d.contextProcessedTokens,
    0,
  );
  const processedCached = range.reduce(
    (sum, d) => sum + d.cachedProcessedTokens,
    0,
  );

  const today = daily[daily.length - 1] ?? {
    date: todayKey(),
    newInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    requests: 0,
    contextProcessedTokens: 0,
    cachedProcessedTokens: 0,
    cacheHitRate: 0,
  };

  const recent: OllamaLog[] =
    active.length === 0
      ? []
      : Array.from({ length: 15 }, (_, i) => {
          const m = active[i % active.length].name;
          const p = 240 + Math.floor(noise(i + 31) * 1800);
          const c = i % 3 === 0 ? 0 : Math.floor(noise(i + 47) * 900);
          return {
            id: 1000 - i,
            model: m,
            endpoint: "/api/chat",
            inputTokens: p,
            outputTokens: c,
            cachedInputTokens: Math.floor(p * 0.2),
            totalTokens: p + c,
            cacheHitRate: 0.2,
            createdAt: Math.floor(Date.now() / 1000) - i * 780,
            durationMs: 1000,
          };
        });

  return {
    revision: mockRevision(),
    generatedAt: Math.floor(Date.now() / 1000),
    rangeDays,
    totals: {
      newInputTokens,
      outputTokens,
      totalTokens,
      requests,
      todayPeakContextTokens: today.contextProcessedTokens,
      latestContextTokens: today.contextProcessedTokens,
      latestCachedInputTokens: today.cachedProcessedTokens,
      todayNewInputTokens: today.newInputTokens,
      todayOutputTokens: today.outputTokens,
      todayTokens: today.totalTokens,
      todayRequests: today.requests,
      cacheHitRate:
        processedContext > 0 ? processedCached / processedContext : 0,
      todayCacheHitRate:
        today.contextProcessedTokens > 0
          ? today.cachedProcessedTokens / today.contextProcessedTokens
          : 0,
    },
    streakDays: 5,
    models:
      active.length === 0
        ? []
        : buildModels(totalTokens, newInputTokens, requests),
    daily,
    recent,
    latestBalance: null,
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
  widgetEvictionSecs: 60,
  launchAtLogin: false,
};

export const mockSettingsView: SettingsView = {
  settings: mockSettings,
  hasDeepseekApiKey: true,
  deepseekKeySource: "keychain",
  deepseekKeyError: null,
  restartRequired: false,
  launchAtLoginSupported: true,
  launchAtLoginError: null,
};

export const mockDeepSeekStatus: DeepSeekStatus = {
  hasApiKey: true,
  keySource: "keychain",
  lastSuccessAt: Math.floor(Date.now() / 1000) - 420,
  lastError: null,
  lastErrorAt: null,
  balances: [],
  pollIntervalSecs: 900,
};
