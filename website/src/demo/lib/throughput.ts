/**
 * Exact sentence required for estimated (`/v1`) values. Ollama does not report
 * prefill details for `/v1` endpoints, so those speeds are derived from stream
 * timing and are always approximate.
 */
export const APPROX_TOOLTIP =
  "Approximate: ollama does not provide prefill details for /v1 endpoints. Speed is estimated from stream timing.";

/**
 * Tooltip for the info icon on the speed strip and the Speed tab footer.
 * Explains the time-weighted aggregation and the native-first preference.
 */
export const THROUGHPUT_TOOLTIP =
  "Time-weighted: total tokens ÷ total time across requests that reported timings. Native Ollama timings are preferred; /v1 values are estimated from stream timing.";

/**
 * Accepts any payload that carries both native and estimated aggregates; both
 * `SpeedSummary` and `ModelPerformanceEntry` satisfy this shape.
 */
export interface ThroughputInput {
  generationTokensPerSec: number | null;
  prefillTokensPerSec: number | null;
  estimatedGenerationTokensPerSec: number | null;
  estimatedPrefillTokensPerSec: number | null;
  timedRequests: number;
  estimatedRequests: number;
  requests: number;
}

/**
 * Resolved display values for one throughput scope. Native values are always
 * preferred; an estimated value only fills in when native is absent. The two
 * sources are never blended numerically.
 */
export interface ThroughputView {
  /** Native ?? estimated generation rate. */
  generation: number | null;
  /** Native ?? estimated prefill rate. */
  prefill: number | null;
  /** `true` when the displayed generation rate is estimated. */
  generationEstimated: boolean;
  /** `true` when the displayed prefill rate is estimated. */
  prefillEstimated: boolean;
  /** `true` when at least one displayed rate is estimated. */
  anyEstimated: boolean;
  /** (timed + estimated) / requests, clamped to 0–1. */
  coverage: number;
  timedRequests: number;
  estimatedRequests: number;
  totalRequests: number;
}

/**
 * Resolves the native/estimated preference for one scope. Native values win;
 * an estimated value is shown (and flagged) only when native is absent. The
 * two sources are never blended into a single number.
 */
export function resolveThroughput(input: ThroughputInput): ThroughputView {
  const generation =
    input.generationTokensPerSec ?? input.estimatedGenerationTokensPerSec;
  const prefill =
    input.prefillTokensPerSec ?? input.estimatedPrefillTokensPerSec;

  const generationEstimated =
    input.generationTokensPerSec == null &&
    input.estimatedGenerationTokensPerSec != null;
  const prefillEstimated =
    input.prefillTokensPerSec == null &&
    input.estimatedPrefillTokensPerSec != null;

  const timed = input.timedRequests;
  const estimated = input.estimatedRequests;
  const total = input.requests;
  const coverage =
    total > 0 ? Math.min(1, Math.max(0, (timed + estimated) / total)) : 0;

  return {
    generation,
    prefill,
    generationEstimated,
    prefillEstimated,
    anyEstimated: generationEstimated || prefillEstimated,
    coverage,
    timedRequests: timed,
    estimatedRequests: estimated,
    totalRequests: total,
  };
}
