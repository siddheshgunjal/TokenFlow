import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Icon } from "../demo/components/Icons";
import {
  fetchLatestDownloads,
  formatBytes,
  GITHUB_RELEASES_URL,
  LINUX_FORMATS,
  loadCachedDownloads,
  saveCachedDownloads,
  type LinuxFormat,
  type ReleaseAsset,
  type ReleaseArch,
  type ReleaseDownloads,
} from "./downloads";
import type { DownloadPlatform } from "./platform";
import { latestReleaseDownloads } from "./releaseDownloads";

interface DownloadDialogProps {
  open: boolean;
  /** The platform to show; the dialog opens directly to its options. */
  platform: DownloadPlatform;
  onClose: () => void;
}

const LINUX_FORMAT_LABELS: Record<LinuxFormat, [string, string]> = {
  deb: ["Debian / Ubuntu", ".deb"],
  rpm: ["Fedora / RHEL", ".rpm"],
  appimage: ["AppImage", ".AppImage"],
  flatpak: ["Flatpak", ".flatpak"],
};

function hasAnyAsset(downloads: ReleaseDownloads): boolean {
  return (
    LINUX_FORMATS.some((format) =>
      (["x86_64", "aarch64"] as const).some(
        (arch) => downloads.linux[arch][format] !== undefined,
      ),
    ) ||
    downloads.macos.aarch64 !== undefined ||
    downloads.macos.x86_64 !== undefined ||
    downloads.windows.x86_64 !== undefined ||
    downloads.windows.aarch64 !== undefined
  );
}

function assetAriaLabel(tag: string, label: string): string {
  return `Download TokenFlow ${tag} ${label}`;
}

