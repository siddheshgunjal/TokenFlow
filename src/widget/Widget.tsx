import { useCallback, useEffect, useState } from "react";

import { Icon } from "../components/Icons";
import { Logo } from "../components/Logo";
import {
  getDashboard,
  quitApp,
  showMainWindow,
  subscribeToUpdates,
  toggleWidget,
} from "../lib/api";
import {
  formatCompact,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelative,
  uncachedInputTokens,
} from "../lib/format";
import type { DashboardSummary } from "../lib/types";

export function Widget() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const summary = await getDashboard(7);
      setData(summary);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refresh();
    }, 30_000);

    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let unsubscribe: (() => void) | undefined;

    subscribeToUpdates(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void refresh();
      }, 250);
    })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unsubscribe = cleanup;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      unsubscribe?.();
    };
  }, [refresh]);

  async function handleOpenDashboard() {
    try {
      await showMainWindow();
      await toggleWidget(false);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleQuit() {
    try {
      await quitApp();
    } catch (err) {
      setError(String(err));
    }
  }

  const balance = data?.latestBalance ?? null;
  const recentDays = data?.daily.slice(-14) ?? [];
  const maxGraphValue = Math.max(
    ...recentDays.flatMap((day) => [
      uncachedInputTokens(day.inputTokens, day.cachedInputTokens),
      day.outputTokens,
    ]),
    1,
  );

  const xFor = (index: number) =>
    recentDays.length <= 1 ? 50 : (index / (recentDays.length - 1)) * 100;
  const yFor = (value: number) => 28 - (value / maxGraphValue) * 24;
  const inputPoints = recentDays
    .map(
      (day, index) =>
        `${xFor(index)},${yFor(
          uncachedInputTokens(day.inputTokens, day.cachedInputTokens),
        )}`,
    )
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
                className="text-[11px] font-semibold tracking-tight text-white"
              >
                TokenFlow
              </p>
              <p
                data-tauri-drag-region
                className="flex items-center gap-1 text-[9px] text-slate-500"
              >
                <span
                  data-tauri-drag-region
                  className={`h-1 w-1 rounded-full ${
                    data?.proxy.running ? "bg-emerald-400" : "bg-rose-400"
                  }`}
                />
                {data?.proxy.running ? "Proxy live" : "Proxy offline"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                void toggleWidget(false).catch((err) => setError(String(err)));
              }}
              aria-label="Hide widget"
              className="grid h-6 w-6 place-items-center rounded-md text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
            >
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-2.5">
          {loading ? (
            <div className="animate-pulse space-y-3">
              <div className="h-3 w-16 rounded bg-white/[0.06]" />
              <div className="grid grid-cols-2 gap-3">
                <div className="h-12 rounded bg-white/[0.06]" />
                <div className="h-12 rounded bg-white/[0.04]" />
              </div>
              <div className="h-10 rounded bg-white/[0.03]" />
              <div className="h-9 rounded bg-white/[0.03]" />
            </div>
          ) : error && !data ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <Icon name="alert" className="h-5 w-5 text-rose-300" />
              <p className="mt-2 text-[11px] text-slate-300">
                Could not load usage
              </p>
              <button
                type="button"
                onClick={() => void refresh()}
                className="mt-2 text-[10px] text-teal-300 hover:text-teal-200"
              >
                Try again
              </button>
            </div>
          ) : data ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Today
                </p>
                <span className="text-[9px] text-slate-600">
                  {formatNumber(data.totals.todayRequests)} requests
                </span>
              </div>

              <div className="mt-1 grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center gap-1 text-[9px] text-teal-300/80">
                    <Icon name="arrow-down-left" className="h-3 w-3" />
                    New input
                  </div>
                  <p
                    className="mt-0.5 text-[23px] font-semibold leading-none tracking-tight text-white tabular-nums"
                    title="Uncached input tokens evaluated by the model"
                  >
                    {formatCompact(
                      uncachedInputTokens(
                        data.totals.todayInputTokens,
                        data.totals.todayCachedInputTokens,
                      ),
                    )}
                  </p>
                  <p
                    className="mt-0.5 text-[9px] text-slate-500"
                    title="Context includes cached tokens"
                  >
                    {formatCompact(data.totals.todayInputTokens)} context ·{" "}
                    {formatCompact(data.totals.todayCachedInputTokens)} cached
                  </p>
                </div>

                <div>
                  <div className="flex items-center gap-1 text-[9px] text-sky-300/80">
                    <Icon name="arrow-up-right" className="h-3 w-3" />
                    Output
                  </div>
                  <p className="mt-0.5 text-[23px] font-semibold leading-none tracking-tight text-white tabular-nums">
                    {formatCompact(data.totals.todayOutputTokens)}
                  </p>
                  <p className="mt-0.5 text-[9px] text-slate-500">
                    generated tokens
                  </p>
                </div>
              </div>

              <div className="mt-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1">
                <div className="flex items-center justify-between gap-2 text-[9px]">
                  <span className="text-slate-500">Cache hit</span>
                  <span className="text-slate-300">
                    {formatPercent(data.totals.todayCacheHitRate)} ·{" "}
                    {formatCompact(data.totals.todayCachedInputTokens)} cached
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.05]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400"
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
                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="text-slate-500">DeepSeek total</span>
                  <span className="text-slate-200 tabular-nums">
                    {balance
                      ? `${formatMoney(balance.totalBalance, balance.currency)} ${balance.currency}`
                      : "Not linked"}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[9px] text-slate-500">
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
                <div className="flex items-center justify-between text-[9px] text-slate-600">
                  <span>Last 14 days</span>
                  <span className="flex items-center gap-2">
                    <span className="flex items-center gap-1">
                      <span className="h-1 w-1 rounded-full bg-teal-300" />
                      New in
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-1 w-1 rounded-full bg-sky-300" />
                      Out
                    </span>
                  </span>
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
                    stroke="#38bdf8"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polyline
                    points={inputPoints}
                    fill="none"
                    stroke="#2dd4bf"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </div>
            </>
          ) : null}
        </div>

        <footer className="shrink-0 border-t border-white/[0.06] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => void handleOpenDashboard()}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-teal-300 transition-colors hover:bg-teal-400/[0.08] hover:text-teal-200"
            >
              Open TokenFlow
              <Icon name="arrow-up-right" className="h-3 w-3" />
            </button>
            <div className="flex items-center gap-2">
              <span
                className="text-[9px] text-slate-600"
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
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-slate-500 transition-colors hover:bg-rose-500/[0.08] hover:text-rose-300"
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
