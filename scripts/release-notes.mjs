#!/usr/bin/env node
/**
 * Add or remove the "installers are building" block from a GitHub Release body.
 *
 * Usage:
 *   node scripts/release-notes.mjs add --tag v0.1.0
 *   node scripts/release-notes.mjs remove --tag v0.1.0
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SENTENCE =
  "Installers are built automatically by GitHub Actions and will appear below shortly.";
const START = "<!-- tokenflow-assets-building:start -->";
const END = "<!-- tokenflow-assets-building:end -->";
const BLOCK = `${START}\n${SENTENCE}\n${END}`;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const action = process.argv[2];
if (action !== "add" && action !== "remove") {
  fail("usage: release-notes.mjs <add|remove> --tag <tag>");
}

const tag = argument("--tag");
if (!tag) {
  fail("--tag is required");
}

function gh(args, options = {}) {
  return execFileSync("gh", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "inherit"],
  });
}

let body;
try {
  const raw = gh(["release", "view", tag, "--json", "body"]);
  body = JSON.parse(raw).body ?? "";
} catch (error) {
  fail(`could not read release ${tag}: ${error.message}`);
}

const blockPattern = new RegExp(
  `\\n?${START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`,
  "g",
);
const withoutBlock = body.replace(blockPattern, "").trimEnd();

let next;
if (action === "add") {
  next = withoutBlock ? `${withoutBlock}\n\n${BLOCK}\n` : `${BLOCK}\n`;
} else {
  next = withoutBlock ? `${withoutBlock}\n` : "";
}

if (next === body) {
  console.log(`release ${tag}: no change`);
  process.exit(0);
}

const tempDir = path.join(ROOT, "release", ".tmp");
fs.mkdirSync(tempDir, { recursive: true });
const notesFile = path.join(
  tempDir,
  `${action}-${tag.replace(/[^A-Za-z0-9_.-]/g, "_")}.md`,
);
fs.writeFileSync(notesFile, next);
try {
  gh(["release", "edit", tag, "--notes-file", notesFile], { stdio: "inherit" });
} finally {
  fs.rmSync(notesFile, { force: true });
}
console.log(
  `release ${tag}: ${action === "add" ? "added" : "removed"} building note`,
);
