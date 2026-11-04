import { useState } from "react";

import { ActivityHeatmap } from "../components/ActivityHeatmap";
import { DeepSeekCard } from "../components/DeepSeekCard";
import { Icon } from "../components/Icons";
import { ModelBreakdown } from "../components/ModelBreakdown";
import { RecentRequests } from "../components/RecentRequests";
import { StatCard } from "../components/StatCard";
import { formatCompact, formatNumber, formatPercent } from "../lib/format";
import type { DashboardSummary } from "../lib/types";

export function Dashboard({
  data,
  onOpenSettings,
  onRefresh,
}: {
  data: DashboardSummary;
  onOpenSettings: () => void;
  onRefresh: () => void;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  const balance = data.latestBalance;
  const proxyUrl = data.proxy.bindAddress
    ? `http://${data.proxy.bindAddress}`
    : "http://127.0.0.1:11435";

  return (
    <div className="space-y-4">
      {!data.proxy.running ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rose-500/10 text-rose-300">
            <Icon name="alert" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-rose-200">
              The Ollama proxy is offline
            </p>
            <p className="mt-0.5 break-words text-xs text-rose-300/70">
              {data.proxy.error ??
                "TokenFlow could not bind the loopback proxy."}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="btn-secondary border-rose-400/20 text-rose-200 hover:bg-rose-500/10"
          >
            Open settings
          </button>
        </div>
      ) : null}

      {data.totals.totalTokens === 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-teal-400/15 bg-teal-400/[0.045] px-4 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-400/10 text-teal-300">
            <Icon name="terminal" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-teal-100">
              Start tracking in one step
            </p>
            <p className="mt-0.5 text-xs text-teal-200/60">
              Point Cursor, Continue, Cline, or any Ollama client at{" "}
              <code className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[11px] text-teal-200">
                {proxyUrl}
              </code>
              . No changes to the Ollama server are needed.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="btn-primary"
          >
            Setup guide
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Input today"
          value={formatCompact(data.totals.todayNewInputTokens)}
          hint={`${formatNumber(data.totals.todayRequests)} Requests`}
          icon={<Icon name="arrow-down-left" />}
          accent="teal"
        />
        <StatCard
          label="Output today"
          value={formatCompact(data.totals.todayOutputTokens)}
          hint="Generated Tokens"
          icon={<Icon name="arrow-up-right" />}
          accent="sky"
          delay={0.05}
        />
        <StatCard
          label="Cache hit rate"
          value={formatPercent(data.totals.cacheHitRate)}
          hint={`Today ${formatPercent(data.totals.todayCacheHitRate)} · token-weighted`}
          icon={<Icon name="database" />}
          accent="violet"
          delay={0.1}
        />
        <StatCard
          label={`Last ${data.rangeDays} days`}
          value={formatCompact(data.totals.totalTokens)}
          hint={`New in ${formatCompact(
            data.totals.newInputTokens,
          )} · Out ${formatCompact(data.totals.outputTokens)}`}
          icon={<Icon name="activity" />}
          accent="amber"
          delay={0.15}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3">
          <ActivityHeatmap
            daily={data.daily}
            streakDays={data.streakDays}
            monthOffset={monthOffset}
            onMonthOffsetChange={setMonthOffset}
          />
        </div>
        <div className="min-w-0 lg:col-span-2">
          <DeepSeekCard
            balance={balance}
            monthOffset={monthOffset}
            onRefreshed={onRefresh}
            onOpenSettings={onOpenSettings}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-2">
          <ModelBreakdown models={data.models} />
        </div>
        <div className="min-w-0 lg:col-span-3">
          <RecentRequests logs={data.recent} />
        </div>
      </div>
    </div>
  );
}
