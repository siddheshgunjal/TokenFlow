import { useState } from "react";

import {
  formatCompact,
  formatNumber,
  formatPercent,
  toDateKey,
} from "../lib/format";
import type { DailyUsage } from "../lib/types";
import { Icon } from "./Icons";

type Metric = "total" | "input" | "output" | "utilization";

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

const LEVEL_STYLES: Record<Metric, string[]> = {
  total: [
    "border-white/[0.03] bg-white/[0.04]",
    "bg-accent/5 border-accent/20 text-accent ring-accent/20",
    "bg-accent/10 border-accent/30 text-accent ring-accent/30",
    "bg-accent/15 border-accent/40 text-accent ring-accent/40",
    "bg-accent/20 border-accent/50 text-accent ring-accent/50",
  ],
  input: [
    "border-white/[0.03] bg-white/[0.04]",
    "bg-accent/5 border-accent/20 text-accent ring-accent/20",
    "bg-accent/10 border-accent/30 text-accent ring-accent/30",
    "bg-accent/15 border-accent/40 text-accent ring-accent/40",
    "bg-accent/20 border-accent/50 text-accent ring-accent/50",
  ],
  output: [
    "border-white/[0.03] bg-white/[0.04]",
    "bg-accent-blue/5 border-accent-blue/20 text-accent-blue ring-accent-blue/20",
    "bg-accent-blue/10 border-accent-blue/30 text-accent-blue ring-accent-blue/30",
    "bg-accent-blue/15 border-accent-blue/40 text-accent-blue ring-accent-blue/40",
    "bg-accent-blue/20 border-accent-blue/50 text-accent-blue ring-accent-blue/50",
  ],
  context: [
    "border-white/[0.03] bg-white/[0.04]",
    "bg-warning/5 border-warning/20 text-warning ring-warning/20",
    "bg-warning/10 border-warning/30 text-warning ring-warning/30",
    "bg-warning/15 border-warning/40 text-warning ring-warning/40",
    "bg-warning/20 border-warning/50 text-warning ring-warning/50",
  ],
  cached: [
    "border-white/[0.03] bg-white/[0.04]",
    "bg-accent-strong/5 border-accent-strong/20 text-accent-strong ring-accent-strong/20",
    "bg-accent-strong/10 border-accent-strong/30 text-accent-strong ring-accent-strong/30",
    "bg-accent-strong/15 border-accent-strong/40 text-accent-strong ring-accent-strong/40",
    "bg-accent-strong/20 border-accent-strong/50 text-accent-strong ring-accent-strong/50",
  ],
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
  const monthProcessedContext = monthDays.reduce(
    (sum, cell) => sum + (cell.usage?.contextProcessedTokens ?? 0),
    0,
  );
  const monthProcessedCached = monthDays.reduce(
    (sum, cell) => sum + (cell.usage?.cachedProcessedTokens ?? 0),
    0,
  );
  const monthUtilization =
    monthProcessedContext > 0
      ? monthProcessedCached / monthProcessedContext
      : 0;
  const summaryValue = metric === "utilization" ? monthUtilization : monthTotal;
  const activeDays = monthDays.filter(
    (cell) => (cell.usage?.requests ?? 0) > 0,
  ).length;

  const calendarCells: Array<DayCell | null> = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...monthDays,
  ];
  while (calendarCells.length % 7 !== 0) {
    calendarCells.push(null);
  }

  const levelFor = (value: number): number => {
    if (metric === "utilization") {
      if (value <= 0) return 0;
      if (value <= 0.25) return 1;
      if (value <= 0.5) return 2;
      if (value <= 0.75) return 3;
      return 4;
    }
    if (value <= 0 || monthMax <= 0) return 0;
    const ratio = value / monthMax;
    if (ratio <= 0.2) return 1;
    if (ratio <= 0.45) return 2;
    if (ratio <= 0.7) return 3;
    return 4;
  };

  const formatMetricValue = (value: number): string =>
    metric === "utilization" ? formatPercent(value) : formatCompact(value);

  interface DayCell {
    date: Date;
    key: string;
    day: number;
    usage: DailyUsage | undefined;
  }

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
            <h2 className="text-base font-semibold text-ink">Activity</h2>
            {streakDays > 0 ? (
              <span className="chip border-warning/15 bg-warning/5 text-warning/80">
                <Icon name="zap" className="h-3 w-3" />
                {streakDays}-day streak
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted">
            Daily {metricInfo.description}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-white tabular-nums">
            {formatMetricValue(summaryValue)}
          </p>
          <p className="text-[11px] text-muted">{metricInfo.valueLabel}</p>
        </div>
      </div>

      <div className="mt-3 inline-flex flex-wrap items-center justify-between gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5">
        {METRICS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setMetric(entry.id)}
            className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
              metric === entry.id
                ? "bg-white/[0.08] text-white shadow-sm"
                : "text-muted hover:text-ink"
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
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/[0.06] text-muted transition-colors hover:bg-white/[0.05] hover:text-muted disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Icon name="chevron-right" className="h-3.5 w-3.5 rotate-180" />
          </button>
          <p className="min-w-[9.5rem] text-center text-base font-semibold text-ink">
            {monthLabel}
          </p>
          <button
            type="button"
            onClick={goToNextMonth}
            disabled={isCurrentMonth}
            aria-label="Next month"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/[0.06] text-muted transition-colors hover:bg-white/[0.05] hover:text-muted disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Icon name="chevron-right" className="h-3.5 w-3.5" />
          </button>
        </div>
        {!isCurrentMonth ? (
          <button
            type="button"
            onClick={() => onMonthOffsetChange(0)}
            className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 text-[12px] font-medium text-muted transition-colors hover:bg-white/[0.06] hover:text-muted"
          >
            Today
          </button>
        ) : null}
      </div>

      <div className="mt-3 pb-1">
        <div className="grid grid-cols-7 gap-1 text-center text-[12px] font-medium uppercase tracking-[0.12em] text-muted">
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
                  className="min-h-[60px] rounded-lg border-transparent"
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
              : level >= 3 || isToday
                ? "text-white"
                : "text-muted";
            const valueTextClass = level >= 3 ? "text-white" : "text-muted";

            const dateLabel = cell.date.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            const tooltip = isFuture
              ? `${dateLabel} · upcoming`
              : cell.usage
                ? `${dateLabel} · new in ${formatNumber(
                    cell.usage.newInputTokens,
                  )} · out ${formatNumber(
                    cell.usage.outputTokens,
                  )} · peak context ${formatNumber(
                    cell.usage.contextTokens,
                  )} (${formatNumber(
                    cell.usage.cachedInputTokens,
                  )} cached) · cache ${formatPercent(
                    cell.usage.cacheHitRate,
                  )} · ${formatNumber(cell.usage.requests)} requests`
                : `${dateLabel} · no usage`;

            return (
              <div
                key={cell.key}
                title={tooltip}
                className={`flex min-h-[60px] min-w-0 flex-col items-start justify-between gap-1 rounded-lg border ${
                  levelStyle
                } ${isToday ? "ring-1 ring-accent/60 ring-offset-panel" : ""}`}
              >
                <span
                  className={`text-[12px] leading-none tabular-nums ${dayTextClass}`}
                  style={{ paddingTop: "6px", paddingLeft: "6px" }}
                >
                  {cell.day}
                </span>
                {cell.usage && !isFuture ? (
                  <span
                    className={`text-[12px] font-semibold leading-none tabular-nums ${valueTextClass}`}
                    style={{ paddingBottom: "6px", paddingLeft: "6px" }}
                  >
                    {formatMetricValue(value)}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
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

function valueFor(day: DailyUsage | undefined, metric: Metric): number {
  if (!day) return 0;
  switch (metric) {
    case "input":
      return day.newInputTokens;
    case "output":
      return day.outputTokens;
    case "utilization":
      return day.cacheHitRate;
    default:
      return day.totalTokens;
  }
}

function monthsBetween(earlier: Date, later: Date): number {
  return (
    (later.getFullYear() - earlier.getFullYear()) * 12 +
    (later.getMonth() - earlier.getMonth())
  );
}