function DownloadRow({
  asset,
  label,
  detail,
  ariaLabel,
}: {
  asset: ReleaseAsset;
  label: string;
  detail: string;
  ariaLabel: string;
}) {
  return (
    <a
      href={asset.url}
      aria-label={ariaLabel}
      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition-colors hover:border-white/[0.16] hover:bg-white/[0.06]"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink">{label}</p>
        <p className="mt-0.5 text-[12px] text-muted">{detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-muted">
        <span className="font-mono text-[12px] tabular-nums">
          {formatBytes(asset.size)}
        </span>
        <Icon name="download" className="h-4 w-4" />
      </div>
    </a>
  );
}

export function DownloadDialog({
  open,
  platform,
  onClose,
}: DownloadDialogProps) {
  const [linuxArch, setLinuxArch] = useState<ReleaseArch>("x86_64");
  const [downloads, setDownloads] = useState<ReleaseDownloads>(
    latestReleaseDownloads,
  );
  const [refreshing, setRefreshing] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Reset to the default architecture on every open and refresh from the API.
  useEffect(() => {
    if (!open) return;
    setLinuxArch("x86_64");

    let controller: AbortController | undefined;

    const cached = loadCachedDownloads();
    if (cached) {
      setDownloads(cached);
    } else {
      const active = new AbortController();
      controller = active;
      setRefreshing(true);
      fetchLatestDownloads(active.signal).then((data) => {
        if (!active.signal.aborted) {
          setRefreshing(false);
          if (data) {
            setDownloads(data);
            saveCachedDownloads(data);
          }
        }
      });
    }

    return () => {
      controller?.abort();
    };
  }, [open]);

  // Dialog shell behavior: scroll lock, focus management, Escape key.
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const noAssets = !hasAnyAsset(downloads);
  const tag = downloads.tag;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="download-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="card relative w-full max-w-xl max-h-[90vh] overflow-y-auto p-5 animate-fade-up sm:p-6">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="download-dialog-title"
              className="text-lg font-semibold text-ink"
            >
              Download for {platform}
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-muted">
              Files download directly from the latest GitHub release.
            </p>
          </div>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            className="btn-ghost rounded-lg p-1.5"
            aria-label="Close download dialog"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </header>

        <div className="mt-4">
          {platform === "Linux" ? (
            <LinuxOptions
              downloads={downloads}
              arch={linuxArch}
              onArchChange={setLinuxArch}
              tag={tag}
            />
          ) : platform === "macOS" ? (
            <ArchOptions
              tag={tag}
              assets={[
                {
                  label: "Apple Silicon",
                  detail: "M-Series · .dmg",
                  asset: downloads.macos.aarch64,
                },
                {
                  label: "Intel",
                  detail: "x86_64 · .dmg",
                  asset: downloads.macos.x86_64,
                },
              ]}
            />
          ) : (
            <ArchOptions
              tag={tag}
              assets={[
                {
                  label: "x86_64",
                  detail: "64-bit Intel/AMD · .exe installer",
                  asset: downloads.windows.x86_64,
                },
                {
                  label: "ARM64",
                  detail: "ARM-based PCs · .exe installer",
                  asset: downloads.windows.aarch64,
                },
              ]}
            />
          )}
        </div>

        {noAssets ? (
          <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[13px] leading-5 text-muted">
            No downloadable builds are attached to this release yet. Open the
            GitHub release page to check again shortly.
          </p>
        ) : null}

        <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-4">
          <p className="text-[12px] text-muted/70">
            {downloads.prerelease ? "Latest pre-release" : "Latest release"} ·{" "}
            {downloads.tag}
            {refreshing ? " · Checking for a newer release…" : ""}
          </p>
          <a
            href={GITHUB_RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[12px] text-muted transition-colors hover:text-ink"
          >
            All releases on GitHub
            <Icon name="external" className="h-3 w-3" />
          </a>
        </footer>
        {refreshing ? (
          <p className="sr-only" aria-live="polite">
            Checking for a newer release…
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function LinuxOptions({
  downloads,
  arch,
  onArchChange,
  tag,
}: {
  downloads: ReleaseDownloads;
  arch: ReleaseArch;
  onArchChange: (arch: ReleaseArch) => void;
  tag: string;
}) {
  const arches: Array<{ value: ReleaseArch; label: string }> = [
    { value: "x86_64", label: "x86_64" },
    { value: "aarch64", label: "ARM64" },
  ];

  const rows = LINUX_FORMATS.map((format) => ({
    format,
    asset: downloads.linux[arch][format],
  })).filter((row) => row.asset !== undefined);

  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label="Architecture"
        className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1"
      >
        {arches.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={arch === option.value}
            onClick={() => onArchChange(option.value)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
              arch === option.value
                ? "bg-accent/15 text-accent"
                : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map(({ format, asset }) => (
            <DownloadRow
              key={format}
              asset={asset as ReleaseAsset}
              label={LINUX_FORMAT_LABELS[format][0]}
              detail={LINUX_FORMAT_LABELS[format][1]}
              ariaLabel={assetAriaLabel(
                tag,
                `for Linux ${arch} (${LINUX_FORMAT_LABELS[format][1]})`,
              )}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[13px] leading-5 text-muted">
          No Linux builds were found for this release yet. Check the GitHub
          release page.
        </p>
      )}
    </div>
  );
}

function ArchOptions({
  tag,
  assets,
}: {
  tag: string;
  assets: Array<{
    label: string;
    detail: string;
    asset: ReleaseAsset | undefined;
  }>;
}) {
  const present = assets.filter((entry) => entry.asset !== undefined);

  if (present.length === 0) {
    return (
      <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[13px] leading-5 text-muted">
        No builds were found for this release yet. Check the GitHub release
        page.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {present.map((entry) => (
        <DownloadRow
          key={entry.label}
          asset={entry.asset as ReleaseAsset}
          label={entry.label}
          detail={entry.detail}
          ariaLabel={assetAriaLabel(
            tag,
            `for ${entry.label} (${entry.detail})`,
          )}
        />
      ))}
    </div>
  );
}
