#!/usr/bin/env node
// Forward wrapper for preparing release Flatpak metadata from any cwd.

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(ROOT, "scripts", "prepare-flatpak-release.mjs");
const result = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
