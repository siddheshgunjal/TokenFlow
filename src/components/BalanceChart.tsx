import { useEffect, useMemo, useState } from "react";

import { getBalanceHistory } from "../lib/api";
import { formatMoney } from "../lib/format";
import type { BalanceSnapshot } from "../lib/types";
import { Icon } from "./Icons";

type ChartRange = "month" | "week" | "day";

const RANGE_OPTIONS: Array<{ id: ChartRange; label: string }> = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
];

const MAX_POINTS = 180;

interface SeriesPoint {
  at: number;
  value: number;
}

interface RangeBounds {
  since: Date;
  until: Date;
  label: string;
  axis: string[];
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date): Date {
  const start = startOfDay(date);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function rangeFor(range: ChartRange, monthOffset: number): RangeBounds {
  const now = new Date();

  if (range === "month") {
    const since = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
    const until = new Date(since.getFullYear(), since.getMonth() + 1, 1);
    const lastDay = new Date(since.getFullYear(), since.getMonth() + 1, 0);
    const mid = new Date((since.getTime() + lastDay.getTime()) / 2);

    return {
      since,
      until,
      label: since.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      }),
      axis: [shortDate(since), shortDate(mid), shortDate(lastDay)],
    };
  }

  if (range === "week") {
    const since = startOfWeek(now);
    const until = new Date(since);
    until.setDate(until.getDate() + 7);
    const mid = new Date(since);
    mid.setDate(mid.getDate() + 3);
    const end = new Date(since);
    end.setDate(end.getDate() + 6);

    return {
      since,
      until,
      label: `Week of ${shortDate(since)}`,
      axis: [shortDate(since), shortDate(mid), shortDate(end)],
    };
  }

  const since = startOfDay(now);
  const until = new Date(since);
  until.setDate(until.getDate() + 1);

  return {
    since,
    until,
    label: now.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    }),
    axis: ["12am", "6am", "12pm", "6pm"],
  };
}

function toSeries(
  snapshots: BalanceSnapshot[],
  since: number,
  until: number,
): SeriesPoint[] {
  const points = snapshots
    .map((snapshot) => ({
      at: snapshot.createdAt,
      value: Number.parseFloat(snapshot.totalBalance),
    }))
    .filter((point) => Number.isFinite(point.value))
    .sort((left, right) => left.at - right.at);

  if (points.length <= MAX_POINTS) return points;

  const span = Math.max(1, until - since);
  const bucketSize = span / MAX_POINTS;
  const buckets = new Map<number, SeriesPoint>();

  for (const point of points) {
    const index = Math.min(
      MAX_POINTS - 1,
      Math.max(0, Math.floor((point.at - since) / bucketSize)),
    );
    // Keep the last sample in each bucket so intraday dips are preserved at
    // the right edge of the bucket.
    buckets.set(index, point);
  }

  return Array.from(buckets.entries())
    .sort(([left], [right]) => left - right)
    .map(([, point]) => point);
}

