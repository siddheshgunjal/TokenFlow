import { useId, useMemo, useRef, useState, type MouseEvent } from "react";

import { formatCompact } from "../lib/format";

export interface HourlyChartSeries {
  id: string;
  label: string;
  color: string;
  /** Always 24 values, one per local hour (0–23). */
  values: number[];
}

const HOUR_LABELS = ["12am", "6am", "12pm", "6pm", "11pm"];

/**
 * A plain-SVG hourly line/area chart, tailored to usage. A single series
 * renders an area + line; multiple series (Top 5) render lines on one shared
 * y-scale with no overlapping fills.
 */
export function HourlyUsageChart({
  series,
  ariaLabel,
}: {
  series: HourlyChartSeries[];
  ariaLabel: string;
}) {
  const gradientId = useId();
  const plotRef = useRef<HTMLDivElement>(null);
  const [hoverHour, setHoverHour] = useState<number | null>(null);

  // Shared y-scale across all series, from 0 to the maximum value.
  const max = useMemo(
    () => series.reduce((peak, s) => Math.max(peak, ...s.values), 0),
    [series],
  );

  // A little headroom at the top so the highest dot is not clipped.
  const TOP = 6;
  const toX = (hour: number) => (hour / 23) * 100;
  const toY = (value: number) =>
    max > 0 ? 100 - (value / max) * (100 - TOP) : 100;

  const paths = useMemo(
    () =>
      series.map((s) => {
        const line = s.values
          .map((value, hour) => {
            const x = toX(hour).toFixed(2);
            const y = toY(value).toFixed(2);
            return `${hour === 0 ? "M" : "L"}${x},${y}`;
          })
          .join(" ");
        const area = `${line} L${toX(23).toFixed(2)},100 L${toX(0).toFixed(2)},100 Z`;
        return { line, area };
      }),
    [series, max],
  );

  const handleMove = (event: MouseEvent<HTMLDivElement>) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const hour = Math.round((x / 100) * 23);
    setHoverHour(Math.max(0, Math.min(23, hour)));
  };

  const isMulti = series.length > 1;

  const tooltipEntries = useMemo(() => {
    if (hoverHour === null) return null;
    return series
      .map((s) => ({
        label: s.label,
        color: s.color,
        value: s.values[hoverHour],
      }))
      .sort((left, right) => right.value - left.value);
  }, [hoverHour, series]);

  return (
    <div className="flex min-h-0 flex-col">
      {isMulti ? (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {series.map((s) => (
            <span
              key={s.id}
              className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="max-w-[7.5rem] truncate" title={s.label}>
                {s.label}
              </span>
              <span className="tabular-nums text-muted/80">
                {formatCompact(s.values.reduce((sum, v) => sum + v, 0))}
              </span>
            </span>
          ))}
        </div>
      ) : null}

      <div
        ref={plotRef}
        className="relative min-h-[140px] flex-1 cursor-crosshair"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverHour(null)}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          role="img"
          aria-label={ariaLabel}
        >
          {series.length === 1 ? (
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={series[0].color}
                  stopOpacity="0.32"
                />
                <stop
                  offset="100%"
                  stopColor={series[0].color}
                  stopOpacity="0"
                />
              </linearGradient>
            </defs>
          ) : null}

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

          {series.map((s, index) =>
            series.length === 1 ? (
              <g key={s.id}>
                <path d={paths[index].area} fill={`url(#${gradientId})`} />
                <path
                  d={paths[index].line}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ) : (
              <path
                key={s.id}
                d={paths[index].line}
                fill="none"
                stroke={s.color}
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ),
          )}

          {hoverHour !== null ? (
            <line
              x1={toX(hoverHour)}
              x2={toX(hoverHour)}
              y1="0"
              y2="100"
              stroke="rgba(255,255,255,0.25)"
              strokeWidth="1"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}

          {hoverHour !== null
            ? series.map((s) => (
                <circle
                  key={s.id}
                  cx={toX(hoverHour)}
                  cy={toY(s.values[hoverHour])}
                  r="2"
                  fill={s.color}
                  stroke="rgba(0,0,0,0.5)"
                  strokeWidth="0.75"
                  vectorEffect="non-scaling-stroke"
                />
              ))
            : null}
        </svg>

        {tooltipEntries ? (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-white/10 bg-[#0b1220]/95 px-2.5 py-1.5 shadow-lg backdrop-blur-sm"
            style={{
              left: `${Math.max(12, Math.min(toX(hoverHour!), 88))}%`,
              top: `${Math.min(...tooltipEntries.map((e) => toY(e.value)))}%`,
              marginTop: "-8px",
            }}
          >
            <p className="whitespace-nowrap text-[10px] font-medium text-muted">
              {hourLabel(hoverHour!)}
            </p>
            {tooltipEntries.map((entry) => (
              <div
                key={entry.label}
                className="flex items-center gap-1.5 whitespace-nowrap text-[11px] tabular-nums"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-muted">{entry.label}</span>
                <span className="ml-auto font-semibold text-white">
                  {formatCompact(entry.value)}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-1.5 flex items-center justify-between text-[12px] text-muted">
          {HOUR_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function hourLabel(hour: number): string {
  const period = hour < 12 ? "am" : "pm";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${period}`;
}
