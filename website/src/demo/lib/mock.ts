import type {
  BalanceSnapshot,
  DailyUsage,
  DayUsageDetail,
  DashboardSummary,
  DeepSeekStatus,
  ModelCatalogEntry,
  ModelHourlyUsage,
  ModelMutationResult,
  ModelPerformance,
  ModelPerformanceEntry,
  ModelUsage,
  OllamaLog,
  RequestCount,
  RequestExportResult,
  RequestFilterOptions,
  RequestFilters,
  Settings,
  SettingsView,
  SpeedSummary,
} from "./types";
import { parseDateKey, toDateKey, todayKey } from "./format";

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

/**
 * Deterministic per-model performance payload for the browser preview. Mirrors
 * the active mock models, adds one estimated-only model (to demo `~` and
 * `Approx`) and one inactive model with `requests: 0` and an older
 * `lastSeenAt`.
 */
export function mockModelPerformance(): ModelPerformance {
  const active = activeMockModels();
  const now = Math.floor(Date.now() / 1000);
  const shares = normalizeMockShares();
  const daily = mockDaily();
  const recentDaily = daily.slice(-30);
  const recentTokens = recentDaily.reduce(
    (sum, day) => sum + day.totalTokens,
    0,
  );
  const recentRequests = recentDaily.reduce(
    (sum, day) => sum + day.requests,
    0,
  );

  const tokensRecent = distribute(recentTokens, shares);
  const requestsRecent = distribute(recentRequests, shares);

  const entries: ModelPerformanceEntry[] = active.map((model, index) => {
    const outputTokens = Math.round(tokensRecent[index] * 0.18);
    const newInputTokens = tokensRecent[index] - outputTokens;
    const promptTokens =
      newInputTokens / Math.max(0.05, 1 - 0.5 * noise(index + 9));
    const cacheHitRate = 1 - newInputTokens / Math.max(1, promptTokens);
    // A deterministic tok/s per model; the second model is estimated-only.
    const estimatedOnly = index === active.length - 1;
    const generation = 62.4 - index * 14;
    const prefill = 1400 - index * 300;
    const timed = Math.round(requestsRecent[index] * 0.72);
    const estimated = Math.round(requestsRecent[index] * 0.14);
    return {
      model: model.name,
      requests: requestsRecent[index],
      newInputTokens,
      outputTokens,
      totalTokens: tokensRecent[index],
      cacheHitRate: Math.min(1, Math.max(0, cacheHitRate)),
      generationTokensPerSec: estimatedOnly ? null : generation,
      prefillTokensPerSec: estimatedOnly ? null : prefill,
      estimatedGenerationTokensPerSec: estimatedOnly ? 38.2 : null,
      estimatedPrefillTokensPerSec: estimatedOnly ? 1100 : null,
      timedRequests: estimatedOnly ? 0 : timed,
      estimatedRequests: estimatedOnly ? estimated : 0,
      lastSeenAt: now - index * 5400,
    };
  });

  // Inactive model: no usage in the range, older last-seen, no speeds.
  entries.push({
    model: "old-model:latest",
    requests: 0,
    newInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheHitRate: 0,
    generationTokensPerSec: null,
    prefillTokensPerSec: null,
    estimatedGenerationTokensPerSec: null,
    estimatedPrefillTokensPerSec: null,
    timedRequests: 0,
    estimatedRequests: 0,
    lastSeenAt: now - 45 * 24 * 60 * 60,
  });

  return { rangeDays: 30, models: entries };
}

/**
 * Browser-preview stand-in for `get_speed_summary`. Returns deterministic but
 * window-dependent values so the Day/Week/Month selector visibly changes and
 * refreshed windows move slightly, mirroring real aggregate behavior.
 */
