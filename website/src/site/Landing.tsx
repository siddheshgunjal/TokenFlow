import { useMemo, type ReactNode } from "react";

import logoMark from "../assets/logo-mark.png";
import { Icon, type IconName } from "../demo/components/Icons";
import {
  formatCompact,
  formatMoney,
  formatNumber,
  formatPercent,
} from "../demo/lib/format";
import { mockCoreSnapshot } from "../demo/lib/mock";
import { DemoEmbed } from "./DemoEmbed";
import { latestReleaseVersion } from "./releaseVersion";

const GITHUB_URL = "https://github.com/siddheshgunjal/TokenFlow";
const RELEASES_URL =
  "https://github.com/siddheshgunjal/TokenFlow/releases/latest";
const README_URL = "https://github.com/siddheshgunjal/TokenFlow#readme";
const CONTRIBUTING_URL =
  "https://github.com/siddheshgunjal/TokenFlow/blob/main/CONTRIBUTING.md";
const PORTFOLIO_URL = "https://siddheshgunjal.github.io/";

type OS = "macOS" | "Windows" | "Linux" | "Desktop";
type DownloadPlatform = Exclude<OS, "Desktop">;

const FEATURES: Array<{
  icon: IconName;
  title: string;
  description: string;
}> = [
  {
    icon: "activity",
    title: "Token accounting",
    description:
      "Input, output, context, and cached tokens captured per request — not estimated.",
  },
  {
    icon: "database",
    title: "Cache visibility",
    description:
      "Token-weighted cache hit rate across models, days, and individual requests.",
  },
  {
    icon: "grid",
    title: "Calendar drill-down",
    description:
      "A month heatmap for every metric, with a 24-hour chart for any selected day.",
  },
  {
    icon: "terminal",
    title: "Model breakdown",
    description:
      "See which models are doing the work and how your tokens split between them.",
  },
  {
    icon: "wallet",
    title: "DeepSeek balance",
    description:
      "Track your available balance and chart its trend by day, week, or month.",
  },
  {
    icon: "shield",
    title: "Private and lightweight",
    description:
      "Loopback-only proxy, local processing, no telemetry. ~80 MB in the background.",
  },
];

function detectOS(): OS {
  if (typeof navigator === "undefined") return "Desktop";
  const ua = navigator.userAgent;

  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
  if (/CrOS/i.test(ua)) return "Desktop";
  if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return "Linux";
  return "Desktop";
}

export function Landing() {
  return (
    <div id="top" className="app-surface min-h-screen">
      <SiteHeader />
      <main>
        <Hero />
        <DemoSection />
        <FeatureSection />
        <MemorySection />
        <HowItWorks />
        <DownloadSection />
      </main>
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-canvas/75 backdrop-blur-xl">
      <div className="mx-auto grid h-16 max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-5 lg:px-8">
        <a
          href="#top"
          className="flex min-w-0 items-center gap-2.5 justify-self-start"
        >
          <img
            src={logoMark}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="h-8 w-8 shrink-0 object-contain"
          />
          <span className="shrink-0 text-lg font-bold tracking-tight text-white">
            TokenFlow
          </span>
        </a>

        <nav className="hidden items-center gap-4 justify-self-center text-sm text-muted md:flex lg:gap-6">
          <a href="#features" className="transition-colors hover:text-ink">
            Features
          </a>
          <a href="#memory" className="transition-colors hover:text-ink">
            Memory
          </a>
          <a href="#how-it-works" className="transition-colors hover:text-ink">
            How it works
          </a>
          <a href="#download" className="transition-colors hover:text-ink">
            Download
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 transition-colors hover:text-ink"
          >
            GitHub
            <Icon name="external" className="h-3 w-3" />
          </a>
        </nav>

        <div className="col-start-3 flex shrink-0 items-center gap-2 justify-self-end">
          <a
            href="#demo"
            className="btn-secondary hidden px-3 py-1.5 text-[13px] lg:inline-flex"
          >
            Try demo
          </a>
          <a href="#download" className="btn-primary px-3 py-1.5 text-[13px]">
            Download
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  const os = detectOS();

  return (
    <section className="relative overflow-hidden border-b border-white/[0.06]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(800px_400px_at_50%_0%,rgba(0,212,192,0.12),transparent_70%),radial-gradient(700px_380px_at_80%_10%,rgba(47,107,255,0.08),transparent_70%)]" />
      <div className="relative mx-auto flex max-w-4xl flex-col items-center px-5 pb-12 pt-12 text-center lg:pb-16 lg:pt-16">
        <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/[0.06] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(0,212,192,0.8)]" />
          Open source · Private by design
        </div>

        <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl lg:text-7xl">
          Know exactly where your <span className="text-accent">tokens</span>{" "}
          go.
        </h1>

        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted sm:text-xl">
          TokenFlow is a private dashboard for Ollama and DeepSeek usage. See
          input, output, context, cache hits, model spend, and balance without
          uploading your usage data anywhere.
        </p>

        <div className="mt-7 flex w-full max-w-xs flex-col items-stretch justify-center gap-3 sm:max-w-none sm:flex-row sm:items-center">
          <a href="#download" className="btn-primary px-5 py-2.5 text-base">
            Download for {os}
          </a>
          <a href="#demo" className="btn-secondary px-5 py-2.5 text-base">
            Try the live dashboard
            <Icon name="arrow-up-right" className="h-4 w-4" />
          </a>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="shield" className="h-3.5 w-3.5 text-success" />
            No telemetry
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="database" className="h-3.5 w-3.5 text-accent" />
            Local processing
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="key" className="h-3.5 w-3.5 text-warning" />
            Keychain-backed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="terminal" className="h-3.5 w-3.5 text-accent" />
            Rust · ~80 MB
          </span>
        </div>

        <div className="mt-10 w-full max-w-lg lg:hidden">
          <HeroPreview />
        </div>
      </div>
    </section>
  );
}

