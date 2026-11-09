import { memo, useState } from "react";

import { DayDetailPanel } from "./DayDetailPanel";
import {
  formatCompact,
  formatNumber,
  formatPercent,
  toDateKey,
} from "../lib/format";
import { type ModelColor } from "../lib/modelColors";
import type { DailyUsage, ModelUsage } from "../lib/types";
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
    description: "Inference tokens (new input + output)",
    valueLabel: "Inference tokens this month",
  },
  {
    id: "input",
    label: "New input",
    description: "New input tokens",
    valueLabel: "New input tokens this month",
  },
  {
    id: "output",
    label: "Output",
    description: "Output tokens",
    valueLabel: "Output tokens this month",
  },
  {
    id: "utilization",
    label: "Cache rate",
    description: "Cache utilization (cached ÷ prompt)",
    valueLabel: "token-weighted cache rate this month",
  },
];

const LEVEL_STYLES: Record<Metric, string[]> = {
  total: [
    "border-white/[0.03] bg-white/[0.04]",
    "bg-accent/[0.07] border-accent/25 text-accent ring-accent/25",
    "bg-accent/[0.18] border-accent/40 text-accent ring-accent/40",
    "bg-data-cyan/[0.30] border-data-cyan/55 text-data-cyan ring-data-cyan/55",
    "bg-accent/[0.55] border-accent-hover/75 text-accent-hover ring-accent-hover/75",
  ],
  input: [
    "border-white/[0.03] bg-white/[0.04]",
    "bg-success/[0.07] border-success/25 text-success ring-success/25",
    "bg-success/[0.18] border-success/40 text-success ring-success/40",
    "bg-[#4ade80]/[0.30] border-[#4ade80]/55 text-[#4ade80] ring-[#4ade80]/55",
    "bg-[#86efac]/[0.55] border-[#86efac]/75 text-[#86efac] ring-[#86efac]/75",
  ],
  output: [
    "border-white/[0.03] bg-white/[0.04]",
    "bg-accent-blue/[0.07] border-accent-blue/25 text-accent-blue ring-accent-blue/25",
    "bg-accent-blue/[0.18] border-accent-blue/40 text-accent-blue ring-accent-blue/40",
    "bg-[#60a5fa]/[0.30] border-[#60a5fa]/55 text-[#60a5fa] ring-[#60a5fa]/55",
    "bg-[#93c5fd]/[0.55] border-[#93c5fd]/75 text-[#93c5fd] ring-[#93c5fd]/75",
  ],
  utilization: [
    "border-white/[0.03] bg-white/[0.04]",
    "bg-[#a78bfa]/[0.07] border-[#a78bfa]/25 text-[#a78bfa] ring-[#a78bfa]/25",
    "bg-[#a78bfa]/[0.18] border-[#a78bfa]/40 text-[#a78bfa] ring-[#a78bfa]/40",
    "bg-[#c4b5fd]/[0.30] border-[#c4b5fd]/55 text-[#c4b5fd] ring-[#c4b5fd]/55",
    "bg-[#e9d5ff]/[0.55] border-[#e9d5ff]/75 text-[#e9d5ff] ring-[#e9d5ff]/75",
  ],
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Memoized on its props: the reconciliation in the snapshot hook keeps
// unchanged `daily`/`models` slices (and the memoized `modelColors`)
// referentially stable, so a DeepSeek-only refresh skips the calendar grid.
export const ActivityHeatmap = memo(function ActivityHeatmap({
  daily,
  streakDays,
  monthOffset,
  onMonthOffsetChange,
  onGoToToday,
  selectedDate,
  onSelectDate,
  models,
  modelColors,
  detailRefreshKey,
  modelMutationKey,
}: {
  daily: DailyUsage[];
  streakDays: number;
  monthOffset: number;
  onMonthOffsetChange: (offset: number) => void;
  /** Always selects today; kept separate from month navigation. */
  onGoToToday: () => void;
  /** The selected day (`YYYY-MM-DD`); always present. */
  selectedDate: string;
  onSelectDate: (date: string) => void;
  models: ModelUsage[];
  modelColors: Map<string, ModelColor>;
  /** The core revision; used to refetch today's detail as usage arrives. */
  detailRefreshKey: number;
  modelMutationKey: number;
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
            onClick={onGoToToday}
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
          role="group"
          aria-label={`Select a day for hourly detail in ${monthLabel}`}
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
            const isSelected = cell.key === selectedDate;
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
              <button
                key={cell.key}
                type="button"
                disabled={isFuture}
                onClick={() => onSelectDate(cell.key)}
                title={tooltip}
                aria-pressed={isSelected}
                aria-label={
                  isFuture
                    ? `${dateLabel}, upcoming`
                    : `Select ${dateLabel} for hourly detail`
                }
                className={`flex min-h-[60px] min-w-0 flex-col items-start justify-between gap-1 rounded-lg border text-left transition-shadow ${
                  levelStyle
                } ${isToday ? "ring-1 ring-accent/60 ring-offset-panel" : ""} ${
                  isSelected
                    ? "relative z-10 outline outline-2 outline-accent outline-offset-2"
                    : ""
                } ${
                  isFuture
                    ? "cursor-not-allowed"
                    : isSelected
                      ? "cursor-pointer"
                      : "cursor-pointer hover:brightness-125"
                }`}
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
              </button>
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

      <div className="mt-4 border-t border-white/[0.06] pt-4">
        <DayDetailPanel
          date={selectedDate}
          models={models}
          modelColors={modelColors}
          refreshKey={detailRefreshKey}
          modelMutationKey={modelMutationKey}
        />
      </div>
    </section>
  );
});

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
