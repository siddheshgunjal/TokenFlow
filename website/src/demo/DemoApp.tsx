import { motion } from "framer-motion";
import { useCallback } from "react";

import { Icon } from "./components/Icons";
import { Sidebar } from "./components/Sidebar";
import { useDemoSnapshot } from "./lib/useDemoSnapshot";
import { Dashboard } from "./pages/Dashboard";

/**
 * The website's dashboard replica. This mirrors the app shell in `src/App.tsx`
 * and `src/pages/Dashboard.tsx`, but all data comes from the local mock and
 * desktop-only actions are disabled.
 */
export function DemoApp() {
  const { snapshot, error, refreshing, refresh } = useDemoSnapshot();
  const proxy = snapshot?.proxy ?? {
    running: false,
    bindAddress: "",
    upstreamUrl: "",
    error: null,
  };

  // Rebuilds the stateful mock snapshot after a delete/merge so the cards,
  // totals, and heatmap all reflect the mutation.
  const handleModelsChanged = useCallback(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="app-surface flex h-full overflow-hidden">
      <Sidebar
        page="dashboard"
        onNavigate={() => undefined}
        proxy={proxy}
        settingsDisabled
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-white">
                Usage overview
              </h1>
              <span className="border-warning/20 bg-warning/10 text-warning/80">
                Browser preview
              </span>
            </div>
            <p className="text-sm text-muted">
              Local telemetry from your Ollama proxy.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {snapshot ? (
              <span className="mr-1 hidden text-[12px] text-ink sm:inline">
                Updated{" "}
                {new Date(snapshot.generatedAt * 1000).toLocaleTimeString(
                  undefined,
                  {
                    hour: "2-digit",
                    minute: "2-digit",
                  },
                )}
              </span>
            ) : null}
            <button
              type="button"
              disabled
              title="The tray widget is available in the desktop app"
              className="btn-secondary"
            >
              <Icon name="monitor" className="h-3.5 w-3.5" />
              Widget
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="btn-primary"
            >
              <Icon
                name="refresh"
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {error ? (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-danger/20 bg-danger/10 px-4 py-3">
              <Icon name="alert" className="h-4 w-4 shrink-0 text-danger" />
              <p className="text-[12px] leading-relaxed text-danger">{error}</p>
              <button
                type="button"
                onClick={() => void refresh()}
                className="btn-secondary border-danger/20 text-danger/80 hover:bg-danger/20"
              >
                Retry
              </button>
            </div>
          ) : null}

          {snapshot ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Dashboard
                data={snapshot}
                onOpenSettings={() => undefined}
                onRefresh={() => void refresh()}
                error={error}
                refreshing={refreshing}
                onModelsChanged={handleModelsChanged}
              />
            </motion.div>
          ) : (
            <DashboardSkeleton />
          )}
        </main>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="card h-[112px] p-5">
            <div className="h-2.5 w-24 rounded bg-white/[0.06]" />
            <div className="mt-4 h-6 w-20 rounded bg-white/[0.07]" />
            <div className="mt-3 h-2 w-32 rounded bg-white/[0.04]" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card h-64 lg:col-span-3" />
        <div className="card h-64 lg:col-span-2" />
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card h-72 lg:col-span-2" />
        <div className="card h-72 lg:col-span-3" />
      </div>
    </div>
  );
}
