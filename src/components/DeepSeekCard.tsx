import { useState } from "react";

import { refreshDeepSeekBalance } from "../lib/api";
import { formatMoney, formatRelative } from "../lib/format";
import type { BalanceSnapshot } from "../lib/types";
import { BalanceChart } from "./BalanceChart";
import { Icon } from "./Icons";

export function DeepSeekCard({
  balance,
  monthOffset,
  onRefreshed,
  onOpenSettings,
}: {
  balance: BalanceSnapshot | null;
  monthOffset: number;
  onRefreshed: () => void;
  onOpenSettings: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);

    try {
      await refreshDeepSeekBalance();
      onRefreshed();
    } catch (err) {
      setError(String(err));
    } finally {
      setRefreshing(false);
    }
  }

  const needsKey = error?.toLowerCase().includes("api key");

  return (
    <section className="card flex h-full min-w-0 flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-400/10 text-violet-300 ring-1 ring-violet-400/20">
            <Icon name="wallet" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-200">DeepSeek</h2>
            <p className="text-[11px] text-slate-500">Available balance</p>
          </div>
        </div>
        <span className="chip shrink-0">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              balance?.isAvailable
                ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                : "bg-slate-600"
            }`}
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
            <p className="mt-2 text-[11px] leading-4 text-slate-500">
              Total available · {balance.currency} · synced{" "}
              {formatRelative(balance.createdAt)}
            </p>
          </div>

          <div className="mt-4 space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Granted</span>
              <span className="text-slate-300 tabular-nums">
                {balance.grantedBalance
                  ? formatMoney(balance.grantedBalance, balance.currency)
                  : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Topped up</span>
              <span className="text-slate-300 tabular-nums">
                {balance.toppedUpBalance
                  ? formatMoney(balance.toppedUpBalance, balance.currency)
                  : "—"}
              </span>
            </div>
          </div>

          <div className="mt-5 flex min-h-0 flex-1 flex-col">
            <BalanceChart
              currency={balance.currency}
              monthOffset={monthOffset}
              refreshKey={balance.createdAt}
            />
          </div>
        </>
      ) : (
        <div className="mt-6 rounded-xl border border-dashed border-white/10 bg-white/[0.015] p-4">
          <div className="flex items-center gap-2 text-slate-300">
            <Icon name="key" className="h-4 w-4 text-violet-300" />
            <p className="text-sm font-medium">Connect DeepSeek</p>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Add a DeepSeek API key to track your account balance and chart its
            trend over time. The key is only used against api.deepseek.com.
          </p>
        </div>
      )}

      {error ? (
        <p className="mt-3 break-words text-[11px] leading-relaxed text-rose-300">
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
