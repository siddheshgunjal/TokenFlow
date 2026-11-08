import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { getBalanceHistory } from "../lib/api";
import { formatMoney, parseDateKey } from "../lib/format";
import type { BalanceSnapshot } from "../lib/types";
import { Icon } from "./Icons";
import { SelectDropdown, type SelectOption } from "./SelectDropdown";

type ChartRange = "month" | "week" | "day";

const RANGE_OPTIONS: Array<SelectOption> = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
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

function formatPointTime(at: number, range: ChartRange): string {
  const date = new Date(at * 1000);
  if (range === "day") {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return shortDate(date);
}

function rangeFor(range: ChartRange, selectedDate: string): RangeBounds {
  // Anchor to the selected day at local noon so DST edges are unambiguous.
  const anchor = parseDateKey(selectedDate);

  if (range === "month") {
    const since = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
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
    const since = startOfWeek(anchor);
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

  const since = startOfDay(anchor);
  const until = new Date(since);
  until.setDate(until.getDate() + 1);

  return {
    since,
    until,
    label: anchor.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    }),
    axis: ["12am", "6am", "12pm", "6pm", "11:59pm"],
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
  selectedDate,
  refreshKey,
}: {
  currency: string;
  /** The selected day (`YYYY-MM-DD`); anchors the Day/Week/Month ranges. */
  selectedDate: string;
  refreshKey: number;
}) {
  const [range, setRange] = useState<ChartRange>("day");
  const [snapshots, setSnapshots] = useState<BalanceSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [hover, setHover] = useState<{ xPct: number; yPct: number } | null>(
    null,
  );
  const [hoverPoint, setHoverPoint] = useState<SeriesPoint | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number>(-1);
  const plotRef = useRef<HTMLDivElement>(null);
  const calendarDay = new Date().toDateString();

  const bounds = useMemo(
    () => rangeFor(range, selectedDate),
    [range, selectedDate, refreshKey, calendarDay],
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
    // Keep 12 units of headroom at the top so the line and current-point
    // dot never spill into the label row above the chart.
    const toY = (value: number) =>
      Math.min(100, Math.max(12, 12 + (1 - (value - low) / (high - low)) * 88));

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
      points: series.map((point) => ({
        x: toX(point.at),
        y: toY(point.value),
      })),
      low: minValue,
      high: maxValue,
    };
  }, [series, since, until]);

  const handleChartHover = (event: MouseEvent<HTMLDivElement>) => {
    if (!chart || series.length === 0) return;
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    let nearest = chart.points[0];
    for (const point of chart.points) {
      if (Math.abs(point.x - x) < Math.abs(nearest.x - x)) nearest = point;
    }
    const index = chart.points.indexOf(nearest);
    setHover({ xPct: nearest.x, yPct: nearest.y });
    setHoverPoint(series[index]);
    setHoverIndex(index);
  };

  const handleChartLeave = () => {
    setHover(null);
    setHoverPoint(null);
    setHoverIndex(-1);
  };

  // Per-sample delta vs the previous point, so spend is visible in the hover
  // tooltip without adding a second series or changing the y-axis.
  const hoverDelta =
    hoverPoint && hoverIndex > 0 && series[hoverIndex - 1]
      ? hoverPoint.value - series[hoverIndex - 1].value
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label">Balance trend</p>
          <p className="text-sm text-muted">{bounds.label}</p>
        </div>
        <div className="relative shrink-0">
          <SelectDropdown
            value={range}
            onChange={(next) => setRange(next as ChartRange)}
            ariaLabel="Balance chart range"
            groups={[{ label: "", options: RANGE_OPTIONS }]}
            minWidth="7rem"
          />
        </div>
      </div>

      {loading ? (
        <div className="mt-3 min-h-[120px] flex-1 animate-pulse rounded-xl border border-white/[0.04] bg-white/[0.025]" />
      ) : error ? (
        <div className="mt-3 flex min-h-[120px] flex-1 flex-col items-center justify-center rounded-xl border border-danger/20 bg-danger/10 px-4 py-5 text-center">
          <Icon name="alert" className="h-4 w-4 text-danger/80" />
          <p className="mt-2 text-xs text-danger/80">
            Could not load balance history
          </p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="mt-2 text-xs text-danger underline-offset-2 hover:underline"
          >
            Try again
          </button>
        </div>
      ) : !chart ? (
        <div className="mt-3 flex min-h-[120px] flex-1 flex-col items-center justify-center rounded-xl border border-white/[0.015] px-4 py-5 text-center">
          <Icon name="activity" className="h-4 w-4 text-muted/70" />
          <p className="mt-2 text-xs text-muted">
            No balance samples for this period
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted">
            TokenFlow records a balance point every time it polls DeepSeek.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-center justify-between text-[12px] text-muted">
            <span>Low {formatMoney(chart.low.toFixed(2), currency)}</span>
            <span>High {formatMoney(chart.high.toFixed(2), currency)}</span>
          </div>

          <div
            ref={plotRef}
            className="relative mt-1.5 min-h-[120px] flex-1 cursor-crosshair"
            onMouseMove={handleChartHover}
            onMouseLeave={handleChartLeave}
          >
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
                  <stop offset="0%" stopColor="#2F6BFF" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="#2F6BFF" stopOpacity="0" />
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
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />

              {hover ? (
                <line
                  x1={hover.xPct}
                  x2={hover.xPct}
                  y1="12"
                  y2="100"
                  stroke="rgba(255,255,255,0.25)"
                  strokeWidth="1"
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </svg>

            <span
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-canvas shadow-[0_0_8px_rgba(0,212,192,0.7)]"
              style={{ left: `${chart.dotX}%`, top: `${chart.dotY}%` }}
            />

            {hover && hoverPoint ? (
              <span
                className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-1 ring-white/50"
                style={{ left: `${hover.xPct}%`, top: `${hover.yPct}%` }}
              />
            ) : null}

            {hover && hoverPoint ? (
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-white/10 bg-[#0b1220]/95 px-2.5 py-1.5 shadow-lg backdrop-blur-sm"
                style={{
                  left: `${Math.max(12, Math.min(hover.xPct, 88))}%`,
                  top: `${hover.yPct}%`,
                  marginTop: "-8px",
                }}
              >
                <p className="whitespace-nowrap text-[11px] font-semibold text-white tabular-nums">
                  {formatMoney(hoverPoint.value.toFixed(2), currency)}
                </p>
                <p className="whitespace-nowrap text-[10px] text-muted">
                  {formatPointTime(hoverPoint.at, range)}
                  {hoverDelta !== null
                    ? ` · ${hoverDelta >= 0 ? "+" : "-"}${formatMoney(
                        Math.abs(hoverDelta).toFixed(2),
                        currency,
                      )} since the previous sample`
                    : ""}
                </p>
              </div>
            ) : null}

            <div className="mt-1.5 flex items-center justify-between text-[12px] text-muted">
              {bounds.axis.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
          </div>

          <div className="mt-1 flex items-center justify-between text-[12px] text-muted">
            <span>Low {formatMoney(chart.low.toFixed(2), currency)}</span>
            <span>High {formatMoney(chart.high.toFixed(2), currency)}</span>
          </div>
        </>
      )}
    </div>
  );
}
