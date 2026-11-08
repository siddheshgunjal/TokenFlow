import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Icon } from "../demo/components/Icons";

const DemoApp = lazy(() =>
  import("../demo/DemoApp").then((module) => ({
    default: module.DemoApp,
  })),
);

const LOGICAL_WIDTH = 1280;
const LOGICAL_HEIGHT = 800;
const MOBILE_BREAKPOINT = 1024;

export function DemoEmbed() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(() =>
    typeof window === "undefined" ? LOGICAL_WIDTH : window.innerWidth,
  );
  const [shouldLoad, setShouldLoad] = useState(false);

  useLayoutEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;

    const update = () => setContainerWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "250px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const isMobile = containerWidth < MOBILE_BREAKPOINT;
  const scale = Math.min(1, containerWidth / LOGICAL_WIDTH);
  const viewportHeight = LOGICAL_HEIGHT * scale;

  return (
    <div ref={wrapperRef} className="mx-auto w-full max-w-[1280px]">
      {isMobile ? (
        <DesktopOnlyNotice />
      ) : (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
            <div className="flex items-center gap-2 text-[13px]">
              <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_8px_rgba(34,197,95,0.7)]" />
              <span className="font-medium text-ink">Interactive demo</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-xs text-muted">
                Sample data
              </span>
            </div>
            <span className="hidden text-[13px] text-muted sm:inline">
              Nothing leaves your browser
            </span>
          </div>

          <div
            className="relative w-full overflow-hidden bg-canvas"
            style={{ height: viewportHeight }}
          >
            {shouldLoad ? (
              <div
                className="relative"
                style={{
                  width: LOGICAL_WIDTH * scale,
                  height: LOGICAL_HEIGHT * scale,
                }}
              >
                <div
                  className="absolute left-0 top-0"
                  style={{
                    width: LOGICAL_WIDTH,
                    height: LOGICAL_HEIGHT,
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                  }}
                >
                  <Suspense fallback={<DemoLoading />}>
                    <DemoApp />
                  </Suspense>
                </div>
              </div>
            ) : (
              <DemoPlaceholder onLaunch={() => setShouldLoad(true)} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DesktopOnlyNotice() {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/10 text-accent ring-1 ring-accent/20">
        <Icon name="monitor" className="h-5 w-5" />
      </span>
      <h3 className="mt-4 max-w-lg text-2xl font-semibold tracking-tight text-white sm:text-3xl">
        Visit on desktop to see the interactive demo
      </h3>
      <p className="mt-2 max-w-md text-base leading-7 text-muted">
        The dashboard demo needs a larger screen. Open this page on your laptop
        or desktop to try the controls.
      </p>
    </div>
  );
}

function DemoPlaceholder({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 overflow-hidden bg-[#080d16] px-6 text-center">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(700px 400px at 50% 0%, rgba(0,212,192,0.12), transparent 70%), linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize: "auto, 48px 48px, 48px 48px",
        }}
      />
      <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-accent/10 text-accent ring-1 ring-accent/20">
        <Icon name="grid" className="h-5 w-5" />
      </span>
      <div className="relative max-w-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          Live dashboard
        </p>
        <h3 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Try TokenFlow in your browser.
        </h3>
        <p className="mt-2 text-base leading-7 text-muted">
          Click through the real dashboard with sample data. No install,
          account, or network connection required.
        </p>
      </div>
      <button
        type="button"
        onClick={onLaunch}
        className="btn-primary relative px-4 py-2 text-base"
      >
        <Icon name="activity" className="h-4 w-4" />
        Launch interactive demo
      </button>
      <div className="relative grid w-full max-w-xl grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          "Token accounting",
          "Cache visibility",
          "Model breakdown",
          "DeepSeek balance",
        ].map((label) => (
          <span
            key={label}
            className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-muted"
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function DemoLoading() {
  return (
    <div className="app-surface flex h-full w-full flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-white/[0.06] px-4 text-[13px] text-muted">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        Loading demo…
      </div>
      <div className="flex-1 animate-pulse bg-white/[0.015]" />
    </div>
  );
}
