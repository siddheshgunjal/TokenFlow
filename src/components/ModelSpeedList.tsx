import { useMemo } from "react";

import { formatRelative, formatTokensPerSecond } from "../lib/format";
import { APPROX_TOOLTIP, THROUGHPUT_TOOLTIP } from "../lib/throughput";
import { colorForModel, type ModelColor } from "../lib/modelColors";
import type { ModelPerformanceEntry } from "../lib/types";
import { Icon } from "./Icons";

/**
 * The Speed tab of the Models card. Shows per-model generation and prefill
 * tok/s. Estimated speeds are prefixed `~` and flagged on the row.
 */
export function ModelSpeedList({
  entries,
  rangeDays,
  loading,
  error,
  retry,
  modelColors,
}: {
  entries: ModelPerformanceEntry[];
  rangeDays: number;
  loading: boolean;
  error: string | null;
  retry: () => void;
  modelColors: Map<string, ModelColor>;
}) {
  const rows = useMemo(() => sortEntries(entries), [entries]);

  if (loading && rows.length === 0) {
    return <SpeedSkeleton />;
  }

  if (error && rows.length === 0) {
    return (
      <div className="mt-5 flex min-h-0 flex-1 flex-col justify-center text-center">
        <p className="text-sm text-muted">Could not load model speed</p>
        <button
          type="button"
          onClick={retry}
          className="mt-2 btn-secondary border-white/10 text-sm hover:bg-white/5"
        >
          Retry
        </button>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="mt-5 flex min-h-0 flex-1 flex-col justify-center rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
        <p className="text-sm text-muted">No model usage yet</p>
        <p className="mt-1 text-xs text-muted">
          Point an Ollama client at the proxy to populate this list.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
      <table className="w-full text-left text-[12px]">
        <thead>
          <tr className="text-[11px] uppercase tracking-[0.12em] text-muted">
            <th className="px-3 py-2 font-medium">Model</th>
            <th className="px-3 py-2 text-right">Gen tok/s</th>
            <th className="px-3 py-2 text-right">Prefill tok/s</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <SpeedRow
              key={entry.model}
              entry={entry}
              rangeDays={rangeDays}
              modelColors={modelColors}
            />
          ))}
        </tbody>
      </table>
      <p className="mt-3 flex items-center justify-end gap-1 text-[11px] text-muted">
        <span className="inline-flex items-center">
          <Icon name="info" className="h-3.5 w-3.5" />
        </span>
        <span
          className="underline-offset-2 hover:underline"
          title={THROUGHPUT_TOOLTIP}
        >
          Time-weighted · Native Ollama timings preferred · /v1 values are
          estimated
        </span>
      </p>
    </div>
  );
}

function SpeedRow({
  entry,
  rangeDays,
  modelColors,
}: {
  entry: ModelPerformanceEntry;
  rangeDays: number;
  modelColors: Map<string, ModelColor>;
}) {
  if (entry.requests === 0) {
    return (
      <tr className="border-t border-white/[0.04]">
        <td colSpan={3} className="py-2 text-xs text-muted/70">
          No usage in the last {rangeDays} days
        </td>
      </tr>
    );
  }

  const color = colorForModel(modelColors, entry.model);
  const gen = entry.generationTokensPerSec;
  const prefill = entry.prefillTokensPerSec;
  const genEst = gen == null && entry.estimatedGenerationTokensPerSec != null;
  const prefillEst =
    prefill == null && entry.estimatedPrefillTokensPerSec != null;
  const rowApprox = genEst || prefillEst;
  const displayGen = gen ?? entry.estimatedGenerationTokensPerSec ?? null;
  const displayPrefill = prefill ?? entry.estimatedPrefillTokensPerSec ?? null;

  return (
    <tr className="border-t border-white/[0.04]">
      <td className="py-2">
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: color.hex }}
          />
          <span
            className="font-mono"
            title={`${entry.requests} requests · last used ${formatRelative(
              entry.lastSeenAt,
            )}`}
          >
            {entry.model}
          </span>
          {rowApprox && <ApproxBadge />}
        </span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <span
          title={genEst ? APPROX_TOOLTIP : undefined}
          className={genEst ? "text-warning/70" : ""}
        >
          {displayGen == null
            ? "—"
            : `${genEst ? "~" : ""}${formatTokensPerSecond(displayGen)}`}
        </span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <span
          title={prefillEst ? APPROX_TOOLTIP : undefined}
          className={prefillEst ? "text-warning/70" : ""}
        >
          {displayPrefill == null
            ? "—"
            : `${prefillEst ? "~" : ""}${formatTokensPerSecond(
                displayPrefill,
              )}`}
        </span>
      </td>
    </tr>
  );
}

/**
 * Sorts models per the Speed tab ordering. Active models (any usage) come
 * first; ties break by resolved generation, prefill, total tokens and name.
 */
export function sortEntries(
  entries: ModelPerformanceEntry[],
): ModelPerformanceEntry[] {
  const resolvedGen = (entry: ModelPerformanceEntry): number | null =>
    entry.generationTokensPerSec ??
    entry.estimatedGenerationTokensPerSec ??
    null;
  const resolvedPrefill = (entry: ModelPerformanceEntry): number | null =>
    entry.prefillTokensPerSec ?? entry.estimatedPrefillTokensPerSec ?? null;

  return [...entries].sort((a, b) => {
    const aActive = a.requests > 0;
    const bActive = b.requests > 0;
    if (aActive !== bActive) return bActive ? 1 : -1;
    if (!aActive && !bActive) {
      if (b.lastSeenAt !== a.lastSeenAt) return b.lastSeenAt - a.lastSeenAt;
      return a.model.localeCompare(b.model);
    }

    const gen = (resolvedGen(b) ?? -Infinity) - (resolvedGen(a) ?? -Infinity);
    if (gen !== 0) return gen;

    const prefill =
      (resolvedPrefill(b) ?? -Infinity) - (resolvedPrefill(a) ?? -Infinity);
    if (prefill !== 0) return prefill;

    if (a.totalTokens !== b.totalTokens) return b.totalTokens - a.totalTokens;
    return a.model.localeCompare(b.model);
  });
}

function ApproxBadge() {
  return (
    <span className="rounded border border-warning/20 bg-warning/10 px-1.5 text-[10px] text-warning/80">
      Approx
    </span>
  );
}

function SpeedSkeleton() {
  return (
    <div className="mt-5 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <div className="h-3 w-1/3 rounded bg-white/[0.04]" />
          <div className="h-3 w-1/6 rounded bg-white/[0.04]" />
          <div className="h-3 w-1/6 rounded bg-white/[0.04]" />
        </div>
      ))}
    </div>
  );
}