export function BalanceChart({
  currency,
  monthOffset,
  refreshKey,
}: {
  currency: string;
  monthOffset: number;
  refreshKey: number;
}) {
  const [range, setRange] = useState<ChartRange>("month");
  const [snapshots, setSnapshots] = useState<BalanceSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const calendarDay = new Date().toDateString();

  const bounds = useMemo(
    () => rangeFor(range, monthOffset),
    [range, monthOffset, refreshKey, calendarDay],
  );
  const since = Math.floor(bounds.since.getTime() / 1000);
  const until = Math.floor(bounds.until.getTime() / 1000);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getBalanceHistory({ currency, since, until })
      .then((rows) => {
        if (!cancelled) setSnapshots(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        setSnapshots([]);
        setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currency, since, until, refreshKey, attempt]);

  const series = useMemo(
    () => toSeries(snapshots, since, until),
    [snapshots, since, until],
  );

  const chart = useMemo(() => {
    if (series.length === 0) return null;

    const values = series.map((point) => point.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const padding = Math.max(
      (maxValue - minValue) * 0.12,
      maxValue * 0.01,
      0.01,
    );
    const low = Math.max(0, minValue - padding);
    const high = maxValue + padding;
    const span = Math.max(1, until - since);

    const toX = (at: number) =>
      Math.min(100, Math.max(0, ((at - since) / span) * 100));
    const toY = (value: number) =>
      Math.min(100, Math.max(0, 100 - ((value - low) / (high - low)) * 100));

    const commands = series.map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${toX(point.at).toFixed(2)},${toY(
          point.value,
        ).toFixed(2)}`,
    );
    const last = series[series.length - 1];

    return {
      line: commands.join(" "),
      area: `${commands.join(" ")} L${toX(last.at).toFixed(2)},100 L${toX(
        series[0].at,
      ).toFixed(2)},100 Z`,
      dotX: toX(last.at),
      dotY: toY(last.value),
      low: minValue,
      high: maxValue,
    };
  }, [series, since, until]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label">Balance trend</p>
          <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
            {bounds.label}
          </p>
        </div>
        <div className="relative shrink-0">
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as ChartRange)}
            aria-label="Balance chart range"
            className="appearance-none rounded-md border border-white/10 bg-[#0b1220] py-1 pl-2.5 pr-7 text-[10px] font-medium text-slate-300 outline-none transition-colors hover:bg-white/[0.05] focus:border-violet-400/50"
          >
            {RANGE_OPTIONS.map((option) => (
              <option
                key={option.id}
                value={option.id}
                className="bg-[#0b1220] text-slate-200"
              >
                {option.label}
              </option>
            ))}
          </select>
          <Icon
            name="chevron-right"
            className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 rotate-90 text-slate-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="mt-3 min-h-[120px] flex-1 animate-pulse rounded-xl border border-white/[0.04] bg-white/[0.025]" />
      ) : error ? (
        <div className="mt-3 flex min-h-[120px] flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-rose-400/20 bg-rose-500/[0.03] px-4 py-5 text-center">
          <Icon name="alert" className="h-4 w-4 text-rose-300/80" />
          <p className="mt-2 text-xs text-rose-200/80">
            Could not load balance history
          </p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="mt-2 text-[10px] text-rose-300 underline-offset-2 hover:underline"
          >
            Try again
          </button>
        </div>
      ) : !chart ? (
        <div className="mt-3 flex min-h-[120px] flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.015] px-4 py-5 text-center">
          <Icon name="activity" className="h-4 w-4 text-violet-300/70" />
          <p className="mt-2 text-xs text-slate-400">No balance samples yet</p>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-600">
            TokenFlow records a balance point every time it polls DeepSeek.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-center justify-between text-[9px] text-slate-600">
            <span>Low {formatMoney(chart.low.toFixed(2), currency)}</span>
            <span>High {formatMoney(chart.high.toFixed(2), currency)}</span>
          </div>

          <div className="relative mt-1.5 min-h-[120px] flex-1">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full overflow-visible"
              role="img"
              aria-label={`Total available DeepSeek balance for ${bounds.label}`}
            >
              <defs>
                <linearGradient
                  id="balance-area-fill"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.38" />
                  <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
                </linearGradient>
              </defs>

              {[0, 25, 50, 75, 100].map((y) => (
                <line
                  key={y}
                  x1="0"
                  x2="100"
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.05)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ))}

              <path d={chart.area} fill="url(#balance-area-fill)" />
              <path
                d={chart.line}
                fill="none"
                stroke="#c4b5fd"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>

            <span
              className="pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-200 shadow-[0_0_7px_rgba(196,181,253,0.9)]"
              style={{ left: `${chart.dotX}%`, top: `${chart.dotY}%` }}
            />
          </div>

          <div className="mt-1.5 flex items-center justify-between text-[9px] text-slate-600">
            {bounds.axis.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
