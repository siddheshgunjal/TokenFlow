import { useState } from "react";

import {
  formatCompact,
  formatNumber,
  formatPercent,
  inferenceTokens,
  toDateKey,
  uncachedInputTokens,
} from "../lib/format";
import type { DailyUsage } from "../lib/types";
import { Icon } from "./Icons";

interface HeatCell {
  date: Date;
  key: string;
  usage: DailyUsage | undefined;
}

type Metric = "total" | "input" | "output" | "cached" | "context";

const METRICS: Array<{
  id: Metric;
  label: string;
  description: string;
  valueLabel: string;
}> = [
  {
    id: "total",
    label: "All",
    description: "inference tokens (new input + output)",
    valueLabel: "inference tokens this year",
  },
  {
    id: "input",
    label: "New input",
    description: "new input tokens",
    valueLabel: "new input tokens this year",
  },
  {
    id: "output",
    label: "Output",
    description: "output tokens",
    valueLabel: "output tokens this year",
  },
  {
    id: "context",
    label: "Context",
    description: "total prompt context",
    valueLabel: "context tokens this year",
  },
  {
    id: "cached",
    label: "Cached",
    description: "cached input tokens",
    valueLabel: "cached tokens this year",
  },
];

const LEVEL_STYLES: Record<Metric, string[]> = {
  total: [
    "border-white/[0.03] bg-white/[0.04]",
    "border-teal-900/40 bg-teal-950/90",
    "border-teal-700/40 bg-teal-800",
    "border-teal-500/40 bg-teal-600",
    "border-teal-300/40 bg-teal-400",
  ],
  input: [
    "border-white/[0.03] bg-white/[0.04]",
    "border-teal-900/40 bg-teal-950/90",
    "border-teal-700/40 bg-teal-800",
    "border-teal-500/40 bg-teal-600",
    "border-teal-300/40 bg-teal-400",
  ],
  output: [
    "border-white/[0.03] bg-white/[0.04]",
    "border-sky-900/40 bg-sky-950/90",
    "border-sky-700/40 bg-sky-800",
    "border-sky-500/40 bg-sky-600",
    "border-sky-300/40 bg-sky-400",
  ],
  context: [
    "border-white/[0.03] bg-white/[0.04]",
    "border-amber-900/40 bg-amber-950/90",
    "border-amber-700/40 bg-amber-800",
    "border-amber-500/40 bg-amber-600",
    "border-amber-300/40 bg-amber-400",
  ],
  cached: [
    "border-white/[0.03] bg-white/[0.04]",
    "border-violet-900/40 bg-violet-950/90",
    "border-violet-700/40 bg-violet-800",
    "border-violet-500/40 bg-violet-600",
    "border-violet-300/40 bg-violet-400",
  ],
};

function valueFor(day: DailyUsage | undefined, metric: Metric): number {
  if (!day) return 0;
  switch (metric) {
    case "input":
      return uncachedInputTokens(day.inputTokens, day.cachedInputTokens);
    case "output":
      return day.outputTokens;
    case "cached":
      return day.cachedInputTokens;
    case "context":
      return day.inputTokens;
    default:
      return inferenceTokens(
        day.inputTokens,
        day.cachedInputTokens,
        day.outputTokens,
      );
  }
}

