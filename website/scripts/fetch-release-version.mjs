import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const websiteRoot = join(repoRoot, "website");
const target = join(websiteRoot, "src/site/releaseVersion.ts");
const downloadsTarget = join(websiteRoot, "src/site/releaseDownloads.ts");
const packageJson = JSON.parse(
  readFileSync(join(websiteRoot, "package.json"), "utf8"),
);
const repository = "siddheshgunjal/TokenFlow";
const apiUrl = `https://api.github.com/repos/${repository}/releases?per_page=100`;
const releasesFeedUrl = `https://github.com/${repository}/releases.atom`;

function readToken() {
  const fromEnv =
    process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
  } catch {
    return "";
  }
}

const token = readToken();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function normalize(tag) {
  const value = String(tag ?? "").trim();
  if (!value) return null;
  return value.startsWith("v") ? value : `v${value}`;
}

function existingFallback() {
  try {
    const source = readFileSync(target, "utf8");
    const match = source.match(/latestReleaseVersion\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  } catch {
    // First run: fall through to the website package version.
  }
  return normalize(packageJson.version) ?? "v0.0.0";
}

function runCurl(
  url,
  { accept = "application/vnd.github+json", auth = true } = {},
) {
  let output;
  try {
    output = execFileSync(
      "curl",
      [
        "-sS",
        "-L",
        "--max-time",
        "15",
        "-H",
        `Accept: ${accept}`,
        "-H",
        "User-Agent: tokenflow-website",
        ...(auth && token ? ["-H", `Authorization: Bearer ${token}`] : []),
        "-w",
        "\n%{http_code}",
        url,
      ],
      { encoding: "utf8" },
    );
  } catch (error) {
    // Do not surface error.message: it contains the full command line,
    // including the Authorization header when a token is configured.
    const detail = [error.stderr, error.stdout]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(detail || "curl request failed");
  }

  const splitAt = output.lastIndexOf("\n");
  if (splitAt === -1) return output;

  const body = output.slice(0, splitAt);
  const status = Number(output.slice(splitAt + 1).trim());
  if (status < 200 || status >= 300) {
    let message = `GitHub returned ${status}`;
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        message += `: ${parsed.message.trim()}`;
      }
    } catch {
      // Non-JSON error body; the status is enough.
    }
    throw new HttpError(status, message);
  }
  return body;
}

async function fetchReleases() {
  // curl honors the environment's HTTP(S) proxy settings, which Node's fetch
  // does not. Fall back to fetch for environments without curl.
  try {
    return JSON.parse(runCurl(apiUrl));
  } catch (curlError) {
    if (curlError.status) {
      throw curlError;
    }
    try {
      const response = await fetch(apiUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "tokenflow-website",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `GitHub API returned ${response.status}${body ? `: ${body}` : ""}`,
        );
      }
      return await response.json();
    } catch (fetchError) {
      throw new Error(
        `curl: ${curlError.message}; fetch: ${fetchError.message}`,
      );
    }
  }
}

