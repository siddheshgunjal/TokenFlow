import type {
  BalanceSnapshot,
  DailyUsage,
  DayUsageDetail,
  DashboardSummary,
  DeepSeekStatus,
  ModelCatalogEntry,
  ModelHourlyUsage,
  ModelMutationResult,
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

// Model share of a day's tokens; mirrors `buildModels` so the day-detail mock
// splits the same way the 30-day snapshot does.
const MODEL_SHARES = [0.44, 0.28, 0.18, 0.1];

interface MockModel {
  name: string;
  share: number;
  deleted: boolean;
}

// In-memory model state so the browser preview reflects delete/merge actions
// across the dashboard, models card, and day drill-down.
let mockModelState: MockModel[] = MODEL_NAMES.map((name, index) => ({
  name,
  share: MODEL_SHARES[index],
  deleted: false,
}));

// Monotonic revision for the mock snapshot. It must increase on every call so
// the snapshot revision guard accepts fresh mock payloads (a constant revision
// would be dropped after the first load).
let mockRev = 0;
function mockRevision(): number {
  mockRev += 1;
  return mockRev;
}

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
    const newInput = Math.floor(total * (0.62 + noise(seed + 3) * 0.18));
    const output = Math.max(0, total - newInput);
    // Context is a per-request gauge, so the mock stores one peak prompt.
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
  return mockModelState.filter((model) => !model.deleted);
}

function retainedMockShare() {
  return mockModelState.reduce(
    (sum, model) => (model.deleted ? sum : sum + model.share),
    0,
  );
}

function normalizeMockShares() {
  const retained = retainedMockShare();
  if (retained === 0) return [];
  return mockModelState
    .filter((model) => !model.deleted)
    .map((model) => model.share / retained);
}

