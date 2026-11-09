import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatCompact, formatNumber, formatPercent } from "../lib/format";
import { colorForModel, type ModelColor } from "../lib/modelColors";
import type { ModelUsage } from "../lib/types";
import { Icon } from "./Icons";
import { ManageModelsDialog } from "./ManageModelsDialog";

export function ModelBreakdown({
  models,
  modelColors,
  onModelsChanged,
}: {
  models: ModelUsage[];
  modelColors: Map<string, ModelColor>;
  onModelsChanged: () => void;
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

  const showNotice = useCallback((message: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  const maxTokens = Math.max(...models.map((model) => model.totalTokens), 1);
  const totalTokens = models.reduce((sum, model) => sum + model.totalTokens, 0);

  return (
    <section className="card flex h-full min-h-0 flex-col p-5">
      <div className="flex items-start justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-muted">Models</h2>
          <p className="mt-1 text-xs text-muted">
            New input, output, and cache share
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="chip shrink-0 whitespace-nowrap">
            {formatNumber(models.length)} models
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

      <ManageModelsDialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        onCompleted={showNotice}
        onModelsChanged={onModelsChanged}
      />
    </section>
  );
}