export function mockSpeedSummary(since: number, until: number): SpeedSummary {
  const days = Math.max(1, Math.round((until - since) / 86_400));
  // Longer windows average over more requests, so they trend toward a stable
  // mid-range rate; tiny windows get a deterministic per-window wobble.
  const wobble = ((since / 3600) % 7) / 7;
  const requests = Math.round(days * 18 * (0.9 + wobble * 0.2));
  const timed = Math.round(requests * 0.82);
  const estimated = Math.round(requests * 0.11);
  return {
    since,
    until,
    requests,
    generationTokensPerSec: 38.6 + wobble * 6.4,
    prefillTokensPerSec: 980 + wobble * 260,
    estimatedGenerationTokensPerSec: 34.2 + wobble * 4.8,
    estimatedPrefillTokensPerSec: 890 + wobble * 210,
    timedRequests: timed,
    estimatedRequests: estimated,
  };
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
          // Every fourth row is an estimated `/v1` streaming request so the
          // preview demonstrates the `~` prefix and `Approx` chip.
          const estimated = index % 4 === 3;
          const hasTimings = completion > 0;
          const evalMs = 600 + Math.floor(noise(index + 71) * 5000);
          const promptMs = 120 + Math.floor(noise(index + 77) * 900);
          const generationTokensPerSec = hasTimings
            ? completion / (evalMs / 1000)
            : null;
          const newInput = Math.max(0, prompt - cached);
          const prefillTokensPerSec =
            hasTimings && newInput > 0 ? newInput / (promptMs / 1000) : null;
          return {
            id: 1000 - index,
            model,
            endpoint: estimated
              ? "/v1/chat/completions"
              : index % 4 === 0
                ? "/v1/chat/completions"
                : "/api/chat",
            inputTokens: prompt,
            outputTokens: completion,
            cachedInputTokens: cached,
            totalTokens: prompt + completion,
            cacheHitRate: prompt > 0 ? Math.min(1, cached / prompt) : 0,
            createdAt: Math.floor(Date.now() / 1000) - index * 780,
            durationMs: 900 + Math.floor(noise(index + 61) * 7000),
            generationTokensPerSec,
            prefillTokensPerSec,
            promptEvalDurationMs: hasTimings ? promptMs : null,
            evalDurationMs: hasTimings ? evalMs : null,
            timingSource: hasTimings
              ? estimated
                ? "estimated"
                : "native"
              : null,
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
      generationTokensPerSec: 42.3,
      prefillTokensPerSec: 1200,
      estimatedGenerationTokensPerSec: 38.1,
      estimatedPrefillTokensPerSec: 980,
      timedRequests: Math.round(requests * 0.78),
      estimatedRequests: Math.round(requests * 0.14),
      todayGenerationTokensPerSec: 38.1,
      todayPrefillTokensPerSec: 980,
      todayEstimatedGenerationTokensPerSec: 35.4,
      todayEstimatedPrefillTokensPerSec: 920,
      todayTimedRequests: Math.round(today.requests * 0.72),
      todayEstimatedRequests: Math.round(today.requests * 0.18),
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

// ---------------------------------------------------------------------------
// Request-history export mocks (browser preview only). The real data always
// comes from the Rust backend; these stand in so the dialog works in a plain
// browser and on the website demo.
// ---------------------------------------------------------------------------

const MOCK_ENDPOINTS = ["/api/chat", "/api/generate", "/v1/chat/completions"];

/** Distinct model names plus the common endpoints, for the filter dropdowns. */
export function mockRequestFilterOptions(): RequestFilterOptions {
  return {
    models: activeMockModels().map((model) => model.name),
    endpoints: MOCK_ENDPOINTS.slice(),
  };
}

/**
 * Resolves a `YYYY-MM-DD` anchor to a half-open `[since, until)` window in
 * local epoch seconds, mirroring the Rust backend. Weeks start on Sunday.
 */
function mockWindow(
  period: RequestFilters["period"],
  anchor: string | null,
): [number, number] {
  if (period === "all" || !anchor)
    return [0, Math.floor(Date.now() / 1000) + 86_400];

  const date = parseDateKey(anchor);
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000;

  if (period === "date") {
    const start = startOfDay(date);
    return [start, start + 86_400];
  }
  if (period === "week") {
    const daysFromSunday = date.getDay();
    const start = startOfDay(date) - daysFromSunday * 86_400;
    return [start, start + 7 * 86_400];
  }
  // month
  const first =
    new Date(date.getFullYear(), date.getMonth(), 1).getTime() / 1000;
  const nextMonth =
    new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime() / 1000;
  return [first, nextMonth];
}

function mockLogMatches(
  log: OllamaLog,
  filters: RequestFilters,
  since: number,
  until: number,
): boolean {
  if (log.createdAt < since || log.createdAt >= until) return false;
  if (filters.models.length > 0 && !filters.models.includes(log.model))
    return false;
  if (filters.endpoints.length > 0 && !filters.endpoints.includes(log.endpoint))
    return false;
  return true;
}

/** Filters `mockCoreSnapshot().recent` by period, model, and endpoint. */
export function mockCountRequests(filters: RequestFilters): RequestCount {
  const [since, until] = mockWindow(filters.period, filters.date);
  const rows = mockCoreSnapshot().recent.filter((log) =>
    mockLogMatches(log, filters, since, until),
  );
  return { count: rows.length, since, until };
}

/**
 * Builds the same CSV string the Rust backend writes (minus the BOM), used
 * for the browser Blob download. Columns match the backend exactly.
 */
export function buildRequestCsv(logs: OllamaLog[]): string {
  const header = [
    "created_at_local",
    "created_at_unix",
    "request_id",
    "model",
    "endpoint",
    "input_tokens",
    "cached_input_tokens",
    "new_input_tokens",
    "output_tokens",
    "total_tokens",
    "cache_hit_rate",
    "duration_ms",
    "prompt_eval_duration_ms",
    "eval_duration_ms",
    "generation_tokens_per_sec",
    "prefill_tokens_per_sec",
    "timing_source",
  ].join(",");

  const lines = logs.map((log) => {
    const local = new Date(log.createdAt * 1000).toISOString().replace("Z", "");
    const newInput = Math.max(0, log.inputTokens - log.cachedInputTokens);
    const cells = [
      local,
      String(log.createdAt),
      log.model,
      log.endpoint,
      String(log.inputTokens),
      String(log.cachedInputTokens),
      String(newInput),
      String(log.outputTokens),
      String(log.totalTokens),
      log.cacheHitRate.toFixed(4),
      log.durationMs == null ? "" : String(log.durationMs),
      log.promptEvalDurationMs == null ? "" : String(log.promptEvalDurationMs),
      log.evalDurationMs == null ? "" : String(log.evalDurationMs),
      log.generationTokensPerSec == null
        ? ""
        : log.generationTokensPerSec.toFixed(4),
      log.prefillTokensPerSec == null ? "" : log.prefillTokensPerSec.toFixed(4),
      log.timingSource ?? "",
    ];
    return cells.map((cell) => csvEscape(cell)).join(",");
  });

  return [header, ...lines].join("\n");
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Returns the CSV rows and a synthetic export result for the browser. The
 * Blob download is triggered by the caller.
 */
export function mockExportRequests(filters: RequestFilters): {
  csv: string;
  result: RequestExportResult;
} {
  const [since, until] = mockWindow(filters.period, filters.date);
  const rows = mockCoreSnapshot().recent.filter((log) =>
    mockLogMatches(log, filters, since, until),
  );
  const csv = buildRequestCsv(rows);
  const fileName = mockExportFileName(filters);
  return {
    csv,
    result: {
      path: "(browser preview)",
      fileName,
      rows: rows.length,
      since,
      until,
    },
  };
}

function mockExportFileName(filters: RequestFilters): string {
  const period =
    filters.period === "all"
      ? "all-time"
      : filters.period === "week"
        ? `week-of-${filters.date ?? "week"}`
        : filters.period === "month"
          ? (filters.date ?? "month").slice(0, 7)
          : (filters.date ?? "date");
  const models =
    filters.models.length === 0
      ? "all-models"
      : `models-${filters.models.length}`;
  const endpoints =
    filters.endpoints.length === 0
      ? "all-endpoints"
      : `endpoints-${filters.endpoints.length}`;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `tokenflow-requests_${period}_${models}_${endpoints}_${stamp}.csv`;
}
