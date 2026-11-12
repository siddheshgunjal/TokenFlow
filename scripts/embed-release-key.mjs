#!/usr/bin/env node
/**
 * Embed the release public key in the Linux bundles.
 *
 * Runs from the Linux bundle scripts. When GPG_PUBLIC_KEY or
 * GPG_PUBLIC_KEY_FILE is set, writes the armored key to
 * src-tauri/tokenflow-release-key.asc and adds it to the deb, rpm, and
 * appimage bundle file maps. Without a key the script is a no-op so local
 * builds keep working.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(ROOT, "src-tauri/tauri.conf.json");
const KEY_PATH = path.join(ROOT, "src-tauri/tokenflow-release-key.asc");
const KEY_SOURCE = "tokenflow-release-key.asc";
const KEY_DEST = "/usr/share/keyrings/tokenflow-release-key.asc";

function normalizeArmored(value) {
  let normalized = value;
  if (normalized.includes("\\n") && !normalized.includes("\n")) {
    normalized = normalized.replaceAll("\\n", "\n");
  }
  normalized = normalized.replaceAll("\r", "");
  if (!normalized.endsWith("\n")) {
    normalized += "\n";
  }
  return normalized;
}

let key = "";
if (process.env.GPG_PUBLIC_KEY) {
  key = process.env.GPG_PUBLIC_KEY;
} else if (process.env.GPG_PUBLIC_KEY_FILE) {
  key = fs.readFileSync(process.env.GPG_PUBLIC_KEY_FILE, "utf8");
}

if (!key.trim()) {
  console.log("no release public key supplied; skipping key embedding");
  process.exit(0);
}

key = normalizeArmored(key);
if (!key.includes("BEGIN PGP PUBLIC KEY")) {
  console.error("GPG_PUBLIC_KEY must be an ASCII-armored OpenPGP public key");
  process.exit(1);
}

fs.writeFileSync(KEY_PATH, key);
fs.chmodSync(KEY_PATH, 0o644);

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
config.bundle ??= {};
config.bundle.linux ??= {};
for (const target of ["appimage", "deb", "rpm"]) {
  config.bundle.linux[target] ??= {};
  config.bundle.linux[target].files ??= {};
  const files = config.bundle.linux[target].files;
  if (files[KEY_DEST] && files[KEY_DEST] !== KEY_SOURCE) {
    console.error(
      `${target}.files already maps ${KEY_DEST} to a different source: ${files[KEY_DEST]}`,
    );
    process.exit(1);
  }
  files[KEY_DEST] = KEY_SOURCE;
}

fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
console.log(
  `embedded the release public key at ${KEY_DEST} for deb, rpm, and appimage`,
);
