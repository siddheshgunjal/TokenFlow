#!/usr/bin/env bash
# Collect Tauri bundles into release/ with the public asset names.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PLATFORM=""
ARCH=""
TARGET=""
VERSION=""
FORMATS=""

usage() {
  cat <<'EOF'
Usage: scripts/collect-bundles.sh --platform <linux|windows|macos> --arch <x86_64|aarch64> [options]

Options:
  --target <triple>   Tauri target triple (defaults to the host target directory)
  --version <semver>  Override the VERSION file
  --formats <list>    Comma-separated bundles (defaults: linux=deb,rpm,appimage;
                      windows=nsis; macos=dmg)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --platform) PLATFORM="${2:-}"; shift 2 ;;
    --arch) ARCH="${2:-}"; shift 2 ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    --version) VERSION="${2:-}"; shift 2 ;;
    --formats) FORMATS="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -n "$PLATFORM" ] || { echo "--platform is required" >&2; exit 2; }
[ -n "$ARCH" ] || { echo "--arch is required" >&2; exit 2; }

case "$ARCH" in
  amd64) ARCH=x86_64 ;;
  arm64) ARCH=aarch64 ;;
esac
case "$ARCH" in
  x86_64|aarch64) ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 2 ;;
esac

if [ -z "$VERSION" ]; then
  VERSION="$(tr -d '[:space:]' < VERSION)"
fi
if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$'; then
  echo "invalid version: $VERSION" >&2
  exit 2
fi

if [ -z "$FORMATS" ]; then
  case "$PLATFORM" in
    linux) FORMATS="deb,rpm,appimage" ;;
    windows) FORMATS="nsis" ;;
    macos) FORMATS="dmg" ;;
    *) echo "unsupported platform: $PLATFORM" >&2; exit 2 ;;
  esac
fi

if [ -n "$TARGET" ]; then
  BUNDLE_ROOT="src-tauri/target/$TARGET/release/bundle"
else
  BUNDLE_ROOT="src-tauri/target/release/bundle"
fi

OUT="release"
mkdir -p "$OUT"
shopt -s nullglob

copied=0
copy_first() {
  local source_dir="$1" pattern="$2" destination="$3"
  local files=("$source_dir"/$pattern)
  if [ ${#files[@]} -eq 0 ]; then
    echo "missing bundle: $source_dir/$pattern" >&2
    exit 1
  fi
  cp -f "${files[0]}" "$destination"
  echo "  ${files[0]} -> $destination"
  copied=$((copied + 1))
}

IFS=',' read -ra FORMAT_LIST <<< "$FORMATS"
for format in "${FORMAT_LIST[@]}"; do
  case "$PLATFORM:$format" in
    linux:deb)
      copy_first "$BUNDLE_ROOT/deb" "*.deb" "$OUT/TokenFlow-$VERSION-linux-$ARCH.deb"
      ;;
    linux:rpm)
      copy_first "$BUNDLE_ROOT/rpm" "*.rpm" "$OUT/TokenFlow-$VERSION-linux-$ARCH.rpm"
      ;;
    linux:appimage)
      copy_first "$BUNDLE_ROOT/appimage" "*.AppImage" "$OUT/TokenFlow-$VERSION-linux-$ARCH.AppImage"
      ;;
    windows:nsis)
      copy_first "$BUNDLE_ROOT/nsis" "*-setup.exe" "$OUT/TokenFlow-$VERSION-windows-$ARCH-setup.exe"
      ;;
    macos:dmg)
      copy_first "$BUNDLE_ROOT/dmg" "*.dmg" "$OUT/TokenFlow-$VERSION-macos-$ARCH.dmg"
      ;;
    *)
      echo "unsupported format '$format' for $PLATFORM" >&2
      exit 2
      ;;
  esac
done

echo "collected $copied asset(s) in $OUT"
