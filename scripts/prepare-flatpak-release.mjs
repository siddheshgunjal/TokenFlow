#!/usr/bin/env node
/**
 * Prepare the release Flatpak manifest and metainfo entry, and optionally
 * render the future Flathub submission manifest with a pinned commit.
 *
 * Usage:
 *   node scripts/prepare-flatpak-release.mjs
 *   node scripts/prepare-flatpak-release.mjs --render-flathub
 *   node scripts/prepare-flatpak-release.mjs --render-flathub --commit <sha>
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(
  ROOT,
  "flatpak",
  "io.github.siddheshgunjal.TokenFlow.yml",
);
const METAINFO = path.join(
  ROOT,
  "flatpak",
  "io.github.siddheshgunjal.TokenFlow.metainfo.xml",
);
const FLATHUB_OUTPUT = path.join(
  ROOT,
  "release",
  "flathub",
  "io.github.siddheshgunjal.TokenFlow.flathub.yml",
);

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function readVersion() {
  return fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

const version = argument("--version", readVersion());
const tag = argument("--tag", `v${version}`);
const date = new Date().toISOString().slice(0, 10);
const renderFlathub = process.argv.includes("--render-flathub");

if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`invalid version: ${version}`);
  process.exit(1);
}

let manifest = fs.readFileSync(MANIFEST, "utf8");
if (!/^\s*tag:\s*v\S+/m.test(manifest)) {
  console.error("could not find the git source tag in the release manifest");
  process.exit(1);
}
manifest = manifest.replace(/^(\s*tag:\s*)v\S+/m, `$1${tag}`);
fs.writeFileSync(MANIFEST, manifest);

let metainfo = fs.readFileSync(METAINFO, "utf8");
if (!metainfo.includes(`<release version="${version}"`)) {
  const release = `    <release version="${version}" date="${date}"/>`;
  if (/<releases\s*\/>/.test(metainfo)) {
    metainfo = metainfo.replace(
      /<releases\s*\/>/,
      `<releases>\n${release}\n  </releases>`,
    );
  } else if (/<releases>/.test(metainfo)) {
    metainfo = metainfo.replace(
      /<releases>\s*/,
      `<releases>\n${release}\n    `,
    );
  } else {
    metainfo = metainfo.replace(
      "</component>",
      `  <releases>\n${release}\n  </releases>\n</component>`,
    );
  }
  fs.writeFileSync(METAINFO, metainfo);
}

if (renderFlathub) {
  let commit = argument("--commit");
  if (!commit) {
    try {
      commit = git(["rev-parse", `${tag}^{commit}`]);
    } catch {
      try {
        commit = git(["rev-parse", "HEAD"]);
      } catch (error) {
        console.error(
          `could not determine a commit for ${tag}: ${error.message}`,
        );
        process.exit(1);
      }
    }
  }

  const lines = manifest.split("\n");
  const sourceIndex = lines.findIndex((line) =>
    /^\s*-\s*type:\s*git\s*$/.test(line),
  );
  if (sourceIndex === -1) {
    console.error(
      "could not find the git source block in the release manifest",
    );
    process.exit(1);
  }
  const tagIndex = lines.findIndex(
    (line, index) => index > sourceIndex && /^\s*tag:\s*/.test(line),
  );
  if (tagIndex === -1) {
    console.error("could not find the tag line in the git source block");
    process.exit(1);
  }
  const indent = (lines[tagIndex].match(/^\s*/) ?? [""])[0];
  const existingCommit = lines.findIndex(
    (line, index) => index > tagIndex && /^\s*commit:\s*/.test(line),
  );
  if (existingCommit !== -1) {
    lines[existingCommit] = `${indent}commit: ${commit}`;
  } else {
    lines.splice(tagIndex + 1, 0, `${indent}commit: ${commit}`);
  }

  fs.mkdirSync(path.dirname(FLATHUB_OUTPUT), { recursive: true });
  fs.writeFileSync(FLATHUB_OUTPUT, `${lines.join("\n").trimEnd()}\n`);
  console.log(`rendered ${path.relative(ROOT, FLATHUB_OUTPUT)}`);
}

fs.writeFileSync(MANIFEST, manifest);
console.log(`release manifest tag: ${tag}`);
