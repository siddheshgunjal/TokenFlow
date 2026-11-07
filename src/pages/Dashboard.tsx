import { Suspense, lazy, useMemo, useState } from "react";

import { DeepSeekCard } from "../components/DeepSeekCard";
import { Icon } from "../components/Icons";
import { ModelBreakdown } from "../components/ModelBreakdown";
import { RecentRequests } from "../components/RecentRequests";
import { StatCard } from "../components/StatCard";
import {
  dateKeyForMonthOffset,
  formatCompact,
  formatNumber,
  formatPercent,
  todayKey,
} from "../lib/format";
import { buildModelColorMap } from "../lib/modelColors";
import type { DashboardSummary } from "../lib/types";

// The heatmap renders 365 cells; splitting it out of the dashboard bundle
// keeps first paint fast.
const ActivityHeatmap = lazy(() =>
  import("../components/ActivityHeatmap").then((module) => ({
    default: module.ActivityHeatmap,
  })),
);

export function Dashboard({
  data,
  onOpenSettings,
  onRefresh,
  error,
  refreshing = false,
}: {
  data: DashboardSummary;
  onOpenSettings: () => void;
  onRefresh: () => void;
  /** Non-fatal DeepSeek error from the core snapshot. */
  error: string | null;
  /** Shared refresh-in-progress flag. */
  refreshing?: boolean;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  // The selected day defaults to today and is always present: the day-detail
  // panel has no nullable state.
  const [selectedDate, setSelectedDate] = useState<string>(() => todayKey());
  const balance = data.latestBalance;
  const proxyUrl = data.proxy.bindAddress
    ? `http://${data.proxy.bindAddress}`
    : "http://127.0.0.1:11435";

  // One color map per snapshot drives both the Models card and the day-detail
  // chart so a model's color is identical in both.
  const modelColors = useMemo(
    () => buildModelColorMap(data.models),
    [data.models],
  );

  function handleMonthOffsetChange(nextOffset: number) {
    setMonthOffset(nextOffset);
    setSelectedDate((current) => dateKeyForMonthOffset(current, nextOffset));
  }

  // Kept separate from month navigation so "Today" always selects today, even
  // when the current selection is already in the current month.
  function handleGoToToday() {
    setMonthOffset(0);
    setSelectedDate(todayKey());
  }

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
          <Suspense fallback={<HeatmapSkeleton />}>
            <ActivityHeatmap
              daily={data.daily}
              streakDays={data.streakDays}
              monthOffset={monthOffset}
              onMonthOffsetChange={handleMonthOffsetChange}
              onGoToToday={handleGoToToday}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              models={data.models}
              modelColors={modelColors}
              detailRefreshKey={data.revision}
            />
          </Suspense>
        </div>
        <div className="min-w-0 lg:col-span-2">
          <DeepSeekCard
            balance={balance}
            selectedDate={selectedDate}
            onRefreshed={onRefresh}
            onOpenSettings={onOpenSettings}
            error={error}
            refreshing={refreshing}
          />
        </div>
      </div>

      <div className="grid auto-rows-[24rem] gap-4 lg:grid-cols-5">
        <div className="min-h-0 min-w-0 lg:col-span-2">
          <ModelBreakdown models={data.models} modelColors={modelColors} />
        </div>
        <div className="min-h-0 min-w-0 lg:col-span-3">
          <RecentRequests logs={data.recent} />
        </div>
      </div>
    </div>
  );
}

function HeatmapSkeleton() {
  return (
    <div className="card h-64 animate-pulse p-5">
      <div className="h-2.5 w-32 rounded bg-white/[0.06]" />
      <div className="mt-4 space-y-2">
        <div className="h-3 w-full rounded bg-white/[0.04]" />
        <div className="h-3 w-full rounded bg-white/[0.04]" />
        <div className="h-3 w-4/5 rounded bg-white/[0.04]" />
      </div>
    </div>
  );
}
