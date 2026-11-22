import { memo, useMemo, useState } from "react";

import { Icon } from "./Icons";
import { SelectDropdown } from "./SelectDropdown";
import {
  RANGE_OPTIONS,
  rangeFor,
  toUnixBounds,
  type ChartRange,
} from "../lib/chartRange";
import { formatTokensPerSecond } from "../lib/format";
import {
  APPROX_TOOLTIP,
  THROUGHPUT_TOOLTIP,
  resolveThroughput,
} from "../lib/throughput";
import { useSpeedSummary } from "../lib/useSpeedSummary";
import type { ThroughputInput } from "../lib/throughput";

/** Zero-valued input used before the current window's summary has loaded. */
const EMPTY_INPUT: ThroughputInput = {
  generationTokensPerSec: null,
  prefillTokensPerSec: null,
  estimatedGenerationTokensPerSec: null,
  estimatedPrefillTokensPerSec: null,
  timedRequests: 0,
  estimatedRequests: 0,
  requests: 0,
};

/**
 * Full-width strip showing overall generation and prefill speed for the window
 * selected by the Day/Week/Month dropdown, anchored to the activity card's
 * selected day (mirroring the DeepSeek balance chart). Native Ollama timings
 * are preferred; when only `/v1` stream estimates exist the values are
 * prefixed `~` and flagged `Approx`.
 */
export const PerformanceStrip = memo(function PerformanceStrip({
  selectedDate,
  refreshKey,
}: {
  /** The activity calendar's selected day (`YYYY-MM-DD`). */
  selectedDate: string;
  /** Data.totals.requests — silently refetches the live window. */
  refreshKey: number;
}) {
  const [range, setRange] = useState<ChartRange>("day");

  const bounds = useMemo(
    () => rangeFor(range, selectedDate),
    [range, selectedDate],
  );
  const { since, until } = useMemo(() => toUnixBounds(bounds), [bounds]);

  const { summary, error, retry } = useSpeedSummary(since, until, refreshKey);

  // Treat a summary from a different window as not-yet-loaded. This is derived
  // during render (not from the effect's `loading` flag) so switching the
  // range never paints the previous window's numbers for a frame.
  const matches =
    summary !== null && summary.since === since && summary.until === until;

  const view = useMemo(
    () => resolveThroughput(matches && summary ? summary : EMPTY_INPUT),
    [matches, summary],
  );

  const pending = !matches && !error;
  const hasTiming = view.timedRequests > 0 || view.estimatedRequests > 0;
  const empty = !pending && !hasTiming;
  const approx = view.anyEstimated;

  const infoTooltip = approx
    ? `${THROUGHPUT_TOOLTIP} ${APPROX_TOOLTIP}`
    : THROUGHPUT_TOOLTIP;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <h2 className="text-base font-semibold text-muted">Model speed</h2>
          <span className="truncate text-xs text-muted">· {bounds.label}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative shrink-0">
            <SelectDropdown
              value={range}
              onChange={(next) => setRange(next as ChartRange)}
              ariaLabel="Model speed range"
              groups={[{ label: "", options: RANGE_OPTIONS }]}
              minWidth="6.5rem"
            />
          </div>
          {pending ? (
            <span className="chip shrink-0 whitespace-nowrap text-muted">
              Loading…
            </span>
          ) : error ? (
            <span className="chip shrink-0 whitespace-nowrap border-danger/20 bg-danger/10 text-danger/80">
              Error
            </span>
          ) : empty ? (
            <span className="chip shrink-0 whitespace-nowrap">
              No timing data
            </span>
          ) : (
            <span className="chip shrink-0 whitespace-nowrap tabular-nums">
              {Math.round(view.coverage * 100)}% timed
            </span>
          )}
          {approx ? (
            <span
              className="chip shrink-0 whitespace-nowrap border-warning/20 bg-warning/10 text-warning/80"
              title={APPROX_TOOLTIP}
            >
              Approx
            </span>
          ) : null}
          <span
            className="grid h-5 w-5 place-items-center text-muted"
            title={infoTooltip}
          >
            <Icon name="info" className="h-4 w-4" />
          </span>
        </div>
      </div>

      {error ? (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-[11px] text-danger/80">
          <Icon name="alert" className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">Could not load model speed.</span>
          <button
            type="button"
            onClick={retry}
            className="shrink-0 underline-offset-2 hover:underline"
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <SpeedMetric
          label="Generation"
          value={view.generation}
          estimated={view.generationEstimated}
          pending={pending}
          windowLabel={bounds.label}
          accentClass="text-accent-blue"
        />
        <SpeedMetric
          label="Prefill"
          value={view.prefill}
          estimated={view.prefillEstimated}
          pending={pending}
          windowLabel={bounds.label}
          accentClass="text-accent"
        />
      </div>

      {empty && !error ? (
        <p className="mt-3 text-xs text-muted">
          Timing data appears after your next Ollama request. Native API
          requests report exact durations; /v1 requests are estimated.
        </p>
      ) : null}
    </section>
  );
});

function SpeedMetric({
  label,
  value,
  estimated,
  pending,
  windowLabel,
  accentClass,
}: {
  label: string;
  value: number | null;
  estimated: boolean;
  pending: boolean;
  windowLabel: string;
  accentClass: string;
}) {
  const display = pending
    ? "…"
    : value == null
      ? "—"
      : formatTokensPerSecond(value);
  const prefix = !pending && estimated ? "~" : "";

  const hint = pending
    ? "Loading…"
    : estimated
      ? `Estimated from stream timing · ${windowLabel}`
      : `Native · ${windowLabel}`;

  return (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-3">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-[0.12em] text-muted">
          {label}
        </span>
        {!pending && estimated ? (
          <span
            className="rounded border border-warning/20 bg-warning/10 px-1 text-[10px] text-warning/80"
            title={APPROX_TOOLTIP}
          >
            Approx
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={`text-2xl font-semibold tabular-nums ${accentClass} ${
            pending ? "animate-pulse" : ""
          }`}
          title={!pending && estimated ? APPROX_TOOLTIP : undefined}
        >
          {prefix}
          {display}
        </span>
        <span className="text-sm text-muted">tok/s</span>
      </div>
      <p
        className="mt-1 truncate text-[11px] text-muted"
        title={!pending && estimated ? APPROX_TOOLTIP : undefined}
      >
        {hint}
      </p>
    </div>
  );
}
