import { AnimatePresence, motion } from "framer-motion";
import { Suspense, useCallback, lazy, useState } from "react";

import { Icon } from "./components/Icons";
import { Sidebar, type Page } from "./components/Sidebar";
import { isTauri, toggleWidget } from "./lib/api";
import { useCoreSnapshot } from "./lib/useCoreSnapshot";
import { Dashboard } from "./pages/Dashboard";

// Settings is only shown on demand; splitting it out of the dashboard bundle
// keeps the initial render light.
const SettingsPage = lazy(() =>
  import("./pages/Settings").then((module) => ({
    default: module.SettingsPage,
  })),
);

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const { snapshot, error, refreshing, refresh } = useCoreSnapshot();

  const handleNavigate = useCallback((next: Page) => {
    setPage(next);
  }, []);

  async function handleOpenWidget() {
    try {
      await toggleWidget(true);
    } catch (err) {
      console.error("could not open widget", err);
    }
  }

  const proxy = snapshot?.proxy ?? {
    running: false,
    bindAddress: "",
    upstreamUrl: "",
    error: null,
  };

  return (
    <div className="app-surface flex h-screen overflow-hidden">
      <Sidebar page={page} onNavigate={handleNavigate} proxy={proxy} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-white">
                {page === "dashboard" ? "Usage overview" : "Settings"}
              </h1>
              {!isTauri ? (
                <span className="border-warning/20 bg-warning/10 text-warning/80">
                  Browser preview
                </span>
              ) : null}
            </div>
            <p className="text-sm text-muted">
              {page === "dashboard"
                ? "Local-first telemetry from your Ollama proxy."
                : "Configure the proxy, DeepSeek account, and desktop behavior."}
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
              onClick={() => void handleOpenWidget()}
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

          <AnimatePresence mode="wait">
            {page === "dashboard" ? (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                {snapshot ? (
                  <Dashboard
                    data={snapshot}
                    onOpenSettings={() => handleNavigate("settings")}
                    onRefresh={() => void refresh()}
                    error={error}
                    refreshing={refreshing}
                  />
                ) : (
                  <DashboardSkeleton />
                )}
              </motion.div>
            ) : (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                <Suspense fallback={<SettingsSkeleton />}>
                  <SettingsPage onSaved={() => void refresh()} />
                </Suspense>
              </motion.div>
            )}
          </AnimatePresence>
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

function SettingsSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="card h-40 p-5">
        <div className="h-2.5 w-40 rounded bg-white/[0.06]" />
        <div className="mt-4 space-y-3">
          <div className="h-8 w-full rounded bg-white/[0.05]" />
          <div className="h-8 w-full rounded bg-white/[0.05]" />
        </div>
      </div>
      <div className="card h-56 p-5">
        <div className="h-2.5 w-48 rounded bg-white/[0.06]" />
        <div className="mt-4 space-y-3">
          <div className="h-8 w-full rounded bg-white/[0.05]" />
          <div className="h-8 w-full rounded bg-white/[0.05]" />
          <div className="h-8 w-2/3 rounded bg-white/[0.05]" />
        </div>
      </div>
    </div>
  );
}