// The daily series after accounting for deleted models: every day's token
// and request fields scale by the retained share. A merge does not change the
// retained share, so totals stay constant.
function mockDaily(): DailyUsage[] {
  const baseDaily = buildDaily();
  const retained = retainedMockShare();
  if (retained === 0) {
    return baseDaily.map((day) => ({
      ...day,
      newInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requests: 0,
      contextProcessedTokens: 0,
      cachedProcessedTokens: 0,
    }));
  }
  return baseDaily.map((day) => ({
    ...day,
    newInputTokens: Math.floor(day.newInputTokens * retained),
    outputTokens: Math.floor(day.outputTokens * retained),
    totalTokens: Math.floor(day.totalTokens * retained),
    requests: Math.floor(day.requests * retained),
    contextProcessedTokens: Math.floor(day.contextProcessedTokens * retained),
    cachedProcessedTokens: Math.floor(day.cachedProcessedTokens * retained),
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

  return active.map((model, index) => {
    const total = totals[index];
    const newInput = newInputs[index];
    const output = Math.max(0, total - newInput);
    const context = Math.floor(newInput * (2.2 + index * 0.6)) + 512;
    const cached = Math.floor(context * (0.24 + index * 0.07));
    return {
      model: model.name,
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

/**
 * Deterministically distributes `total` across `weights.length` slots weighted
 * by `weights`, using a largest-remainder allocation so the integer sum is
 * exactly `total`.
 */
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

/**
 * A deterministic 24-hour activity curve: low overnight, peaking in the late
 * morning and evening. Seeded per day so the browser preview is stable.
 */
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
  for (let index = 0; index < date.length; index += 1) {
    seed = (seed * 31 + date.charCodeAt(index)) % 1_000_000;
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

  const totalTokens = daily.reduce((sum, day) => sum + day.totalTokens, 0);
  const totalRequests = daily.reduce((sum, day) => sum + day.requests, 0);
  const recentDaily = daily.slice(-30);
  const recentTokens = recentDaily.reduce(
    (sum, day) => sum + day.totalTokens,
    0,
  );
  const recentRequests = recentDaily.reduce(
    (sum, day) => sum + day.requests,
    0,
  );

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
    .map((model, index) => ({
      model: model.name,
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
  if (models.length === 0) {
    throw new Error("Select at least one model to delete.");
  }

  const catalogBefore = mockModelCatalog();
  const targetNames = new Set(models);
  const affectedModels = catalogBefore
    .filter((entry) => targetNames.has(entry.model))
    .map((entry) => entry.model);

  const rowsAffected = affectedModels.length * 10;

  affectedModels.forEach((name) => {
    const index = mockModelState.findIndex((model) => model.name === name);
    if (index !== -1) mockModelState[index].deleted = true;
  });

  return { rowsAffected, models: affectedModels, target: null };
}

export function mockMergeModels(
  sources: string[],
  targetModel: string,
): ModelMutationResult {
  const target = targetModel.trim();
  if (!target) throw new Error("A target model name is required.");

  const effectiveSources = sources.filter((source) => source !== target);
  if (effectiveSources.length === 0) {
    throw new Error("Select at least one model other than the target.");
  }

  if (!mockModelState.some((model) => model.name === target)) {
    mockModelState.push({ name: target, share: 0, deleted: false });
  }

  const targetIdx = mockModelState.findIndex((model) => model.name === target);
  let combinedShare = 0;

  effectiveSources.forEach((source) => {
    const sourceIdx = mockModelState.findIndex(
      (model) => model.name === source,
    );
    if (sourceIdx !== -1) {
      combinedShare += mockModelState[sourceIdx].share;
      mockModelState[sourceIdx].deleted = true;
    }
  });

  mockModelState[targetIdx].share += combinedShare;

  return {
    rowsAffected: effectiveSources.length * 10,
    models: effectiveSources,
    target,
  };
}

/**
 * Browser-preview stand-in for `get_day_usage_detail`. Splits the matching
 * `DailyUsage` day across 24 hours and the active mock models so panel totals
 * exactly match the calendar day.
 */
export function mockDayUsageDetail(date: string): DayUsageDetail {
  const daily = mockDaily();
  const day = daily.find((entry) => entry.date === date);
  const active = activeMockModels();

  if (!day || day.requests === 0 || active.length === 0) {
    return { date, hours: zeroedHours(), models: [] };
  }

  const seed = seedForDateKey(date);
  const hourWeights = activityWeights(seed);
  const shares = normalizeMockShares();

  const modelTotals = distribute(day.totalTokens, shares);
  const modelNewInput = distribute(day.newInputTokens, shares);
  const modelContext = distribute(day.contextProcessedTokens, shares);
  const modelCached = distribute(day.cachedProcessedTokens, shares);
  const modelRequests = distribute(day.requests, shares);

  const models: ModelHourlyUsage[] = active.map((model, index) => {
    const hourTotals = distribute(modelTotals[index], hourWeights);
    const hourNewInput = distribute(modelNewInput[index], hourWeights);
    const hourContext = distribute(modelContext[index], hourWeights);
    const hourCached = distribute(modelCached[index], hourWeights);
    const hourRequests = distribute(modelRequests[index], hourWeights);

    const hours = hourTotals.map((total, hour) => {
      const newInputTokens = hourNewInput[hour];
      const contextProcessedTokens = hourContext[hour];
      const cachedProcessedTokens = Math.min(
        contextProcessedTokens,
        hourCached[hour],
      );
      return {
        hour,
        newInputTokens,
        outputTokens: total - newInputTokens,
        totalTokens: total,
        requests: hourRequests[hour],
        contextProcessedTokens,
        cachedProcessedTokens,
        cacheHitRate:
          contextProcessedTokens > 0
            ? cachedProcessedTokens / contextProcessedTokens
            : 0,
      };
    });

    return { model: model.name, hours };
  });

  // All-model hours are derived by summing the per-model buckets so the panel
  // totals always match the calendar day.
  const hours: DayUsageDetail["hours"] = new Array(24)
    .fill(0)
    .map((_, hour) => {
      const newInputTokens = models.reduce(
        (sum, model) => sum + model.hours[hour].newInputTokens,
        0,
      );
      const outputTokens = models.reduce(
        (sum, model) => sum + model.hours[hour].outputTokens,
        0,
      );
      const requests = models.reduce(
        (sum, model) => sum + model.hours[hour].requests,
        0,
      );
      const contextProcessedTokens = models.reduce(
        (sum, model) => sum + model.hours[hour].contextProcessedTokens,
        0,
      );
      const cachedProcessedTokens = models.reduce(
        (sum, model) => sum + model.hours[hour].cachedProcessedTokens,
        0,
      );
      const totalTokens = newInputTokens + outputTokens;
      return {
        hour,
        newInputTokens,
        outputTokens,
        totalTokens,
        requests,
        contextProcessedTokens,
        cachedProcessedTokens,
        cacheHitRate:
          contextProcessedTokens > 0
            ? cachedProcessedTokens / contextProcessedTokens
            : 0,
      };
    });

  return { date, hours, models };
}

export function mockCoreSnapshot(): DashboardSummary {
  return mockDashboard(30);
}

export function mockDashboard(rangeDays = 30): DashboardSummary {
  const daily = mockDaily();
  const active = activeMockModels();
  const range = daily.slice(-Math.min(Math.max(rangeDays, 1), 365));
  const newInputTokens = range.reduce(
    (sum, day) => sum + day.newInputTokens,
    0,
  );
  const outputTokens = range.reduce((sum, day) => sum + day.outputTokens, 0);
  const totalTokens = newInputTokens + outputTokens;
  const processedContext = range.reduce(
    (sum, day) => sum + day.contextProcessedTokens,
    0,
  );
  const processedCached = range.reduce(
    (sum, day) => sum + day.cachedProcessedTokens,
    0,
  );
  const requests = range.reduce((sum, day) => sum + day.requests, 0);
  const today = daily[daily.length - 1] ?? {
    date: todayKey(),
    newInputTokens: 0,
    outputTokens: 0,
    contextTokens: 0,
    cachedInputTokens: 0,
    contextProcessedTokens: 0,
    cachedProcessedTokens: 0,
    totalTokens: 0,
    requests: 0,
    cacheHitRate: 0,
  };
  const cacheHitRate =
    processedContext > 0 ? processedCached / processedContext : 0;
  const todayCacheHitRate =
    today.contextProcessedTokens > 0
      ? today.cachedProcessedTokens / today.contextProcessedTokens
      : 0;

  let streakDays = 0;
  for (let index = daily.length - 1; index >= 0; index -= 1) {
    if (daily[index].totalTokens > 0) streakDays += 1;
    else break;
  }

  const recent: OllamaLog[] =
    active.length === 0
      ? []
      : Array.from({ length: 15 }, (_, index) => {
          const model = active[index % active.length].name;
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
    revision: mockRevision(),
    generatedAt: Math.floor(Date.now() / 1000),
    rangeDays,
    totals: {
      newInputTokens,
      outputTokens,
      totalTokens,
      requests,
      todayPeakContextTokens: today.contextTokens,
      latestContextTokens: today.contextTokens,
      latestCachedInputTokens: today.cachedInputTokens,
      todayNewInputTokens: today.newInputTokens,
      todayOutputTokens: today.outputTokens,
      todayTokens: today.totalTokens,
      todayRequests: today.requests,
      cacheHitRate,
      todayCacheHitRate,
    },
    streakDays,
    models: buildModels(totalTokens, newInputTokens, requests),
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
  idleRecycleSecs: 60,
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
