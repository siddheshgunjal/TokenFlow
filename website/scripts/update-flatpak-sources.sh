#!/usr/bin/env bash
# Forward wrapper for running Flatpak source regeneration from the website directory.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec bash "$ROOT/scripts/update-flatpak-sources.sh" "$@"
