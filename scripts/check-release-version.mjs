#!/usr/bin/env node
/**
 * Verify the root VERSION file and, when a tag is supplied, that the release
 * tag is exactly v<VERSION>.
 *
 * Usage:
 *   node scripts/check-release-version.mjs
 *   node scripts/check-release-version.mjs --tag v0.1.0
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const version = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const sync = spawnSync(process.execPath, ["scripts/sync-version.mjs", "--check"], {
  cwd: ROOT,
  stdio: "inherit",
});
if (sync.status !== 0) {
  process.exit(sync.status ?? 1);
}

const tag = argument("--tag");
if (tag !== undefined && tag !== "") {
  const expected = `v${version}`;
  if (tag !== expected) {
    console.error(`release tag ${tag} does not match VERSION (expected ${expected})`);
    process.exit(1);
  }
}

console.log(`version ${version}${tag ? ` (${tag})` : ""} is consistent`);
