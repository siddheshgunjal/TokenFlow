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
    valueLabel: "inference tokens this month",
  },
  {
    id: "input",
    label: "New input",
    description: "new input tokens",
    valueLabel: "new input tokens this month",
  },
  {
    id: "output",
    label: "Output",
    description: "output tokens",
    valueLabel: "output tokens this month",
  },
  {
    id: "context",
    label: "Context",
    description: "total prompt context",
    valueLabel: "context tokens this month",
  },
  {
    id: "cached",
    label: "Cached",
    description: "cached input tokens",
    valueLabel: "cached tokens this month",
  },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

interface DayCell {
  date: Date;
  key: string;
  day: number;
  usage: DailyUsage | undefined;
}

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

function monthsBetween(earlier: Date, later: Date): number {
  return (
    (later.getFullYear() - earlier.getFullYear()) * 12 +
    (later.getMonth() - earlier.getMonth())
  );
}

export function ActivityHeatmap({
  daily,
  streakDays,
  monthOffset,
  onMonthOffsetChange,
}: {
  daily: DailyUsage[];
  streakDays: number;
  monthOffset: number;
  onMonthOffsetChange: (offset: number) => void;
}) {
  const [metric, setMetric] = useState<Metric>("total");

  const metricInfo = METRICS.find((entry) => entry.id === metric) ?? METRICS[0];
  const usageByDate = new Map(daily.map((entry) => [entry.date, entry]));

  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const todayKey = toDateKey(today);

  // The dashboard supplies roughly 365 days of history, so the earliest
  // navigable month is the one containing `today - 364 days`.
  const earliest = new Date(today);
  earliest.setDate(earliest.getDate() - 364);
  const maxMonthOffset = Math.max(0, monthsBetween(earliest, today));

  const activeOffset = Math.min(monthOffset, maxMonthOffset);
  const viewMonth = new Date(
    today.getFullYear(),
    today.getMonth() - activeOffset,
    1,
  );
  const viewYear = viewMonth.getFullYear();
  const viewMonthIndex = viewMonth.getMonth();
  const monthLabel = viewMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const isCurrentMonth = activeOffset === 0;

  const daysInMonth = new Date(viewYear, viewMonthIndex + 1, 0).getDate();
  const leadingBlanks = viewMonth.getDay();

  const monthDays: DayCell[] = Array.from(
    { length: daysInMonth },
    (_, index) => {
      const date = new Date(viewYear, viewMonthIndex, index + 1, 12);
      const key = toDateKey(date);
      return { date, key, day: index + 1, usage: usageByDate.get(key) };
    },
  );

  const monthMax = monthDays.reduce(
    (max, cell) => Math.max(max, valueFor(cell.usage, metric)),
    0,
  );
  const monthTotal = monthDays.reduce(
    (sum, cell) => sum + valueFor(cell.usage, metric),
    0,
  );
  const activeDays = monthDays.filter(
    (cell) => valueFor(cell.usage, metric) > 0,
  ).length;

  const calendarCells: Array<DayCell | null> = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...monthDays,
  ];
  while (calendarCells.length % 7 !== 0) {
    calendarCells.push(null);
  }

  const levelFor = (tokens: number): number => {
    if (tokens <= 0 || monthMax <= 0) return 0;
    const ratio = tokens / monthMax;
    if (ratio <= 0.2) return 1;
    if (ratio <= 0.45) return 2;
    if (ratio <= 0.7) return 3;
    return 4;
  };

  const goToPreviousMonth = () => {
    onMonthOffsetChange(Math.min(maxMonthOffset, activeOffset + 1));
  };

  const goToNextMonth = () => {
    onMonthOffsetChange(Math.max(0, activeOffset - 1));
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
            Daily {metricInfo.description}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-white tabular-nums">
            {formatCompact(monthTotal)}
          </p>
          <p className="text-[11px] text-slate-500">{metricInfo.valueLabel}</p>
        </div>
      </div>

      <div className="mt-3 inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5">
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

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={goToPreviousMonth}
            disabled={activeOffset >= maxMonthOffset}
            aria-label="Previous month"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/[0.06] text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Icon name="chevron-right" className="h-3.5 w-3.5 rotate-180" />
          </button>
          <p className="min-w-[9.5rem] text-center text-base font-semibold text-slate-200">
            {monthLabel}
          </p>
          <button
            type="button"
            onClick={goToNextMonth}
            disabled={isCurrentMonth}
            aria-label="Next month"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/[0.06] text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Icon name="chevron-right" className="h-3.5 w-3.5" />
          </button>
        </div>
        {!isCurrentMonth ? (
          <button
            type="button"
            onClick={() => onMonthOffsetChange(0)}
            className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 text-[10px] font-medium text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
          >
            Today
          </button>
        ) : null}
      </div>

      <div className="mt-3 pb-1">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-slate-600">
          {WEEKDAYS.map((weekday) => (
            <span key={weekday} className="py-1">
              {weekday}
            </span>
          ))}
        </div>

        <div
          className="mt-1 grid grid-cols-7 gap-1"
          role="img"
          aria-label={`Calendar heatmap of daily ${metricInfo.description} for ${monthLabel}`}
        >
          {calendarCells.map((cell, index) => {
            if (!cell) {
              return (
                <div
                  key={`blank-${index}`}
                  className="min-h-[54px] rounded-lg border border-transparent"
                />
              );
            }

            const value = valueFor(cell.usage, metric);
            const isToday = isCurrentMonth && cell.key === todayKey;
            const isFuture = cell.date.getTime() > today.getTime();
            const level = isFuture ? 0 : levelFor(value);
            const levelStyle = isFuture
              ? "border-white/[0.02] bg-transparent"
              : LEVEL_STYLES[metric][level];
            const dayTextClass = isFuture
              ? "text-slate-700"
              : level === 4
                ? "text-slate-900"
                : level === 3
                  ? "text-white/90"
                  : isToday
                    ? "text-teal-200"
                    : "text-slate-400";
            const valueTextClass =
              level === 4
                ? "text-slate-900"
                : level === 3
                  ? "text-white"
                  : "text-slate-300";

            const dateLabel = cell.date.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            const cacheRate =
              cell.usage && cell.usage.inputTokens > 0
                ? cell.usage.cachedInputTokens / cell.usage.inputTokens
                : 0;
            const tooltip = isFuture
              ? `${dateLabel} · upcoming`
              : cell.usage
                ? `${dateLabel} · new in ${formatNumber(
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
                : `${dateLabel} · no usage`;

            return (
              <div
                key={cell.key}
                title={tooltip}
                className={`flex min-h-[54px] min-w-0 flex-col items-start justify-between gap-1 rounded-lg border p-1.5 transition-colors ${levelStyle} ${
                  isToday
                    ? "ring-1 ring-teal-300/60 ring-offset-2 ring-offset-panel"
                    : ""
                }`}
              >
                <span
                  className={`text-[10px] leading-none tabular-nums ${dayTextClass}`}
                >
                  {cell.day}
                </span>
                {cell.usage && !isFuture ? (
                  <span
                    className={`text-[10px] font-semibold leading-none tabular-nums ${valueTextClass}`}
                  >
                    {formatCompact(value)}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-600">
        <span>{activeDays} active days this month</span>
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
