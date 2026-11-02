import {
  formatCompact,
  formatNumber,
  formatPercent,
  formatRelative,
  uncachedInputTokens,
} from "../lib/format";
import type { OllamaLog } from "../lib/types";

export function RecentRequests({ logs }: { logs: OllamaLog[] }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">
            Recent requests
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            New input, output, context, and cache metrics from the proxy
          </p>
        </div>
        <span className="chip">{logs.length} shown</span>
      </div>

      {logs.length === 0 ? (
        <div className="border-t border-white/[0.05] px-5 py-10 text-center">
          <p className="text-sm text-slate-400">The proxy is listening</p>
          <p className="mt-1 text-xs text-slate-600">
            The next Ollama request will appear here with separate new input,
            output, context, and cached-token counts.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left">
            <thead>
              <tr className="border-t border-white/[0.05] text-[10px] uppercase tracking-[0.14em] text-slate-600">
                <th className="px-5 py-2.5 font-medium">Model</th>
                <th className="hidden px-3 py-2.5 font-medium sm:table-cell">
                  Endpoint
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  New input
                </th>
                <th className="px-3 py-2.5 text-right font-medium">Output</th>
                <th className="hidden px-3 py-2.5 text-right font-medium md:table-cell">
                  Cache
                </th>
                <th className="px-5 py-2.5 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="border-t border-white/[0.04] text-sm transition-colors hover:bg-white/[0.02]"
                  title={
                    log.durationMs
                      ? `${(log.durationMs / 1000).toFixed(1)}s request`
                      : undefined
                  }
                >
                  <td className="max-w-[180px] truncate px-5 py-2.5 font-mono text-xs text-slate-300">
                    {log.model}
                  </td>
                  <td className="hidden px-3 py-2.5 sm:table-cell">
                    <code className="rounded bg-white/[0.04] px-1.5 py-1 text-[10px] text-slate-500">
                      {log.endpoint}
                    </code>
                  </td>
                  <td
                    className="px-3 py-2.5 text-right text-slate-300 tabular-nums"
                    title={`${formatNumber(log.inputTokens)} context · ${formatNumber(log.cachedInputTokens)} cached`}
                  >
                    {formatCompact(
                      uncachedInputTokens(
                        log.inputTokens,
                        log.cachedInputTokens,
                      ),
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-300 tabular-nums">
                    {formatCompact(log.outputTokens)}
                  </td>
                  <td
                    className="hidden px-3 py-2.5 text-right text-xs text-slate-400 tabular-nums md:table-cell"
                    title={`${formatNumber(log.cachedInputTokens)} cached input tokens`}
                  >
                    {formatPercent(log.cacheHitRate)}
                  </td>
                  <td className="px-5 py-2.5 text-right text-xs text-slate-500">
                    {formatRelative(log.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