function HeroPreview() {
  const snapshot = useMemo(() => mockCoreSnapshot(), []);
  const days = snapshot.daily.slice(-14);
  const maxDay = Math.max(...days.map((day) => day.totalTokens), 1);
  const recentTotal = days.reduce((sum, day) => sum + day.totalTokens, 0);
  const balance = snapshot.latestBalance;

  return (
    <div className="relative">
      <div className="absolute -inset-6 rounded-[2rem] bg-accent/[0.06] blur-3xl" />
      <div className="card relative overflow-hidden p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20">
              <Icon name="grid" className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[13px] font-semibold text-ink">
                Usage overview
              </p>
              <p className="text-[11px] text-muted">Sample dashboard</p>
            </div>
          </div>
          <span className="chip text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_8px_rgba(34,197,95,0.7)]" />
            Mock preview
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <MiniStat
            label="Input today"
            value={formatCompact(snapshot.totals.todayNewInputTokens)}
            tone="accent"
          />
          <MiniStat
            label="Output today"
            value={formatCompact(snapshot.totals.todayOutputTokens)}
            tone="blue"
          />
          <MiniStat
            label="Cache hit"
            value={formatPercent(snapshot.totals.cacheHitRate)}
            tone="amber"
          />
        </div>

        <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>Last 14 days</span>
            <span className="font-mono tabular-nums">
              {formatCompact(recentTotal)} tokens
            </span>
          </div>
          <div className="mt-3 flex h-24 items-end gap-1.5">
            {days.map((day) => (
              <span
                key={day.date}
                title={`${day.date} · ${formatNumber(day.totalTokens)} tokens`}
                className={`min-w-0 flex-1 rounded-t-[3px] ${
                  day.totalTokens > 0
                    ? "bg-gradient-to-t from-accent/20 to-accent/80"
                    : "bg-white/[0.06]"
                }`}
                style={{
                  height: `${Math.max(
                    4,
                    Math.round((day.totalTokens / maxDay) * 100),
                  )}%`,
                }}
              />
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <span className="inline-flex items-center gap-2 text-[13px] text-muted">
            <Icon name="wallet" className="h-4 w-4 text-accent-blue" />
            DeepSeek balance
          </span>
          <span className="font-mono text-base font-semibold tabular-nums text-white">
            {formatMoney(
              balance?.totalBalance ?? "0",
              balance?.currency ?? "USD",
            )}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="zap" className="h-3 w-3 text-warning" />
            {snapshot.streakDays}-day streak
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="terminal" className="h-3 w-3 text-accent" />
            {snapshot.models.length} models tracked
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="activity" className="h-3 w-3 text-accent-blue" />
            {formatCompact(snapshot.totals.totalTokens)} in 30 days
          </span>
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "accent" | "blue" | "amber";
}) {
  const dot = {
    accent: "bg-accent",
    blue: "bg-accent-blue",
    amber: "bg-warning",
  }[tone];

  return (
    <div className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <p className="truncate text-[11px] text-muted">{label}</p>
      </div>
      <p className="mt-1.5 truncate font-mono text-base font-semibold tabular-nums text-white">
        {value}
      </p>
    </div>
  );
}

function DemoSection() {
  return (
    <section
      id="demo"
      className="scroll-mt-20 border-b border-white/[0.06] py-12 sm:py-16"
    >
      <div className="mx-auto max-w-[1408px] px-5 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-base font-semibold uppercase tracking-[0.18em] text-accent">
            Interactive demo
          </p>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Try clicking around, It's real!
          </h2>
          {/*<p className="mt-3 text-base leading-8 text-muted sm:text-lg">
            This is the real TokenFlow UI, running entirely in your browser with
            sample data. Click through months, inspect a day, filter models,
            hover the charts, or hit refresh.
          </p>*/}
        </div>

        <div className="mt-8">
          <DemoEmbed />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="shield" className="h-3.5 w-3.5 text-success" />
            No data leaves your browser
          </span>
          <span className="text-white/10">·</span>
          <span>Same deterministic mock data as the desktop app</span>
          <span className="text-white/10">·</span>
          <span>No install or account required</span>
        </div>
      </div>
    </section>
  );
}

function FeatureSection() {
  return (
    <section id="features" className="scroll-mt-20 py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-base font-semibold uppercase tracking-[0.18em] text-accent">
            Features
          </p>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Understand the real cost of every prompt.
          </h2>
          <p className="mt-3 text-base leading-8 text-muted sm:text-lg">
            TokenFlow turns raw request logs into the numbers that matter:
            tokens, context, cache efficiency, model mix, and balance.
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="card flex flex-col items-center p-5 text-center transition-colors hover:border-white/[0.14] hover:bg-white/[0.03]"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20">
                <Icon name={feature.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-ink">
                {feature.title}
              </h3>
              <p className="mt-2 text-[15px] leading-7 text-muted">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MemorySection() {
  return (
    <section
      id="memory"
      className="scroll-mt-20 border-t border-white/[0.06] py-12 sm:py-16"
    >
      <div className="mx-auto max-w-5xl px-5 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-base font-semibold uppercase tracking-[0.18em] text-accent">
            Memory
          </p>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Unlike Electron
            <span className="block">TokenFlow stays put.</span>
          </h2>
          <p className="mt-3 text-base leading-8 text-muted sm:text-lg">
            Browser and Electron-based tools can open around 300 MB and climb
            toward 800 as you keep working. TokenFlow is built with Rust and
            stays near 80 MB in the background.
          </p>
        </div>

        <div className="mt-10 space-y-8 sm:space-y-10">
          <MemoryRow
            name="TokenFlow"
            subtitle="Typical background use"
            dots={
              <div className="flex w-full flex-wrap justify-center gap-1.5 lg:justify-start">
                <Dots count={8} tone="accent" />
              </div>
            }
            value="~80"
          />
          <MemoryRow
            name="Typical Electron app"
            subtitle="Grows with use"
            dots={
              <div className="flex w-full flex-wrap justify-center gap-1.5 lg:justify-start">
                <Dots count={30} tone="solid" />
                <Dots count={50} tone="faded" />
              </div>
            }
            value="300–800"
          />
        </div>

        <p className="mt-8 text-center text-[13px] leading-6 text-muted/70">
          One dot is 10 MB. TokenFlow stays around 80 MB in the background. The
          fainter dots are the memory a typical Electron app picks up over a
          long run.
        </p>
      </div>
    </section>
  );
}

function MemoryRow({
  name,
  subtitle,
  dots,
  value,
}: {
  name: string;
  subtitle: string;
  dots: ReactNode;
  value: string;
}) {
  return (
    <div className="grid gap-3 text-center lg:grid-cols-[12rem_1fr_auto] lg:items-center lg:gap-6 lg:text-left">
      <div>
        <p className="text-base font-semibold text-ink sm:text-lg">{name}</p>
        <p className="text-[13px] text-muted">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1" aria-hidden="true">
        {dots}
      </div>
      <p className="font-semibold tracking-tight text-white tabular-nums text-4xl sm:text-5xl lg:text-right">
        {value}
        <span className="ml-1 font-sans text-base font-medium text-muted">
          MB
        </span>
      </p>
    </div>
  );
}

function Dots({
  count,
  tone,
}: {
  count: number;
  tone: "accent" | "solid" | "faded";
}) {
  const color = {
    accent: "bg-accent",
    solid: "bg-ink/80",
    faded: "bg-white/[0.08]",
  }[tone];

  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <span
          key={`${tone}-${index}`}
          className={`h-2.5 w-2.5 rounded-full ${color}`}
        />
      ))}
    </>
  );
}

function HowItWorks() {
  const steps = [
    {
      title: "Point your client at the proxy",
      description:
        "Launch TokenFlow, then use the loopback proxy URL in Cursor, Continue, Cline, or any Ollama client.",
      code: "http://127.0.0.1:11435",
    },
    {
      title: "Keep working as usual",
      description:
        "Requests pass through unchanged to Ollama. TokenFlow records the response stream without modifying it.",
    },
    {
      title: "Watch the dashboard fill in",
      description:
        "Totals, model breakdowns, cache rates, and day-level charts update as your requests complete.",
    },
  ];

  return (
    <section
      id="how-it-works"
      className="scroll-mt-20 border-t border-white/[0.06] py-12 sm:py-16"
    >
      <div className="mx-auto max-w-5xl px-5 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-base font-semibold uppercase tracking-[0.18em] text-accent">
            How it works
          </p>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Three steps, no changes to Ollama.
          </h2>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {steps.map((step, index) => (
            <div
              key={step.title}
              className="card flex flex-col items-center p-5 text-center"
            >
              <span className="font-mono text-[13px] font-semibold text-accent/80">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-3 text-base font-semibold text-ink">
                {step.title}
              </h3>
              <p className="mt-2 text-[15px] leading-7 text-muted">
                {step.description}
              </p>
              {step.code ? (
                <code className="mt-4 block w-full overflow-x-auto rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-center font-mono text-[14px] text-accent">
                  {step.code}
                </code>
              ) : null}
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[13px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="shield" className="h-3.5 w-3.5 text-success" />
            Loopback only
          </span>
          <span className="text-white/10">·</span>
          <span>Your Ollama server stays untouched</span>
          <span className="text-white/10">·</span>
          <a
            href={README_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-ink hover:text-white"
          >
            Read the setup guide
            <Icon name="external" className="h-3 w-3" />
          </a>
        </div>
      </div>
    </section>
  );
}

function DownloadSection() {
  const detectedOS = detectOS();
  const platforms: Array<{
    name: DownloadPlatform;
    description: string;
  }> = [
    {
      name: "Linux",
      description: ".flatpak, .rpm, .deb or AppImage for x64 and arm64.",
    },
    {
      name: "macOS",
      description:
        "A .dmg for Apple Silicon and Intel Macs. Not notarized yet.",
    },
    {
      name: "Windows",
      description: "An .exe installer for x64 and arm64. Not signed yet.",
    },
  ];

  return (
    <section
      id="download"
      className="scroll-mt-20 border-t border-white/[0.06] py-12 sm:py-16"
    >
      <div className="mx-auto max-w-5xl px-5 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-base font-semibold uppercase tracking-[0.18em] text-accent">
            Download
          </p>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Download TokenFlow
          </h2>
          <p className="mt-3 text-base leading-8 text-muted sm:text-lg">
            Free and open source. Built with Rust, the desktop app uses about 80
            MB in the background.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {platforms.map((platform) => {
            const isCurrent = platform.name === detectedOS;
            return (
              <div
                key={platform.name}
                className="flex flex-col items-center rounded-2xl bg-white/[0.02] p-5 text-center transition-colors hover:bg-white/[0.04]"
              >
                <h3 className="text-lg font-semibold text-ink">
                  {platform.name}
                </h3>
                <p className="mt-2 text-[15px] leading-7 text-muted">
                  {platform.description}
                </p>
                <a
                  href={RELEASES_URL}
                  target="_blank"
                  rel="noreferrer"
                  className={`mt-5 w-full text-base ${
                    isCurrent ? "btn-primary" : "btn-secondary"
                  }`}
                >
                  Download for {platform.name}
                </a>
              </div>
            );
          })}
        </div>

        <p className="mt-6 text-center text-sm leading-5 text-muted/70">
          All releases are built from source on GitHub. See the release page for
          checksums and notes.
        </p>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-5 py-6 text-[13px] text-muted sm:flex-row sm:justify-between lg:px-8">
        <div className="flex items-center gap-2.5">
          <img
            src={logoMark}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="h-5 w-5 object-contain"
          />
          <span className="font-semibold text-ink">TokenFlow</span>
          <span className="text-muted/60">{latestReleaseVersion}</span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-ink"
          >
            GitHub
          </a>
          <a
            href={`${GITHUB_URL}/issues`}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-ink"
          >
            Issues
          </a>
          <a
            href={CONTRIBUTING_URL}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-ink"
          >
            Contributing
          </a>
        </div>

        <p className="text-center text-[12px] text-muted/60 sm:text-right">
          © {new Date().getFullYear()} Made by{" "}
          <a
            href={PORTFOLIO_URL}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline-offset-2 transition-colors hover:text-accent-hover hover:underline"
          >
            Siddhesh Gunjal
          </a>
        </p>
      </div>
    </footer>
  );
}
