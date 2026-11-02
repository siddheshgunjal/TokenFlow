import { motion } from "framer-motion";

import {
  formatCompact,
  formatNumber,
  formatPercent,
  inferenceTokens,
  uncachedInputTokens,
} from "../lib/format";
import type { ModelUsage } from "../lib/types";

const BAR_STYLES = [
  "bg-gradient-to-r from-teal-400 to-cyan-300",
  "bg-gradient-to-r from-sky-400 to-blue-400",
  "bg-gradient-to-r from-violet-400 to-fuchsia-400",
  "bg-gradient-to-r from-amber-400 to-orange-400",
];

export function ModelBreakdown({ models }: { models: ModelUsage[] }) {
  const maxTokens = Math.max(
    ...models.map((model) =>
      inferenceTokens(
        model.inputTokens,
        model.cachedInputTokens,
        model.outputTokens,
      ),
    ),
    1,
  );
  const totalTokens = models.reduce(
    (sum, model) =>
      sum +
      inferenceTokens(
        model.inputTokens,
        model.cachedInputTokens,
        model.outputTokens,
      ),
    0,
  );

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-200">Models</h2>
          <p className="mt-1 text-xs text-slate-500">
            New input, output, and cache share
          </p>
        </div>
        <span className="chip shrink-0 whitespace-nowrap">
          {formatNumber(models.length)} models
        </span>
      </div>

      {models.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
          <p className="text-sm text-slate-400">No model usage yet</p>
          <p className="mt-1 text-xs text-slate-600">
            Point an Ollama client at the proxy to populate this list.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {models.map((model, index) => {
            const newInput = uncachedInputTokens(
              model.inputTokens,
              model.cachedInputTokens,
            );
            const modelInference = inferenceTokens(
              model.inputTokens,
              model.cachedInputTokens,
              model.outputTokens,
            );
            const width = Math.max(
              2,
              Math.round((modelInference / maxTokens) * 100),
            );
            const share =
              totalTokens > 0
                ? Math.round((modelInference / totalTokens) * 100)
                : 0;

            return (
              <div key={model.model}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-mono text-xs text-slate-300">
                    {model.model}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400 tabular-nums">
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
                    className={`h-full rounded-full ${BAR_STYLES[index % BAR_STYLES.length]}`}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-slate-600">
                  <span
                    className="truncate"
                    title={`${formatNumber(model.inputTokens)} context · ${formatNumber(model.cachedInputTokens)} cached`}
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
    </section>
  );
}
