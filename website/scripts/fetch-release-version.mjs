import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const websiteRoot = join(repoRoot, "website");
const target = join(websiteRoot, "src/site/releaseVersion.ts");
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

async function main() {
  let version = null;
  let source = "";

  try {
    const releases = await fetchReleases();
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
}

main();
