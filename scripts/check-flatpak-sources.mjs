#!/usr/bin/env node
/**
 * Fail when flatpak/flatpak-cargo-sources.json no longer matches the packages
 * locked in src-tauri/Cargo.lock.
 *
 * The Flatpak build is fully offline, so a stale generated file only surfaces
 * inside flatpak-builder as a generic Cargo resolution error. This check
 * reports the drift before the build starts.
 *
 * Usage:
 *   node scripts/check-flatpak-sources.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_PATH = path.join(ROOT, "src-tauri", "Cargo.lock");
const SOURCES_PATH = path.join(ROOT, "flatpak", "flatpak-cargo-sources.json");

const VENDOR_PREFIX = "cargo/vendor/";
const CRATES_IO_PREFIX = "https://static.crates.io/crates";
const CHECKSUM_FILENAME = ".cargo-checksum.json";

function readPackages() {
  const lock = fs.readFileSync(LOCK_PATH, "utf8");

  return lock
    .split("[[package]]")
    .slice(1)
    .map((block) => {
      const field = (name) => {
        const match = block.match(new RegExp(`^${name} = "([^"]*)"\\r?$`, "m"));
        return match?.[1];
      };

      return {
        name: field("name"),
        version: field("version"),
        source: field("source"),
        checksum: field("checksum"),
      };
    })
    .filter((pkg) => pkg.name && pkg.version);
}

function collectSources(sources, problems) {
  const archives = new Map();
  const checksums = new Map();

  for (const source of sources) {
    const dest = source.dest ?? "";
    if (!dest.startsWith(VENDOR_PREFIX)) {
      continue;
    }

    if (source.type === "archive") {
      if (archives.has(dest)) {
        problems.push(`duplicate crate archive for ${dest}`);
      }
      archives.set(dest, source);
    } else if (source["dest-filename"] === CHECKSUM_FILENAME) {
      if (checksums.has(dest)) {
        problems.push(`duplicate ${CHECKSUM_FILENAME} for ${dest}`);
      }
      checksums.set(dest, source);
    }
  }

  return { archives, checksums };
}

const packages = readPackages();
const sources = JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8"));
const problems = [];
const { archives, checksums } = collectSources(sources, problems);

const registry = packages.filter((pkg) => pkg.source?.startsWith("registry+"));
const git = packages.filter((pkg) => pkg.source?.startsWith("git+"));
const other = packages.filter(
  (pkg) =>
    pkg.source &&
    !pkg.source.startsWith("registry+") &&
    !pkg.source.startsWith("git+"),
);

if (git.length > 0) {
  problems.push(
    `git dependencies are not covered by this check (${git
      .map((pkg) => `${pkg.name} ${pkg.version}`)
      .join(", ")}); extend scripts/check-flatpak-sources.mjs`,
  );
}
for (const pkg of other) {
  problems.push(
    `unsupported source for ${pkg.name} ${pkg.version}: ${pkg.source}`,
  );
}

const expected = new Set();

for (const pkg of registry) {
  const key = `${pkg.name}-${pkg.version}`;
  const dest = `${VENDOR_PREFIX}${key}`;
  expected.add(dest);

  if (!pkg.checksum) {
    problems.push(`${pkg.name} ${pkg.version} has no checksum in Cargo.lock`);
    continue;
  }

  const archive = archives.get(dest);
  if (!archive) {
    problems.push(`missing crate archive for ${key}`);
  } else {
    const expectedUrl = `${CRATES_IO_PREFIX}/${pkg.name}/${key}.crate`;
    if (archive.url !== expectedUrl) {
      problems.push(`${dest} has url ${archive.url}, expected ${expectedUrl}`);
    }
    if (archive.sha256 !== pkg.checksum) {
      problems.push(
        `${dest} has sha256 ${archive.sha256}, expected ${pkg.checksum}`,
      );
    }
  }

  const checksum = checksums.get(dest);
  if (!checksum) {
    problems.push(`missing ${CHECKSUM_FILENAME} for ${key}`);
    continue;
  }

  let content;
  try {
    content = JSON.parse(checksum.contents);
  } catch {
    problems.push(`${dest} has invalid ${CHECKSUM_FILENAME} contents`);
    continue;
  }

  if (
    !content ||
    typeof content !== "object" ||
    content.package !== pkg.checksum
  ) {
    problems.push(`${dest} checksum entry does not match Cargo.lock`);
  }
}

for (const dest of archives.keys()) {
  if (!expected.has(dest)) {
    problems.push(`stale crate archive for ${dest}`);
  }
}
for (const dest of checksums.keys()) {
  if (!expected.has(dest)) {
    problems.push(`stale ${CHECKSUM_FILENAME} for ${dest}`);
  }
}

if (problems.length > 0) {
  console.error(
    `flatpak sources drift from src-tauri/Cargo.lock (${problems.length} problem(s)):`,
  );
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error(
    "Run `bash scripts/update-flatpak-sources.sh` and commit the regenerated files.",
  );
  process.exit(1);
}

console.log(
  `flatpak sources match Cargo.lock (${registry.length} registry crates, ${archives.size} archives)`,
);
