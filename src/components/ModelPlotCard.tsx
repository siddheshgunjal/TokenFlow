import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { formatPercent, formatTokensPerSecond } from "../lib/format";
import { colorForModel, type ModelColor } from "../lib/modelColors";
import type { ModelPerformanceEntry, ModelUsage } from "../lib/types";
import { Icon } from "./Icons";

/** Fixed plot area measured from the container; both axes are measured. */
const MARGIN = { top: 12, right: 14, bottom: 30, left: 46 };

interface Hover {
  /** Center x of the hovered element, in plot px. */
  x: number;
  /** Center y of the hovered element, in plot px. */
  y: number;
  title: string;
  lines: string[];
}

/** Short axis label: the tag after `:` when present, else a truncated name. */
function shortLabel(model: string): string {
  const idx = model.indexOf(":");
  if (idx >= 0) return model.slice(idx + 1);
  return model.length > 10 ? `${model.slice(0, 9)}…` : model;
}

export function ModelPlotCard({
  tab,
  models,
  performance,
  modelColors,
  rangeDays,
  loading,
  error,
  retry,
}: {
  tab: "usage" | "speed";
  models: ModelUsage[];
  performance: ModelPerformanceEntry[];
  modelColors: Map<string, ModelColor>;
  rangeDays: number;
  loading: boolean;
  error: string | null;
  retry: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
      setHeight(entries[0].contentRect.height);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const plotW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotH = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const isSpeed = tab === "speed";

  const subtitle = isSpeed
    ? `Gen vs prefill speed · last ${rangeDays} days`
    : "Cache hit rate by model";

  // ---- Usage tab: bar chart of cache hit rate, in Usage-list order ----
  const bars = useMemo(
    () =>
      models.map((model) => ({
        model: model.model,
        rate: model.cacheHitRate,
        color: colorForModel(modelColors, model.model).hex,
      })),
    [models, modelColors],
  );

  // ---- Speed tab: scatter of resolved gen (x) vs prefill (y, log) ----
  const dots = useMemo(() => {
    return performance
      .map((entry) => {
        const gen =
          entry.generationTokensPerSec ?? entry.estimatedGenerationTokensPerSec;
        const prefill =
          entry.prefillTokensPerSec ?? entry.estimatedPrefillTokensPerSec;
        const genEstimated = entry.generationTokensPerSec == null;
        const prefillEstimated = entry.prefillTokensPerSec == null;
        // A 2-D point needs both axes; estimated values are plotted too.
        if (gen == null || prefill == null) return null;
        return {
          model: entry.model,
          gen,
          prefill,
          estimated: genEstimated || prefillEstimated,
          color: colorForModel(modelColors, entry.model).hex,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
  }, [performance, modelColors]);

  const speedDomains = useMemo(() => {
    const gens = dots.map((d) => d.gen);
    const prefs = dots.map((d) => d.prefill);
    const xMax = Math.max(1, ...gens) * 1.15;
    let logMin = Math.log10(Math.min(...prefs));
    let logMax = Math.log10(Math.max(...prefs));
    if (logMax - logMin < 1) {
      const mid = (logMin + logMax) / 2;
      logMin = mid - 0.5;
      logMax = mid + 0.5;
    }
    logMin -= 0.15;
    logMax += 0.15;
    return { xMax, logMin, logMax };
  }, [dots]);

  const speedTicks = useMemo(() => {
    const ticks: number[] = [];
    for (
      let e = Math.ceil(speedDomains.logMin);
      e <= Math.floor(speedDomains.logMax);
      e += 1
    ) {
      ticks.push(Math.pow(10, e));
    }
    return ticks;
  }, [speedDomains]);

  const xToPx = (gen: number): number =>
    MARGIN.left + (gen / speedDomains.xMax) * plotW;
  const yToPx = (prefill: number): number =>
    MARGIN.top +
    (1 -
      (Math.log10(prefill) - speedDomains.logMin) /
        (speedDomains.logMax - speedDomains.logMin)) *
      plotH;

  // ---- Bar geometry ----
  const barYMax = 1; // cache rate is 0..1
  const barToY = (rate: number): number =>
    MARGIN.top + (1 - rate / barYMax) * plotH;
  const band = bars.length > 0 ? plotW / bars.length : 0;
  const barW = Math.min(band * 0.6, 48);

  const showLoading = isSpeed && loading && dots.length === 0;
  const showError = isSpeed && error && dots.length === 0;
  const isEmpty =
    (isSpeed && dots.length === 0) || (!isSpeed && bars.length === 0);

  return (
    <section className="card flex h-full min-h-0 flex-col p-5">
      <div className="flex items-start justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-muted">Visualization</h2>
          <p className="mt-1 text-xs text-muted">{subtitle}</p>
        </div>
        {isSpeed && (
          <span
            className="chip shrink-0 whitespace-nowrap"
            title="Estimated (/v1) points are shown as dashed rings."
          >
            {dots.length} plotted
          </span>
        )}
      </div>

      {showLoading ? (
        <div className="mt-3 min-h-[200px] flex-1 animate-pulse rounded-xl border border-white/[0.04] bg-white/[0.025]" />
      ) : showError ? (
        <div className="mt-3 flex min-h-[200px] flex-1 flex-col items-center justify-center rounded-xl border border-danger/20 bg-danger/10 px-4 py-5 text-center">
          <Icon name="alert" className="h-4 w-4 text-danger/80" />
          <p className="mt-2 text-xs text-danger/80">
            Could not load model speed
          </p>
          <button
            type="button"
            onClick={retry}
            className="mt-2 text-xs text-danger underline-offset-2 hover:underline"
          >
            Try again
          </button>
        </div>
      ) : isEmpty ? (
        <div className="mt-3 flex min-h-[200px] flex-1 flex-col items-center justify-center rounded-xl border border-white/[0.015] px-4 py-5 text-center">
          <Icon name="activity" className="h-4 w-4 text-muted/70" />
          <p className="mt-2 text-xs text-muted">
            {isSpeed ? "No timed models to plot yet" : "No model usage yet"}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted">
            {isSpeed
              ? "Models with generation and prefill timing appear here."
              : "Point an Ollama client at the proxy to populate this plot."}
          </p>
        </div>
      ) : (
        <div ref={containerRef} className="relative mt-3 min-h-0 flex-1">
          {width > 0 ? (
            <>
              <svg
                width={width}
                height={height}
                className="overflow-visible"
                role="img"
                aria-label={
                  isSpeed
                    ? "Generation vs prefill speed by model"
                    : "Cache hit rate by model"
                }
              >
                {isSpeed ? (
                  <SpeedPlot
                    dots={dots}
                    plotW={plotW}
                    plotH={plotH}
                    xToPx={xToPx}
                    yToPx={yToPx}
                    speedTicks={speedTicks}
                    xMax={speedDomains.xMax}
                    hover={hover}
                    setHover={setHover}
                  />
                ) : (
                  <BarPlot
                    bars={bars}
                    band={band}
                    barW={barW}
                    plotW={plotW}
                    plotH={plotH}
                    barToY={barToY}
                    hover={hover}
                    setHover={setHover}
                  />
                )}
              </svg>

              {hover && (
                <div
                  className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-white/10 bg-[#0b1220]/95 px-2.5 py-1.5 shadow-lg backdrop-blur-sm"
                  style={{ left: hover.x, top: hover.y - 8 }}
                >
                  <p className="whitespace-nowrap text-[11px] font-semibold text-white tabular-nums">
                    {hover.title}
                  </p>
                  {hover.lines.map((line) => (
                    <p
                      key={line}
                      className="whitespace-nowrap text-[10px] text-muted tabular-nums"
                    >
                      {line}
                    </p>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="min-h-[200px]" />
          )}
        </div>
      )}
    </section>
  );
}

function SpeedPlot({
  dots,
  plotW,
  plotH,
  xToPx,
  yToPx,
  speedTicks,
  xMax,
  hover,
  setHover,
}: {
  dots: {
    model: string;
    gen: number;
    prefill: number;
    estimated: boolean;
    color: string;
  }[];
  plotW: number;
  plotH: number;
  xToPx: (gen: number) => number;
  yToPx: (prefill: number) => number;
  speedTicks: number[];
  xMax: number;
  hover: Hover | null;
  setHover: (hover: Hover | null) => void;
}) {
  const xTickCount = 4;
  const xTicks = Array.from(
    { length: xTickCount + 1 },
    (_, i) => Math.round((xMax / xTickCount) * i * 10) / 10,
  );

  return (
    <g>
      {/* Y gridlines + labels (log decades) */}
      {speedTicks.map((tick) => {
        const y = yToPx(tick);
        return (
          <g key={tick}>
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + plotW}
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="1"
            />
            <text
              x={MARGIN.left - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-white/40 text-[10px]"
            >
              {formatTokensPerSecond(tick)}
            </text>
          </g>
        );
      })}

      {/* X gridlines + labels */}
      {xTicks.map((tick) => {
        const x = xToPx(tick);
        return (
          <g key={tick}>
            <line
              x1={x}
              x2={x}
              y1={MARGIN.top}
              y2={MARGIN.top + plotH}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="1"
            />
            <text
              x={x}
              y={MARGIN.top + plotH + 16}
              textAnchor="middle"
              className="fill-white/40 text-[10px]"
            >
              {formatTokensPerSecond(tick)}
            </text>
          </g>
        );
      })}

      {/* Axis titles */}
      <text
        x={MARGIN.left + plotW / 2}
        y={MARGIN.top + plotH + 34}
        textAnchor="middle"
        className="fill-white/50 text-[10px]"
      >
        Generation tok/s
      </text>
      <text
        x={12}
        y={MARGIN.top + plotH / 2}
        textAnchor="middle"
        transform={`rotate(-90 12 ${MARGIN.top + plotH / 2})`}
        className="fill-white/50 text-[10px]"
      >
        Prefill tok/s (log)
      </text>

      {/* Points */}
      {dots.map((dot) => {
        const cx = xToPx(dot.gen);
        const cy = yToPx(dot.prefill);
        const active = hover?.title === dot.model;
        return (
          <g key={dot.model}>
            <circle
              cx={cx}
              cy={cy}
              r={active ? 7 : 5}
              fill={dot.color}
              fillOpacity={dot.estimated ? 0.55 : 0.9}
              stroke={dot.estimated ? dot.color : "transparent"}
              strokeWidth={dot.estimated ? 1.5 : 0}
              strokeDasharray={dot.estimated ? "3 2" : undefined}
              className="cursor-pointer transition-all"
              onMouseEnter={() =>
                setHover({
                  x: cx,
                  y: cy,
                  title: dot.model,
                  lines: [
                    `Gen ${dot.estimated ? "~" : ""}${formatTokensPerSecond(dot.gen)} tok/s`,
                    `Prefill ${formatTokensPerSecond(dot.prefill)} tok/s`,
                    ...(dot.estimated ? ["estimated from /v1 stream"] : []),
                  ],
                })
              }
              onMouseLeave={() => setHover(null)}
            />
            {/* Model label near the point */}
            <text
              x={cx}
              y={cy - 9}
              textAnchor="middle"
              className="pointer-events-none fill-white/60 text-[9px]"
            >
              {shortLabel(dot.model)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function BarPlot({
  bars,
  band,
  barW,
  plotW,
  plotH,
  barToY,
  hover,
  setHover,
}: {
  bars: { model: string; rate: number; color: string }[];
  band: number;
  barW: number;
  plotW: number;
  plotH: number;
  barToY: (rate: number) => number;
  hover: Hover | null;
  setHover: (hover: Hover | null) => void;
}) {
  // Horizontal gridlines at 0 / 50 / 100%
  const yTicks = [0, 0.5, 1];

  return (
    <g>
      {yTicks.map((tick) => {
        const y = barToY(tick);
        return (
          <g key={tick}>
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + plotW}
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="1"
            />
            <text
              x={MARGIN.left - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-white/40 text-[10px]"
            >
              {Math.round(tick * 100)}%
            </text>
          </g>
        );
      })}

      {bars.map((bar, index) => {
        const x = MARGIN.left + index * band + (band - barW) / 2;
        const y = barToY(bar.rate);
        const height = Math.max(0, MARGIN.top + plotH - y);
        const cx = MARGIN.left + index * band + band / 2;
        const active = hover?.title === bar.model;
        return (
          <g key={bar.model}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={height}
              rx={3}
              fill={bar.color}
              fillOpacity={active ? 1 : 0.85}
              className="cursor-pointer transition-all"
              onMouseEnter={() =>
                setHover({
                  x: cx,
                  y,
                  title: bar.model,
                  lines: [`Cache hit ${formatPercent(bar.rate)}`],
                })
              }
              onMouseLeave={() => setHover(null)}
            />
            <text
              x={cx}
              y={MARGIN.top + plotH + 16}
              textAnchor="end"
              transform={`rotate(-32 ${cx} ${MARGIN.top + plotH + 16})`}
              className="fill-white/40 text-[9px]"
            >
              {shortLabel(bar.model)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
