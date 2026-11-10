import { useCallback, useEffect, useRef } from "react";

import { Icon } from "../components/Icons";
import { Logo } from "../components/Logo";
import {
  markWidgetReady,
  quitApp,
  showMainWindow,
  toggleWidget,
} from "../lib/api";
import {
  formatCompact,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelative,
  classNames,
} from "../lib/format";
import { useCoreSnapshot } from "../lib/useCoreSnapshot";

export function Widget() {
  const { snapshot: data, refreshing, refresh } = useCoreSnapshot();
  const readySent = useRef(false);

  // The core keeps the widget window hidden after a reopen/reload. Report
  // readiness once the first snapshot is rendered so it can be mapped with
  // content instead of a blank/stale frame.
  useEffect(() => {
    if (!data || readySent.current) return;
    readySent.current = true;
    void markWidgetReady().catch(() => undefined);
  }, [data]);

  const handleManualRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  async function handleOpenDashboard() {
    try {
      await showMainWindow();
      await toggleWidget(false);
    } catch (err) {
      console.error("could not open dashboard", err);
    }
  }

  async function handleQuit() {
    try {
      await quitApp();
    } catch (err) {
      console.error("could not quit", err);
    }
  }

  const balance = data?.latestBalance ?? null;
  const recentDays = data?.daily.slice(-14) ?? [];
  const maxGraphValue = Math.max(
    ...recentDays.flatMap((day) => [day.newInputTokens, day.outputTokens]),
    1,
  );

  const xFor = (index: number) =>
    recentDays.length <= 1 ? 50 : (index / (recentDays.length - 1)) * 100;
  const yFor = (value: number) => 28 - (value / maxGraphValue) * 24;
  const inputPoints = recentDays
    .map((day, index) => `${xFor(index)},${yFor(day.newInputTokens)}`)
    .join(" ");
  const outputPoints = recentDays
    .map((day, index) => `${xFor(index)},${yFor(day.outputTokens)}`)
    .join(" ");

  return (
    <div className="h-full w-full p-2 pb-3">
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0a101a]/95 shadow-2xl backdrop-blur-xl">
        <header
          data-tauri-drag-region
          className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5"
        >
          <div
            data-tauri-drag-region
            className="flex min-w-0 items-center gap-2"
          >
            <span data-tauri-drag-region>
              <Logo className="h-6 w-6 rounded-lg" />
            </span>
            <div className="min-w-0" data-tauri-drag-region>
              <p
                data-tauri-drag-region
                className="text-xs font-semibold tracking-tight text-white"
              >
                TokenFlow
              </p>
              <p
                data-tauri-drag-region
                className="flex items-center gap-1 text-[12px]"
              >
                <span
                  data-tauri-drag-region
                  className={classNames(
                    "h-1.5 w-1.5 rounded-full",
                    data?.proxy.running ? "bg-success" : "bg-danger",
                  )}
                />
                {data?.proxy.running ? "Proxy live" : "Proxy offline"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleManualRefresh()}
              disabled={refreshing}
              aria-label="Refresh widget data"
              title="Refresh usage and balance"
              className="grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-accent/80 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon
                name="refresh"
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
            </button>
            <button
              type="button"
              onClick={() => {
                void toggleWidget(false).catch((err) =>
                  console.error("could not hide widget", err),
                );
              }}
              aria-label="Hide widget"
              className="grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-white/[0.06] hover:text-muted"
            >
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-2.5">
          {!data ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2">
              <div className="animate-pulse w-full space-y-3">
                <div className="h-3 w-16 rounded bg-white/[0.06]" />
                <div className="grid grid-cols-2 gap-3">
                  <div className="h-12 rounded bg-white/[0.06]" />
                  <div className="h-12 rounded bg-white/[0.04]" />
                </div>
                <div className="h-10 rounded bg-white/[0.03]" />
                <div className="h-9 rounded bg-white/[0.03]" />
              </div>
              <button
                type="button"
                onClick={() => void refresh()}
                className="text-[12px] text-accent hover:text-white"
              >
                Load usage
              </button>
            </div>
          ) : data ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                  Today
                </p>
                <span className="text-xs text-muted">
                  {formatNumber(data.totals.todayRequests)} requests
                </span>
              </div>

              <div className="mt-1 grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center gap-1 text-[12px] text-muted/80">
                    <Icon name="arrow-down-left" className="h-3 w-3" />
                    Input
                  </div>
                  <p
                    className="mt-0.5 text-[20px] font-semibold leading-none tracking-tight text-white tabular-nums"
                    title="Uncached input tokens evaluated by the model"
                  >
                    {formatCompact(data.totals.todayNewInputTokens)}
                  </p>
                  <p
                    className="mt-0.5 text-[12px] text-muted"
                    title="Cached tokens from the most recent request today"
                  >
                    {formatCompact(data.totals.latestCachedInputTokens)} Cached
                  </p>
                </div>

                <div>
                  <div className="flex items-center gap-1 text-[12px] text-muted/80">
                    <Icon name="arrow-up-right" className="h-3 w-3" />
                    Output
                  </div>
                  <p className="mt-0.5 text-[20px] font-semibold leading-none tracking-tight text-white tabular-nums">
                    {formatCompact(data.totals.todayOutputTokens)}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    Generated Tokens
                  </p>
                </div>
              </div>

              <div className="mt-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1">
                <div className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-muted">Cache hit</span>
                  <span className="text-ink">
                    {formatPercent(data.totals.todayCacheHitRate)} ·
                    token-weighted
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.05]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-accent to-data-cyan"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(0, data.totals.todayCacheHitRate * 100),
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <div className="mt-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1">
                <div className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-muted">DeepSeek total</span>
                  <span className="text-accent-strong tabular-nums">
                    {balance
                      ? `${formatMoney(balance.totalBalance, balance.currency)} ${balance.currency}`
                      : "Not linked"}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[12px] text-muted">
                  <span>
                    Granted{" "}
                    {balance?.grantedBalance
                      ? formatMoney(balance.grantedBalance, balance.currency)
                      : "—"}
                  </span>
                  <span>
                    Topped up{" "}
                    {balance?.toppedUpBalance
                      ? formatMoney(balance.toppedUpBalance, balance.currency)
                      : "—"}
                  </span>
                </div>
              </div>

              <div className="mt-1">
                <div className="flex items-center justify-between text-[12px] text-muted">
                  <span>Last 14 days</span>
                  <span className="flex items-center gap-2">
                    <span className="flex items-center gap-1">
                      <span className="h-1 w-1 rounded-full text-accent" />
                      New in
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-1 w-1 rounded-full text-accent-strong" />
                      Out
                    </span>
                  </span>
                </div>
              </div>

              <svg
                viewBox="0 0 100 30"
                preserveAspectRatio="none"
                className="mt-1 h-5 w-full overflow-visible"
                aria-label="New input and output tokens over the last 14 days"
              >
                <line
                  x1="0"
                  y1="29"
                  x2="100"
                  y2="29"
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                <polyline
                  points={outputPoints}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                <polyline
                  points={inputPoints}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </>
          ) : null}
        </div>

        <footer className="shrink-0 border-t border-white/[0.06] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => void handleOpenDashboard()}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-accent transition-colors:hover:bg-accent/80 hover:text-white"
            >
              Open TokenFlow
              <Icon name="arrow-up-right" className="h-3 w-3" />
            </button>
            <div className="flex items-center gap-2">
              <span
                className="text-[12px] text-muted"
                title={
                  data
                    ? `Updated ${formatRelative(data.generatedAt)}`
                    : undefined
                }
              >
                {data ? formatRelative(data.generatedAt) : ""}
              </span>
              <button
                type="button"
                onClick={() => void handleQuit()}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted transition-colors:hover:bg-danger/80 hover:text-danger"
              >
                <Icon name="power" className="h-3 w-3" />
                Quit
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
