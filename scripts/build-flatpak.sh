#!/usr/bin/env bash
# Build the TokenFlow Flatpak for the host architecture.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=lib/gpg.sh
source "$ROOT/scripts/lib/gpg.sh"

MANIFEST="flatpak/io.github.siddheshgunjal.TokenFlow.dev.yml"
RELEASE=0
SIGN_ONLY=0
SIGNING=0

if [ -n "${GPG_PRIVATE_KEY:-}" ] || [ -n "${GPG_PRIVATE_KEY_FILE:-}" ]; then
  SIGNING=1
fi

usage() {
  cat <<'EOF'
Usage: scripts/build-flatpak.sh [options]

Options:
  --release             Use the tag-pinned release manifest (requires generated
                        flatpak-cargo-sources.json and node-sources.json)
  --manifest <path>     Override the manifest path
  --sign-only           Re-export the existing flatpak/repo bundle with the
                        release signature (requires a private key below)
  -h, --help            Show this help

Environment:
  GPG_PRIVATE_KEY       Armored release private key (or GPG_PRIVATE_KEY_FILE)
  GPG_PASSPHRASE        Key passphrase (or GPG_PASSPHRASE_FILE)
  GPG_PUBLIC_KEY        Armored public key, validated against the private key

When a private key is supplied, the bundle is signed and the public key is
embedded so flatpak install --bundle can verify it.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --release) RELEASE=1; MANIFEST="flatpak/io.github.siddheshgunjal.TokenFlow.yml"; shift ;;
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --sign-only) SIGN_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$SIGN_ONLY" -eq 1 ]; then
  SIGNING=1
  if [ -z "${GPG_PRIVATE_KEY:-}" ] && [ -z "${GPG_PRIVATE_KEY_FILE:-}" ]; then
    echo "--sign-only requires GPG_PRIVATE_KEY or GPG_PRIVATE_KEY_FILE" >&2
    exit 1
  fi
fi

if [ "$SIGN_ONLY" -eq 0 ]; then
  node scripts/sync-version.mjs
fi
VERSION="$(tr -d '[:space:]' < VERSION)"

case "$(uname -m)" in
  x86_64|amd64) ARCH=x86_64 ;;
  aarch64|arm64) ARCH=aarch64 ;;
  *) echo "unsupported host architecture: $(uname -m)" >&2; exit 1 ;;
esac

if [ "$SIGN_ONLY" -eq 0 ] && ! command -v flatpak-builder >/dev/null; then
  echo "flatpak-builder is required" >&2
  exit 1
fi

if [ "$RELEASE" -eq 1 ] && [ "$SIGN_ONLY" -eq 0 ]; then
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

if [ "$SIGN_ONLY" -eq 0 ]; then
  rm -rf "$BUILD_DIR" "$REPO_DIR"

  flatpak-builder \
    --force-clean \
    --disable-rofiles-fuse \
    --default-branch=stable \
    --repo="$REPO_DIR" \
    --state-dir="$STATE_DIR" \
    "$BUILD_DIR" \
    "$MANIFEST"
else
  if [ ! -d "$REPO_DIR" ]; then
    echo "flatpak/repo is missing; run the build before --sign-only" >&2
    exit 1
  fi
fi

BUNDLE_ARGS=(
  --arch="$ARCH"
  --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo
)

if [ "$SIGNING" -eq 1 ]; then
  gpg_signing_setup "$ROOT"
  BUNDLE_ARGS+=(
    --gpg-sign="$GPG_SIGNING_KEY"
    --gpg-homedir="$GNUPGHOME"
    --gpg-keys="$GPG_SIGNING_PUBLIC_KEY_BIN"
  )
fi

rm -f "$OUT"
flatpak build-bundle \
  "${BUNDLE_ARGS[@]}" \
  "$REPO_DIR" \
  "$OUT" \
  io.github.siddheshgunjal.TokenFlow \
  stable

echo "wrote $OUT"
if [ "$SIGNING" -eq 1 ]; then
  echo "signed with key $GPG_SIGNING_KEY"
fi
