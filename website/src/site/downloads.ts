export const GITHUB_REPO_URL = "https://github.com/siddheshgunjal/TokenFlow";
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`;
export const RELEASES_API_URL =
  "https://api.github.com/repos/siddheshgunjal/TokenFlow/releases?per_page=30";

export type ReleaseArch = "x86_64" | "aarch64";
export const LINUX_FORMATS = ["flatpak", "rpm", "deb", "appimage"] as const;
export type LinuxFormat = (typeof LINUX_FORMATS)[number];

export interface ReleaseAsset {
  url: string;
  size: number; // bytes; 0 when unknown
}

export interface ReleaseDownloads {
  tag: string;
  releaseUrl: string;
  publishedAt: string | null;
  prerelease: boolean;
  linux: Record<ReleaseArch, Partial<Record<LinuxFormat, ReleaseAsset>>>;
  macos: Partial<Record<ReleaseArch, ReleaseAsset>>;
  windows: Partial<Record<ReleaseArch, ReleaseAsset>>;
}

type AssetKind =
  | { platform: "linux"; arch: ReleaseArch; format: LinuxFormat }
  | { platform: "macos" | "windows"; arch: ReleaseArch };

interface ReleaseLike {
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  created_at?: string | null;
  tag_name?: string | null;
  html_url?: string | null;
  assets?: Array<{
    name?: string | null;
    browser_download_url?: string | null;
    size?: number | null;
  }>;
}

// Asset naming conventions (lowercased before matching):
//   linux:   TokenFlow-<version>-linux-(x86_64|aarch64).(deb|rpm|appimage|flatpak)
//   macos:   TokenFlow-<version>-macos-(x86_64|aarch64).dmg
//   windows: TokenFlow-<version>-windows-(x86_64|aarch64)-setup.exe
const LINUX_RE =
  /^tokenflow-[^/]+-linux-(x86_64|aarch64)\.(deb|rpm|appimage|flatpak)$/;
const MACOS_RE = /^tokenflow-[^/]+-macos-(x86_64|aarch64)\.dmg$/;
const WINDOWS_RE = /^tokenflow-[^/]+-windows-(x86_64|aarch64)-setup\.exe$/;

function classifyAsset(name: string): AssetKind | null {
  const lower = name.toLowerCase();

  const linux = LINUX_RE.exec(lower);
  if (linux) {
    return {
      platform: "linux",
      arch: linux[1] as ReleaseArch,
      format: linux[2] as LinuxFormat,
    };
  }
  const macos = MACOS_RE.exec(lower);
  if (macos) {
    return { platform: "macos", arch: macos[1] as ReleaseArch };
  }
  const windows = WINDOWS_RE.exec(lower);
  if (windows) {
    return { platform: "windows", arch: windows[1] as ReleaseArch };
  }
  return null;
}

function hasRecognizedAssets(release: ReleaseLike): boolean {
  return (release.assets ?? []).some(
    (asset) => classifyAsset(asset.name ?? "") !== null,
  );
}

function sortByPublishedDesc(releases: ReleaseLike[]): ReleaseLike[] {
  return [...releases].sort(
    (a, b) =>
      Date.parse(b.published_at ?? b.created_at ?? "") -
      Date.parse(a.published_at ?? a.created_at ?? ""),
  );
}

// Selection rule: latest stable with assets wins; then latest prerelease with
// assets; then any stable/prerelease. Drafts are always excluded.
export function pickDownloadRelease(
  releases: ReleaseLike[],
): ReleaseLike | null {
  const visible = sortByPublishedDesc(
    releases.filter((release) => !release.draft),
  );

  const stableWithAssets = visible.find(
    (release) => !release.prerelease && hasRecognizedAssets(release),
  );
  const prereleaseWithAssets = visible.find(
    (release) => release.prerelease && hasRecognizedAssets(release),
  );
  const stable = visible.find((release) => !release.prerelease);
  const prerelease = visible.find((release) => release.prerelease);

  return (
    stableWithAssets ?? prereleaseWithAssets ?? stable ?? prerelease ?? null
  );
}

export function buildDownloads(release: ReleaseLike): ReleaseDownloads {
  const downloads: ReleaseDownloads = {
    tag: release.tag_name ?? "",
    releaseUrl: release.html_url ?? GITHUB_RELEASES_URL,
    publishedAt: release.published_at ?? null,
    prerelease: Boolean(release.prerelease),
    linux: { x86_64: {}, aarch64: {} },
    macos: {},
    windows: {},
  };

  for (const asset of release.assets ?? []) {
    const kind = classifyAsset(asset.name ?? "");
    if (!kind || !asset.browser_download_url) continue;
    const entry: ReleaseAsset = {
      url: asset.browser_download_url,
      size: Number.isFinite(asset.size) ? Number(asset.size) : 0,
    };
    if (kind.platform === "linux") {
      downloads.linux[kind.arch][kind.format] = entry;
    } else {
      downloads[kind.platform][kind.arch] = entry;
    }
  }

  return downloads;
}

const CACHE_KEY = "tokenflow:release-downloads:v1";
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface CachedDownloads {
  at: number;
  data: ReleaseDownloads;
}

export function loadCachedDownloads(): ReleaseDownloads | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedDownloads;
    if (
      typeof cached?.at !== "number" ||
      Date.now() - cached.at > CACHE_TTL_MS ||
      !cached.data ||
      typeof cached.data.tag !== "string"
    ) {
      return null;
    }
    return cached.data;
  } catch {
    return null;
  }
}

export function saveCachedDownloads(data: ReleaseDownloads): void {
  try {
    const payload: CachedDownloads = { at: Date.now(), data };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Storage unavailable (privacy mode / disabled); the snapshot still works.
  }
}

export async function fetchLatestDownloads(
  signal?: AbortSignal,
): Promise<ReleaseDownloads | null> {
  try {
    const response = await fetch(RELEASES_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
      signal,
    });
    if (!response.ok) return null;

    const releases = (await response.json()) as ReleaseLike[];
    if (!Array.isArray(releases)) return null;

    const selected = pickDownloadRelease(releases);
    if (!selected || !hasRecognizedAssets(selected)) return null;

    return buildDownloads(selected);
  } catch {
    // Network failure, parse error, or abort.
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}
