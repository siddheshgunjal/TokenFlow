import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

import { formatCompact, formatNumber, formatPercent } from "../lib/format";
import { APPROX_TOOLTIP, THROUGHPUT_TOOLTIP } from "../lib/throughput";
import { colorForModel, type ModelColor } from "../lib/modelColors";
import type { ModelPerformanceEntry, ModelUsage } from "../lib/types";
import { Icon } from "./Icons";
import { ManageModelsDialog } from "./ManageModelsDialog";
import { ModelSpeedList } from "./ModelSpeedList";

export type ModelTab = "usage" | "speed";

// Memoized on the `models` and `modelColors` references: the snapshot hook
// reconciles unchanged slices, so a DeepSeek-only refresh skips this card.
export const ModelBreakdown = memo(function ModelBreakdown({
  models,
  modelColors,
  onModelsChanged,
  rangeDays,
  tab,
  onTabChange,
  performance,
  performanceLoading,
  performanceError,
  performanceRetry,
}: {
  models: ModelUsage[];
  modelColors: Map<string, ModelColor>;
  onModelsChanged: () => void;
  rangeDays: number;
  // Shared with the Model plot card so both switch together.
  tab: ModelTab;
  onTabChange: (tab: ModelTab) => void;
  // Fetched by the parent (Dashboard) so both cards share one lazy payload.
  performance: ModelPerformanceEntry[] | null;
  performanceLoading: boolean;
  performanceError: string | null;
  performanceRetry: () => void;
}) {
  const [manageOpen, setManageOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear a pending notice timer on unmount so it never fires late.
  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  const showNotice = useCallback((msg: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(msg);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  const maxTokens = Math.max(...models.map((model) => model.totalTokens), 1);
  const totalTokens = models.reduce((sum, model) => sum + model.totalTokens, 0);

  const activeCount = useMemo(
    () => (performance ?? []).filter((entry) => entry.requests > 0).length,
    [performance],
  );

  return (
    <section className="card flex h-full min-h-0 flex-col p-5">
      <div className="flex items-start justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-muted">Models</h2>
            <div
              role="tablist"
              aria-label="Models view"
              className="inline-flex shrink-0 items-center rounded-lg border border-white/10 bg-white/[0.03] p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === "usage"}
                onClick={() => onTabChange("usage")}
                className={`rounded px-2 py-0.5 text-xs transition-colors ${
                  tab === "usage"
                    ? "bg-white/[0.06] text-white"
                    : "text-white/40 hover:text-white"
                }`}
              >
                Usage
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "speed"}
                onClick={() => onTabChange("speed")}
                className={`rounded px-2 py-0.5 text-xs transition-colors ${
                  tab === "speed"
                    ? "bg-white/[0.06] text-white"
                    : "text-white/40 hover:text-white"
                }`}
              >
                Speed
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted">
            {tab === "usage"
              ? "New input, output, and cache share"
              : `All recorded models · ${activeCount} active in the last ${rangeDays} days · time-weighted speed`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="chip shrink-0 whitespace-nowrap">
            {formatNumber(tab === "usage" ? models.length : activeCount)} models
          </span>
          <button
            onClick={() => setManageOpen(true)}
            className="rounded-md border border-white/10 p-1 text-white/40 hover:bg-white/5 hover:text-white transition-colors"
            aria-label="Manage models"
            title="Manage models"
          >
            <Icon name="settings" className="h-4 w-4" />
          </button>
        </div>
      </div>

      {notice && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="mt-2 rounded-md bg-blue-500/10 p-2 text-[11px] text-blue-300/80 border border-blue-500/20"
        >
          {notice}
        </motion.div>
      )}

      {tab === "usage" ? (
        <UsageList
          models={models}
          maxTokens={maxTokens}
          totalTokens={totalTokens}
          modelColors={modelColors}
        />
      ) : (
        <ModelSpeedList
          entries={performance ?? []}
          rangeDays={rangeDays}
          loading={performanceLoading}
          error={performanceError}
          retry={performanceRetry}
          modelColors={modelColors}
        />
      )}

      <ManageModelsDialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        onCompleted={showNotice}
        onModelsChanged={onModelsChanged}
      />
    </section>
  );
});

function UsageList({
  models,
  maxTokens,
  totalTokens,
  modelColors,
}: {
  models: ModelUsage[];
  maxTokens: number;
  totalTokens: number;
  modelColors: Map<string, ModelColor>;
}) {
  return (
    <>
      {models.length === 0 ? (
        <div className="mt-5 flex min-h-0 flex-1 flex-col justify-center rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
          <p className="text-sm text-muted">No model usage yet</p>
          <p className="mt-1 text-xs text-muted">
            Point an Ollama client at the proxy to populate this list.
          </p>
        </div>
      ) : (
        <div className="mt-5 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1">
          {models.map((model, index) => {
            const newInput = model.newInputTokens;
            const modelInference = model.totalTokens;
            const width = Math.max(
              2,
              Math.round((modelInference / maxTokens) * 100),
            );
            const share =
              totalTokens > 0
                ? Math.round((modelInference / totalTokens) * 100)
                : 0;
            const color = colorForModel(modelColors, model.model);

            return (
              <div key={model.model}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-mono text-[13px] text-muted">
                    {model.model}
                  </span>
                  <span className="shrink-0 text-[13px] text-muted tabular-nums">
                    {formatCompact(modelInference)}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.04]">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${width}%` }}
                    transition={{
                      duration: 0.55,
                      delay: index * 0.06,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className="h-full rounded-full"
                    style={{
                      backgroundImage: `linear-gradient(90deg, ${color.hex}, ${color.hex}80)`,
                    }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted">
                  <span
                    className="truncate"
                    title={`${formatNumber(model.contextTokens)} peak context · ${formatNumber(model.cachedInputTokens)} cached at peak`}
                  >
                    New in {formatCompact(newInput)} · Out{" "}
                    {formatCompact(model.outputTokens)} · Cache{" "}
                    {formatPercent(model.cacheHitRate)}
                  </span>
                  <span className="shrink-0">
                    {formatNumber(model.requests)} req · {share}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export { APPROX_TOOLTIP, THROUGHPUT_TOOLTIP };
export type { ModelPerformanceEntry };
