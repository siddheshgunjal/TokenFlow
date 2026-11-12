import { useMemo, useState } from "react";

import {
  formatCompact,
  formatNumber,
  formatPercent,
  formatSelectedDay,
  todayKey,
} from "../lib/format";
import {
  colorForModel,
  MODEL_PALETTE,
  type ModelColor,
} from "../lib/modelColors";
import { useDayUsageDetail } from "../lib/useDayUsageDetail";
import type { HourlyUsage, ModelHourlyUsage, ModelUsage } from "../lib/types";
import { HourlyUsageChart, type HourlyChartSeries } from "./HourlyUsageChart";
import { Icon } from "./Icons";
import { SelectDropdown, type SelectGroup } from "./SelectDropdown";

type ModelFilter =
  { kind: "all" } | { kind: "top5" } | { kind: "model"; model: string };

// The color for the whole-day "All models" series: the primary accent.
const ALL_COLOR = MODEL_PALETTE[0].hex;

export function DayDetailPanel({
  date,
  models,
  modelColors,
  refreshKey,
  modelMutationKey,
}: {
  date: string;
  models: ModelUsage[];
  modelColors: Map<string, ModelColor>;
  refreshKey: number;
  modelMutationKey: number;
}) {
  const { detail, loading, error, retry } = useDayUsageDetail(
    date,
    refreshKey,
    modelMutationKey,
  );
  const [filter, setFilter] = useState<ModelFilter>({ kind: "all" });

  const isToday = date === todayKey();

  // The dropdown lists every model in the 30-day snapshot, followed by any
  // day-only models not in the snapshot. The filter persists across date
  // changes; a model that disappears from both lists falls back to "all".
  const dropdownModels = useMemo(() => {
    const snapshotNames = models.map((model) => model.model);
    const dayOnly = (detail?.models ?? [])
      .map((model) => model.model)
      .filter((name) => !snapshotNames.includes(name))
      .sort((left, right) => left.localeCompare(right));
    return [...snapshotNames, ...dayOnly];
  }, [models, detail]);

  const validOptions = useMemo(() => new Set(dropdownModels), [dropdownModels]);

  // The dropdown: a flat top group (All / Top 5) followed by a "Model" group
  // listing every model in the snapshot plus any day-only models.
  const filterGroups = useMemo<SelectGroup[]>(() => {
    const groups: SelectGroup[] = [
      {
        label: "",
        options: [
          { value: "all", label: "All models" },
          { value: "top5", label: "Top 5 models" },
        ],
      },
    ];
    if (dropdownModels.length > 0) {
      groups.push({
        label: "Model",
        options: dropdownModels.map((model) => ({
          value: `model:${model}`,
          label: model,
        })),
      });
    }
    return groups;
  }, [dropdownModels]);

  // A selected model that is no longer a valid option (it vanished from the
  // snapshot and the day) resets to "all" instead of showing a stale state.
  const effective: ModelFilter = useMemo(
    () =>
      filter.kind === "model" && !validOptions.has(filter.model)
        ? { kind: "all" }
        : filter,
    [filter, validOptions],
  );

  // The day's top five by total tokens, for the "Top 5" scope and chart series.
  const topFive = useMemo(() => {
    if (!detail) return [];
    return detail.models
      .map((model) => ({
        model: model.model,
        total: model.hours.reduce((sum, hour) => sum + hour.totalTokens, 0),
      }))
      .filter((entry) => entry.total > 0)
      .sort(
        (left, right) =>
          right.total - left.total || left.model.localeCompare(right.model),
      )
      .slice(0, 5);
  }, [detail]);

  const scope: ScopeRender | null = useMemo(() => {
    if (!detail) return null;

    let hours: HourlyUsage[];
    let series: HourlyChartSeries[];
    let scopeLabel: string;

    if (effective.kind === "all") {
      if (detail.models.length === 0) {
        return { kind: "no-usage" };
      }
      hours = detail.hours;
      scopeLabel = "All models";
      series = [
        {
          id: "all",
          label: "All models",
          color: ALL_COLOR,
          values: detail.hours.map((h) => h.totalTokens),
        },
      ];
    } else if (effective.kind === "model") {
      const entry = detail.models.find(
        (model) => model.model === effective.model,
      );
      const modelTotal = entry
        ? entry.hours.reduce((sum, hour) => sum + hour.totalTokens, 0)
        : 0;
      if (modelTotal === 0) {
        return { kind: "no-model-usage", model: effective.model };
      }
      hours = entry!.hours;
      scopeLabel = effective.model;
      series = [
        {
          id: effective.model,
          label: effective.model,
          color: colorForModel(modelColors, effective.model).hex,
          values: entry!.hours.map((h) => h.totalTokens),
        },
      ];
    } else {
      // Top 5: aggregate the five models for the summary, one series each.
      const entries = topFive.map((entry) =>
        detail.models.find((model) => model.model === entry.model)!,
      );
      hours = aggregateHourly(entries);
      scopeLabel = "Top 5 total";
      series = entries.map((model) => ({
        id: model.model,
        label: model.model,
        color: colorForModel(modelColors, model.model).hex,
        values: model.hours.map((hour) => hour.totalTokens),
      }));
    }

    // An all-zero scope renders an empty state rather than a flat line.
    if (hours.reduce((sum, hour) => sum + hour.totalTokens, 0) === 0) {
      return { kind: "empty" };
    }

    return renderScope(scopeLabel, hours, series);
  }, [detail, effective, topFive, modelColors]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-ink">
            {formatSelectedDay(date)}
          </h3>
          {isToday ? (
            <span className="chip shrink-0 border-accent/20 bg-accent/5 text-accent/80">
              Today
            </span>
          ) : null}
        </div>
        <div className="relative shrink-0">
          <SelectDropdown
            value={
              effective.kind === "model"
                ? `model:${effective.model}`
                : effective.kind
            }
            onChange={(next) => setFilter(handleFilterChange(next))}
            ariaLabel="Model filter"
            groups={filterGroups}
            menuSide="down"
            minWidth="10rem"
            maxHeight="280px"
          />
        </div>
      </div>

      {loading ? (
        <PanelSkeleton />
      ) : error ? (
        <div className="flex min-h-[160px] flex-col items-center justify-center rounded-xl border border-danger/20 bg-danger/10 px-4 py-6 text-center">
          <Icon name="alert" className="h-4 w-4 text-danger/80" />
          <p className="mt-2 text-xs text-danger/80">
            Could not load usage for {date}
          </p>
          <button
            type="button"
            onClick={retry}
            className="mt-2 text-xs text-danger underline-offset-2 hover:underline"
          >
            Retry
          </button>
        </div>
      ) : scope?.kind === "no-usage" ? (
        <PanelEmpty>
          <p>No Ollama usage on {formatSelectedDay(date)}.</p>
        </PanelEmpty>
      ) : scope?.kind === "no-model-usage" ? (
        <PanelEmpty>
          <p>No usage for {scope.model} on this date.</p>
        </PanelEmpty>
      ) : scope?.kind === "empty" ? (
        <PanelEmpty>
          <p>No usage for this selection.</p>
        </PanelEmpty>
      ) : scope ? (
        <div className="space-y-3">
          <SummaryStrip scope={scope} />
          <div className="min-h-[160px]">
            <HourlyUsageChart
              series={scope.series}
              ariaLabel={`Total tokens by hour for ${scope.scopeLabel} on ${formatSelectedDay(date)}`}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderScope(
  scopeLabel: string,
  hours: HourlyUsage[],
  series: HourlyChartSeries[],
): ScopeRender {
  const totalTokens = hours.reduce((sum, hour) => sum + hour.totalTokens, 0);
  const newInputTokens = hours.reduce(
    (sum, hour) => sum + hour.newInputTokens,
    0,
  );
  const outputTokens = hours.reduce((sum, hour) => sum + hour.outputTokens, 0);
  const requests = hours.reduce((sum, hour) => sum + hour.requests, 0);
  const context = hours.reduce(
    (sum, hour) => sum + hour.contextProcessedTokens,
    0,
  );
  const cached = hours.reduce(
    (sum, hour) => sum + hour.cachedProcessedTokens,
    0,
  );

  return {
    kind: "data",
    scopeLabel,
    series,
    hours,
    totalTokens,
    newInputTokens,
    outputTokens,
    requests,
    cacheRate: context > 0 ? cached / context : 0,
  };
}

function aggregateHourly(entries: ModelHourlyUsage[]): HourlyUsage[] {
  const count = entries.length ? entries[0].hours.length : 24;
  const result: HourlyUsage[] = [];
  for (let hour = 0; hour < count; hour += 1) {
    let newInput = 0;
    let output = 0;
    let requests = 0;
    let context = 0;
    let cached = 0;
    for (const entry of entries) {
      const h = entry.hours[hour];
      newInput += h.newInputTokens;
      output += h.outputTokens;
      requests += h.requests;
      context += h.contextProcessedTokens;
      cached += h.cachedProcessedTokens;
    }
    result.push({
      hour,
      newInputTokens: newInput,
      outputTokens: output,
      totalTokens: newInput + output,
      requests,
      contextProcessedTokens: context,
      cachedProcessedTokens: cached,
      cacheHitRate: context > 0 ? cached / context : 0,
    });
  }
  return result;
}

function handleFilterChange(value: string) {
  if (value === "all") return { kind: "all" } as ModelFilter;
  if (value === "top5") return { kind: "top5" } as ModelFilter;
  return { kind: "model", model: value.slice("model:".length) } as ModelFilter;
}

function SummaryStrip({
  scope,
}: {
  scope: Extract<ScopeRender, { kind: "data" }>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <SummaryMetric label="Total" value={formatCompact(scope.totalTokens)} />
      <SummaryMetric
        label="New in"
        value={formatCompact(scope.newInputTokens)}
      />
      <SummaryMetric label="Out" value={formatCompact(scope.outputTokens)} />
      <SummaryMetric label="Requests" value={formatNumber(scope.requests)} />
      <SummaryMetric label="Cache" value={formatPercent(scope.cacheRate)} />
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1 text-[12px]">
      <span className="text-muted">{label}</span>
      <span className="font-semibold text-ink tabular-nums">{value}</span>
    </span>
  );
}

function PanelEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-6 text-center">
      <Icon name="activity" className="h-4 w-4 text-muted/70" />
      <div className="mt-2 text-xs text-muted">{children}</div>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-9 w-full animate-pulse rounded-xl bg-white/[0.03]" />
      <div className="h-[140px] w-full animate-pulse rounded-xl bg-white/[0.03]" />
    </div>
  );
}

type ScopeRender =
  | { kind: "no-usage" }
  | { kind: "no-model-usage"; model: string }
  | { kind: "empty" }
  | {
      kind: "data";
      scopeLabel: string;
      series: HourlyChartSeries[];
      hours: HourlyUsage[];
      totalTokens: number;
      newInputTokens: number;
      outputTokens: number;
      requests: number;
      cacheRate: number;
    };
