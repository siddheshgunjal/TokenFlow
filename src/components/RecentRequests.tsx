import {
  formatCompact,
  formatNumber,
  formatPercent,
  formatRelative,
  uncachedInputTokens,
} from "../lib/format";
import type { OllamaLog } from "../lib/types";

export function RecentRequests({ logs }: { logs: OllamaLog[] }) {
  const visibleLogs = logs.slice(0, 6);

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-muted">
            Recent requests
          </h2>
          <p className="mt-1 text-xs text-muted">
            New input, output, context, and cache metrics from the proxy
          </p>
        </div>
        <span className="chip">{visibleLogs.length} shown</span>
      </div>

      {visibleLogs.length === 0 ? (
        <div className="border-t border-white/[0.05] px-5 py-10 text-center">
          <p className="text-sm text-muted">The proxy is listening</p>
          <p className="mt-1 text-xs text-muted">
            The next Ollama request will appear here with separate new input,
            output, context, and cached-token counts.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left">
            <thead>
              <tr className="border-t border-white/[0.05] text-[11px] uppercase tracking-[0.14em] text-muted">
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
              {visibleLogs.map((log) => (
                <tr
                  key={log.id}
                  className="border-t border-white/[0.04] transition-colors hover:bg-white/[0.02]"
                  title={
                    log.durationMs
                      ? `${(log.durationMs / 1000).toFixed(1)}s request`
                      : undefined
                  }
                >
                  <td className="max-w-[260px] truncate px-5 py-2 font-mono text-[12px] text-muted">
                    {log.model}
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">
                    <code className="rounded bg-white/[0.04] px-1.5 py-1 text-[11px] text-muted">
                      {log.endpoint}
                    </code>
                  </td>
                  <td
                    className="px-3 py-2 text-right text-[12px] text-muted tabular-nums"
                    title={`${formatNumber(log.inputTokens)} context · ${formatNumber(log.cachedInputTokens)} cached`}
                  >
                    {formatCompact(
                      uncachedInputTokens(
                        log.inputTokens,
                        log.cachedInputTokens,
                      ),
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-[12px] text-muted tabular-nums">
                    {formatCompact(log.outputTokens)}
                  </td>
                  <td
                    className="hidden px-3 py-2 text-right text-[12px] text-muted md:table-cell"
                    title={`${formatNumber(log.cachedInputTokens)} cached input tokens`}
                  >
                    {formatPercent(log.cacheHitRate)}
                  </td>
                  <td className="px-5 py-2 text-right text-[12px] text-muted">
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
