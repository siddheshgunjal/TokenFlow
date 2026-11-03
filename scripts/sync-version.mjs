#!/usr/bin/env node
/**
 * Propagate the root VERSION file to every place that cannot read it directly.
 *
 * Usage:
 *   node scripts/sync-version.mjs          # write derived files
 *   node scripts/sync-version.mjs --check  # fail if any derived file is stale
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function replaceOnce(content, pattern, replacement, label) {
  if (!pattern.test(content)) {
    throw new Error(`could not find the version field in ${label}`);
  }
  return content.replace(pattern, replacement);
}

const version = read("VERSION").trim();
if (!VERSION_RE.test(version)) {
  console.error(`VERSION must contain a plain semantic version, got: ${JSON.stringify(version)}`);
  process.exit(1);
}

const tag = `v${version}`;
const updates = [];
let failed = false;

function queue(relativePath, nextContent) {
  updates.push({ relativePath, nextContent });
}

// package.json
{
  const current = read("package.json");
  const next = replaceOnce(
    current,
    /(\n  "version": ")[^"]+(")/,
    `$1${version}$2`,
    "package.json",
  );
  queue("package.json", next);
}

// package-lock.json: root metadata and packages[""] metadata only.
{
  const current = read("package-lock.json");
  let next = replaceOnce(
    current,
    /(\n  "name": "tokenflow",\n  "version": ")[^"]+(")/,
    `$1${version}$2`,
    "package-lock.json root",
  );
  next = replaceOnce(
    next,
    /(\n    "": \{\n      "name": "tokenflow",\n      "version": ")[^"]+(")/,
    `$1${version}$2`,
    "package-lock.json packages entry",
  );
  queue("package-lock.json", next);
}

// Cargo.toml [package] section.
{
  const current = read("src-tauri/Cargo.toml");
  const next = replaceOnce(
    current,
    /(\[package\][\s\S]*?\nversion = ")[^"]+(")/,
    `$1${version}$2`,
    "src-tauri/Cargo.toml",
  );
  queue("src-tauri/Cargo.toml", next);
}

// Cargo.lock local package entry.
{
  const current = read("src-tauri/Cargo.lock");
  const next = replaceOnce(
    current,
    /(\[\[package\]\]\nname = "tokenflow"\nversion = ")[^"]+(")/,
    `$1${version}$2`,
    "src-tauri/Cargo.lock",
  );
  queue("src-tauri/Cargo.lock", next);
}

// Tauri config.
{
  const current = read("src-tauri/tauri.conf.json");
  const next = replaceOnce(
    current,
    /(\n  "version": ")[^"]+(")/,
    `$1${version}$2`,
    "src-tauri/tauri.conf.json",
  );
  queue("src-tauri/tauri.conf.json", next);
}

// Flatpak release manifest tag. It may not exist during early bootstrap.
const flatpakManifest = "flatpak/io.github.siddheshgunjal.TokenFlow.yml";
if (exists(flatpakManifest)) {
  const current = read(flatpakManifest);
  if (/^\s*tag:\s*v\S+/m.test(current)) {
    const next = current.replace(/^(\s*tag:\s*)v\S+/m, `$1${tag}`);
    queue(flatpakManifest, next);
  } else {
    throw new Error(`could not find the release tag in ${flatpakManifest}`);
  }
}

for (const { relativePath, nextContent } of updates) {
  const current = read(relativePath);
  if (current === nextContent) {
    continue;
  }
  if (CHECK) {
    failed = true;
    console.error(`stale version: ${relativePath}`);
  } else {
    fs.writeFileSync(path.join(ROOT, relativePath), nextContent);
    console.log(`updated ${relativePath}`);
  }
}

if (CHECK && failed) {
  console.error(`Run \`npm run version:sync\` to update files to VERSION=${version}.`);
  process.exit(1);
}
