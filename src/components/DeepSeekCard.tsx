import { Suspense, lazy } from "react";

import { classNames } from "../lib/format";
import { formatMoney, formatRelative } from "../lib/format";
import type { BalanceSnapshot } from "../lib/types";
import { Icon } from "./Icons";

// The balance chart is only shown when a balance exists; splitting it out of
// the dashboard bundle keeps the card light on first paint.
const BalanceChart = lazy(() =>
  import("./BalanceChart").then((module) => ({
    default: module.BalanceChart,
  })),
);

export function DeepSeekCard({
  balance,
  monthOffset,
  onRefreshed,
  onOpenSettings,
  error,
  refreshing = false,
}: {
  balance: BalanceSnapshot | null;
  monthOffset: number;
  onRefreshed: () => void;
  onOpenSettings: () => void;
  /** Non-fatal DeepSeek error surfaced by the core snapshot refresh. */
  error: string | null;
  /** Shared refresh-in-progress flag from the core snapshot hook. */
  refreshing?: boolean;
}) {
  function handleRefresh() {
    // The unified refresh goes through `refresh_core`, which performs at
    // most one DeepSeek network call and rebuilds the core snapshot.
    onRefreshed();
  }

  const needsKey = error?.toLowerCase().includes("api key");

  return (
    <section className="card flex h-full min-w-0 flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-strong/10 text-accent-strong ring-1 ring-accent-strong/20">
            <Icon name="wallet" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">DeepSeek</h2>
            <p className="text-[12px] text-muted">Available balance</p>
          </div>
        </div>
        <span className="chip shrink-0">
          <span
            className={classNames(
              "h-1.5 w-1.5 rounded-full",
              balance?.isAvailable
                ? "bg-success shadow-[0_0_8px_rgba(34,197,95,0.7)]"
                : "bg-muted",
            )}
          />
          {balance?.isAvailable ? "Live" : balance ? "Offline" : "Not linked"}
        </span>
      </div>

      {balance ? (
        <>
          <div className="mt-5">
            <p className="break-words text-[30px] font-semibold leading-none tracking-tight text-white tabular-nums">
              {formatMoney(balance.totalBalance, balance.currency)}
            </p>
            <p className="mt-2 text-[12px] leading-4 text-muted">
              Total available · {balance.currency} · synced{" "}
              {formatRelative(balance.createdAt)}
            </p>
          </div>

          <div className="mt-4 space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Granted</span>
              <span className="text-ink tabular-nums">
                {balance.grantedBalance
                  ? formatMoney(balance.grantedBalance, balance.currency)
                  : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Topped up</span>
              <span className="text-ink tabular-nums">
                {balance.toppedUpBalance
                  ? formatMoney(balance.toppedUpBalance, balance.currency)
                  : "—"}
              </span>
            </div>
          </div>

          <div className="mt-5 flex min-h-0 flex-1 flex-col">
            <Suspense fallback={<BalanceChartSkeleton />}>
              <BalanceChart
                currency={balance.currency}
                monthOffset={monthOffset}
                refreshKey={balance.createdAt}
              />
            </Suspense>
          </div>
        </>
      ) : (
        <div className="mt-6 rounded-xl border-dashed border-white/10 bg-white/[0.015] p-4">
          <div className="flex items-center gap-2 text-slate-300">
            <Icon name="key" className="h-4 w-4 text-slate-300" />
            <p className="text-sm font-medium">Connect DeepSeek</p>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Add a DeepSeek API key to track your account balance and chart its
            trend over time. The key is only used against api.deepseek.com.
          </p>
        </div>
      )}

      {error ? (
        <p className="mt-3 break-words text-[12px] leading-relaxed text-danger">
          {needsKey ? "DeepSeek needs an API key. Add one in Settings." : error}
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="btn-secondary flex-1"
        >
          <Icon
            name="refresh"
            className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
        {!balance ? (
          <button
            type="button"
            onClick={onOpenSettings}
            className="btn-primary"
          >
            Add key
          </button>
        ) : null}
      </div>
    </section>
  );
}

function BalanceChartSkeleton() {
  return (
    <div className="h-full min-h-[160px] animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="h-2.5 w-24 rounded bg-white/[0.06]" />
      <div className="mt-4 h-24 w-full rounded bg-white/[0.04]" />
    </div>
  );
}
