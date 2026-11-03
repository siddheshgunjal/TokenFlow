#!/usr/bin/env bash
# Build the TokenFlow Flatpak for the host architecture.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MANIFEST="flatpak/io.github.siddheshgunjal.TokenFlow.dev.yml"
RELEASE=0

usage() {
  cat <<'EOF'
Usage: scripts/build-flatpak.sh [options]

Options:
  --release             Use the tag-pinned release manifest (requires generated
                        flatpak-cargo-sources.json and node-sources.json)
  --manifest <path>     Override the manifest path
  -h, --help            Show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --release) RELEASE=1; MANIFEST="flatpak/io.github.siddheshgunjal.TokenFlow.yml"; shift ;;
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

node scripts/sync-version.mjs
VERSION="$(tr -d '[:space:]' < VERSION)"

case "$(uname -m)" in
  x86_64|amd64) ARCH=x86_64 ;;
  aarch64|arm64) ARCH=aarch64 ;;
  *) echo "unsupported host architecture: $(uname -m)" >&2; exit 1 ;;
esac

command -v flatpak-builder >/dev/null || {
  echo "flatpak-builder is required" >&2
  exit 1
}

if [ "$RELEASE" -eq 1 ]; then
  for source in flatpak/flatpak-cargo-sources.json flatpak/node-sources.json; do
    [ -f "$source" ] || {
      echo "$source is missing; run scripts/update-flatpak-sources.sh first" >&2
      exit 1
    }
  done
fi

BUILD_DIR="flatpak/build"
REPO_DIR="flatpak/repo"
STATE_DIR="flatpak/.state"
OUT="release/TokenFlow-$VERSION-linux-$ARCH.flatpak"

mkdir -p release
rm -rf "$BUILD_DIR" "$REPO_DIR"

flatpak-builder \
  --force-clean \
  --disable-rofiles-fuse \
  --default-branch=stable \
  --repo="$REPO_DIR" \
  --state-dir="$STATE_DIR" \
  "$BUILD_DIR" \
  "$MANIFEST"

flatpak build-bundle \
  --arch="$ARCH" \
  --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo \
  "$REPO_DIR" \
  "$OUT" \
  io.github.siddheshgunjal.TokenFlow \
  stable

echo "wrote $OUT"