async function fetchLatestFromFeed() {
  // The public releases Atom feed is not subject to the REST API's
  // unauthenticated limit. It does not expose the stable/prerelease flag, so
  // use it only as a best-effort fallback when the API is unavailable.
  const feed = runCurl(releasesFeedUrl, {
    accept: "application/atom+xml",
    auth: false,
  });
  const entry = feed.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
  if (!entry) {
    throw new Error("releases feed did not contain an entry");
  }

  const href = entry.match(/\/releases\/tag\/([^"]+)"/)?.[1];
  const title = entry.match(/<title>([^<]+)<\/title>/)?.[1];
  const value = href ? decodeURIComponent(href) : title;
  if (!value) {
    throw new Error("releases feed entry did not contain a tag");
  }
  return normalize(value.trim());
}

// ---------------------------------------------------------------------------
// Release download snapshot generation.
//
// IMPORTANT: the asset regexes below and the selection/build semantics MUST
// stay in sync with website/src/site/downloads.ts. They are duplicated here
// so the build script (which cannot import TS) produces the same snapshot
// the runtime fetch path would select.
// ---------------------------------------------------------------------------

// Asset naming conventions (lowercased before matching):
//   linux:   TokenFlow-<version>-linux-(x86_64|aarch64).(deb|rpm|appimage|flatpak)
//   macos:   TokenFlow-<version>-macos-(x86_64|aarch64).dmg
//   windows: TokenFlow-<version>-windows-(x86_64|aarch64)-setup.exe
const LINUX_RE =
  /^tokenflow-[^/]+-linux-(x86_64|aarch64)\.(deb|rpm|appimage|flatpak)$/;
const MACOS_RE = /^tokenflow-[^/]+-macos-(x86_64|aarch64)\.dmg$/;
const WINDOWS_RE = /^tokenflow-[^/]+-windows-(x86_64|aarch64)-setup\.exe$/;

function classifyAsset(name) {
  const lower = String(name ?? "").toLowerCase();

  const linux = LINUX_RE.exec(lower);
  if (linux) {
    return { platform: "linux", arch: linux[1], format: linux[2] };
  }
  const macos = MACOS_RE.exec(lower);
  if (macos) return { platform: "macos", arch: macos[1] };
  const windows = WINDOWS_RE.exec(lower);
  if (windows) return { platform: "windows", arch: windows[1] };
  return null;
}

function hasRecognizedAssets(release) {
  return (release.assets ?? []).some(
    (asset) => classifyAsset(asset.name) !== null,
  );
}

function sortByPublishedDesc(releases) {
  return [...releases].sort(
    (a, b) =>
      Date.parse(b.published_at ?? b.created_at ?? "") -
      Date.parse(a.published_at ?? a.created_at ?? ""),
  );
}

// Selection rule: latest stable with assets wins; then latest prerelease with
// assets; then any stable/prerelease. Drafts are always excluded.
function pickDownloadRelease(releases) {
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

function buildDownloads(release) {
  const downloads = {
    tag: release.tag_name ?? "",
    releaseUrl: release.html_url ?? `https://github.com/${repository}/releases`,
    publishedAt: release.published_at ?? null,
    prerelease: Boolean(release.prerelease),
    linux: { x86_64: {}, aarch64: {} },
    macos: {},
    windows: {},
  };

  for (const asset of release.assets ?? []) {
    const kind = classifyAsset(asset.name);
    if (!kind || !asset.browser_download_url) continue;
    const entry = {
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

// Fresh-checkout fallback: synthesize asset URLs from the naming convention
// used by scripts/collect-bundles.sh and scripts/build-flatpak.sh. Sizes are
// unknown (0) because the API was unavailable.
function conventionSnapshot(tag) {
  const version = tag.startsWith("v") ? tag.slice(1) : tag;
  const base = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}`;

  const asset = (name) => ({ url: `${base}/${name}`, size: 0 });

  const linux = { x86_64: {}, aarch64: {} };
  const macos = {};
  const windows = {};

  for (const arch of ["x86_64", "aarch64"]) {
    linux[arch].deb = asset(`TokenFlow-${version}-linux-${arch}.deb`);
    linux[arch].rpm = asset(`TokenFlow-${version}-linux-${arch}.rpm`);
    linux[arch].appimage = asset(`TokenFlow-${version}-linux-${arch}.AppImage`);
    linux[arch].flatpak = asset(`TokenFlow-${version}-linux-${arch}.flatpak`);
    macos[arch] = asset(`TokenFlow-${version}-macos-${arch}.dmg`);
    windows[arch] = asset(`TokenFlow-${version}-windows-${arch}-setup.exe`);
  }

  return {
    tag,
    releaseUrl: `https://github.com/${repository}/releases/tag/${encodeURIComponent(tag)}`,
    publishedAt: null,
    prerelease: /(?:alpha|beta|rc)/i.test(tag),
    linux,
    macos,
    windows,
  };
}

function countAssets(data) {
  let count = 0;
  for (const arch of ["x86_64", "aarch64"]) {
    count += Object.keys(data.linux[arch] ?? {}).length;
  }
  count += Object.keys(data.macos ?? {}).length;
  count += Object.keys(data.windows ?? {}).length;
  return count;
}

function fileExists(path) {
  try {
    readFileSync(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

function writeSnapshot(data) {
  writeFileSync(
    downloadsTarget,
    `// Generated by scripts/fetch-release-version.mjs. Do not edit by hand.\nimport type { ReleaseDownloads } from "./downloads";\n\nexport const latestReleaseDownloads: ReleaseDownloads = ${JSON.stringify(data, null, 2)};\n`,
  );
}

function generateDownloadsSnapshot(releases, version) {
  const apiOk = Array.isArray(releases);

  let selected = null;
  if (apiOk) {
    selected = pickDownloadRelease(releases);
  }

  // Real API data with recognizable assets: emit a snapshot from it.
  if (selected && hasRecognizedAssets(selected)) {
    const data = buildDownloads(selected);
    writeSnapshot(data);
    console.log(`release downloads: ${data.tag} (${countAssets(data)} assets)`);
    return;
  }

  // The API responded but the selected release has no recognizable assets
  // (e.g. mid-upload). Never emit an empty snapshot over a working one.
  if (apiOk) {
    console.warn(
      "release downloads: selected release has no recognized assets; keeping existing snapshot",
    );
    return;
  }

  // The API was unavailable. Do not overwrite an existing committed snapshot.
  if (fileExists(downloadsTarget)) {
    console.warn(
      "release downloads: API unavailable; keeping existing snapshot",
    );
    return;
  }

  // Fresh checkout with no API data: synthesize a convention-based snapshot.
  const data = conventionSnapshot(normalize(version));
  writeSnapshot(data);
  console.log(`release downloads: convention snapshot for ${data.tag}`);
}

async function main() {
  let version = null;
  let source = "";
  let releases = null;

  try {
    releases = await fetchReleases();
    const visible = releases.filter((release) => !release.draft);
    const stable = visible.find((release) => !release.prerelease);
    const selected = stable ?? visible.find((release) => release.prerelease);

    if (selected) {
      version = normalize(selected.tag_name ?? selected.name);
      source = stable ? "latest stable release" : "latest pre-release";
    }
  } catch (error) {
    console.warn(`release version sync skipped: ${error.message}`);
    if (/rate limit/i.test(error.message)) {
      console.warn(
        "hint: set GITHUB_TOKEN or GH_TOKEN (or authenticate gh) to raise the GitHub API rate limit",
      );
    }
  }

  if (!version) {
    try {
      version = await fetchLatestFromFeed();
      source = "latest release from Atom feed";
    } catch (error) {
      console.warn(`release feed fallback skipped: ${error.message}`);
    }
  }

  if (!version) {
    version = existingFallback();
    source = "existing fallback";
  }

  writeFileSync(
    target,
    `// Generated by scripts/fetch-release-version.mjs. Do not edit by hand.\nexport const latestReleaseVersion = ${JSON.stringify(version)};\n`,
  );
  console.log(`release version: ${version} (${source})`);

  generateDownloadsSnapshot(releases, version);
}

main();