export function ActivityHeatmap({
  daily,
  streakDays,
}: {
  daily: DailyUsage[];
  streakDays: number;
}) {
  const [metric, setMetric] = useState<Metric>("total");
  const metricInfo = METRICS.find((entry) => entry.id === metric) ?? METRICS[0];
  const usageByDate = new Map(daily.map((entry) => [entry.date, entry]));
  const maxValue = daily.reduce(
    (max, entry) => Math.max(max, valueFor(entry, metric)),
    0,
  );
  const totalValue = daily.reduce(
    (sum, entry) => sum + valueFor(entry, metric),
    0,
  );

  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 364);

  const cells: Array<HeatCell | null> = Array.from(
    { length: start.getDay() },
    () => null,
  );

  for (let offset = 0; offset < 365; offset += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + offset);
    const key = toDateKey(date);
    cells.push({ date, key, usage: usageByDate.get(key) });
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const weeks = cells.length / 7;
  const monthLabels: Array<{ week: number; label: string }> = [];
  let previousMonth = -1;

  for (let week = 0; week < weeks; week += 1) {
    const first = cells[week * 7];
    if (!first) continue;

    const month = first.date.getMonth();
    if ((week === 0 || first.date.getDate() <= 7) && month !== previousMonth) {
      monthLabels.push({
        week,
        label: first.date.toLocaleDateString(undefined, { month: "short" }),
      });
      previousMonth = month;
    }
  }

  const levelFor = (tokens: number): number => {
    if (tokens <= 0 || maxValue <= 0) return 0;
    const ratio = tokens / maxValue;
    if (ratio <= 0.2) return 1;
    if (ratio <= 0.45) return 2;
    if (ratio <= 0.7) return 3;
    return 4;
  };

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-200">Activity</h2>
            {streakDays > 0 ? (
              <span className="chip border-amber-400/15 bg-amber-400/[0.05] text-amber-200/80">
                <Icon name="zap" className="h-3 w-3" />
                {streakDays}-day streak
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Daily {metricInfo.description} across the last 365 days
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-white tabular-nums">
            {formatCompact(totalValue)}
          </p>
          <p className="text-[11px] text-slate-500">{metricInfo.valueLabel}</p>
        </div>
      </div>

      <div className="mt-3 inline-flex flex-wrap gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5">
        {METRICS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setMetric(entry.id)}
            className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors ${
              metric === entry.id
                ? "bg-white/[0.08] text-white shadow-sm"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto pb-1">
        <div className="flex min-w-[520px] gap-2">
          <div className="flex shrink-0 flex-col gap-[2px] pt-[20px] text-[9px] leading-[11px] text-slate-600">
            {["", "Mon", "", "Wed", "", "Fri", ""].map((label, index) => (
              <span key={index} className="h-[11px] w-7">
                {label}
              </span>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            <div
              className="mb-1 grid gap-[2px] text-[10px] leading-4 text-slate-500"
              style={{
                gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`,
              }}
            >
              {monthLabels.map((label) => (
                <span
                  key={`${label.week}-${label.label}`}
                  style={{ gridColumnStart: label.week + 1 }}
                  className="whitespace-nowrap"
                >
                  {label.label}
                </span>
              ))}
            </div>

            <div
              className="grid grid-flow-col grid-rows-7 gap-[2px]"
              style={{
                gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`,
              }}
              role="img"
              aria-label={`Calendar heatmap of daily ${metricInfo.description}`}
            >
              {cells.map((cell, index) => {
                if (!cell) {
                  return (
                    <div key={`blank-${index}`} className="h-[11px] w-full" />
                  );
                }

                const value = valueFor(cell.usage, metric);
                const label = cell.date.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                });
                const cacheRate =
                  cell.usage && cell.usage.inputTokens > 0
                    ? cell.usage.cachedInputTokens / cell.usage.inputTokens
                    : 0;
                const tooltip = cell.usage
                  ? `${label} · new in ${formatNumber(
                      uncachedInputTokens(
                        cell.usage.inputTokens,
                        cell.usage.cachedInputTokens,
                      ),
                    )} · context ${formatNumber(
                      cell.usage.inputTokens,
                    )} · out ${formatNumber(
                      cell.usage.outputTokens,
                    )} · cached ${formatPercent(cacheRate)} (${formatNumber(
                      cell.usage.cachedInputTokens,
                    )}) · ${formatNumber(cell.usage.requests)} requests`
                  : `${label} · no usage`;

                return (
                  <div
                    key={cell.key}
                    title={tooltip}
                    className={`h-[11px] w-full rounded-[2px] border transition-transform duration-150 hover:scale-125 ${LEVEL_STYLES[metric][levelFor(value)]}`}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-600">
        <span>
          {daily.filter((entry) => valueFor(entry, metric) > 0).length} active
          days
        </span>
        <div className="flex items-center gap-1.5">
          <span>Less</span>
          {LEVEL_STYLES[metric].map((level) => (
            <span
              key={level}
              className={`h-[10px] w-[10px] rounded-[2px] border ${level}`}
            />
          ))}
          <span>More</span>
        </div>
      </div>
    </section>
  );
}
