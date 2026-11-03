#!/usr/bin/env bash
# Regenerate the offline Flatpak sources from the lockfiles.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TOOLS_COMMIT="9d86d336a39b9af38b86f114b6ce5820fe260f91"
TOOLS_DIR="${FLATPAK_BUILDER_TOOLS_DIR:-$ROOT/.tools/flatpak-builder-tools}"

if ! command -v uv >/dev/null; then
  echo "uv is required (https://docs.astral.sh/uv/)" >&2
  exit 1
fi

export UV_CACHE_DIR="$ROOT/.tools/uv-cache"
export UV_PYTHON_INSTALL_DIR="$ROOT/.tools/uv-python"
export UV_PROJECT_ENVIRONMENT="$ROOT/.tools/node-env"

if [ ! -f "$TOOLS_DIR/cargo/flatpak-cargo-generator.py" ]; then
  echo "downloading flatpak-builder-tools $TOOLS_COMMIT"
  rm -rf "$TOOLS_DIR"
  mkdir -p "$TOOLS_DIR"
  curl -fsSL "https://codeload.github.com/flatpak/flatpak-builder-tools/tar.gz/$TOOLS_COMMIT" \
    | tar -xz --strip-components=1 -C "$TOOLS_DIR"
fi

uv run --python 3.12 --script "$TOOLS_DIR/cargo/flatpak-cargo-generator.py" \
  -o flatpak/flatpak-cargo-sources.json src-tauri/Cargo.lock

uv run --python 3.12 --project "$TOOLS_DIR/node" \
  flatpak-node-generator --no-requests-cache \
  -o flatpak/node-sources.json npm package-lock.json

echo "regenerated flatpak/flatpak-cargo-sources.json and flatpak/node-sources.json"
