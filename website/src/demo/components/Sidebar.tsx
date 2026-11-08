import { classNames } from "../lib/format";
import type { ProxyStatus } from "../lib/types";
import { Icon, type IconName } from "./Icons";
import { Logo, Wordmark } from "./Logo";

export type Page = "dashboard" | "settings";

const NAV_ITEMS: Array<{ id: Page; label: string; icon: IconName }> = [
  { id: "dashboard", label: "Dashboard", icon: "grid" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export function Sidebar({
  page,
  onNavigate,
  proxy,
  settingsDisabled = false,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  proxy: ProxyStatus;
  /** The website demo cannot open the desktop Settings screen. */
  settingsDisabled?: boolean;
}) {
  return (
    <aside className="flex w-[208px] shrink-0 flex-col border-r border-white/[0.06] bg-[#080d16]/70">
      <div className="flex items-center gap-2.5 px-5 pb-6 pt-6">
        <Logo className="h-9 w-9" />
        <div className="min-w-0">
          <Wordmark className="text-base font-semibold tracking-tight text-white" />
        </div>
      </div>

      <nav className="space-y-1 px-3" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active = page === item.id;
          const disabled = settingsDisabled && item.id === "settings";
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (!disabled) onNavigate(item.id);
              }}
              className={classNames(
                "nav-item",
                active &&
                  "text-white bg-accent/20 ring-1 ring-inset ring-accent/40",
                disabled && "cursor-not-allowed opacity-60",
              )}
              aria-current={active ? "page" : undefined}
              aria-disabled={disabled || undefined}
              title={
                disabled
                  ? "Settings are available in the desktop app"
                  : undefined
              }
            >
              <Icon name={item.icon} className="relative h-4 w-4" />
              <span className="relative">{item.label}</span>
              {active ? (
                <Icon
                  name="chevron-right"
                  className="relative ml-auto h-3.5 w-3.5 text-accent/70"
                />
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto p-3">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted">
            <span
              className={classNames(
                "h-1.5 w-1.5 rounded-full",
                proxy.running
                  ? "bg-success shadow-[0_0_8px_rgba(34,197,95,0.7)]"
                  : "bg-danger",
              )}
            />
            Proxy {proxy.running ? "online" : "offline"}
          </div>
          <p
            className="mt-1.5 truncate font-mono text-xs text-slate-600"
            title={proxy.error ?? proxy.bindAddress}
          >
            {proxy.running ? proxy.bindAddress : (proxy.error ?? "Starting…")}
          </p>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-600">
            <Icon name="shield" className="h-3 w-3" />
            Stored on this device
          </div>
        </div>
      </div>
    </aside>
  );
}
