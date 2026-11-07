#!/usr/bin/env bash
#
# measure-rss.sh — sample per-process RSS/CPU for a running TokenFlow and
# write a CSV timeline. Used for the runtime-baseline (Phase 0) and the
# runtime-after (Phase 4) performance captures.
#
# Usage:
#   scripts/measure-rss.sh <output.csv> [interval_seconds=5] [duration_seconds=300]
#
# The script finds the TokenFlow main process by name (the Flatpak app id is
# `io.github.siddheshgunjal.TokenFlow`; the raw build is named `tokenflow`) and
# every WebKit helper process it spawns, then samples one row per process per
# interval:
#
#   timestamp,proc,rss_kb,cpu_pct,cmd
#
# `rss_kb` is resident set size in KiB; `cpu_pct` is the instantaneous CPU
# percent. Processes that exit between samples simply stop appearing, which is
# how a dashboard destroy is observed (its `WebKitWebProcess` row disappears).
#
# This script is read-only: it never writes outside the output file you pass.
set -euo pipefail

OUT="${1:?usage: measure-rss.sh <output.csv> [interval_seconds] [duration_seconds]}"
INTERVAL="${2:-5}"
DURATION="${3:-300}"

# Match the main process and its WebKit children by command name.
MAIN_RE='(tokenflow|io\.github\.siddheshgunjal\.TokenFlow)'
WEBKIT_RE='WebKit(GPU|WebProcess|NetworkProcess)'

header_written=0
elapsed=0

while [ "$elapsed" -le "$DURATION" ]; do
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  rows="$(ps -eo rss=,pcpu=,comm= 2>/dev/null \
    | awk -v ts="$ts" -v main="$MAIN_RE" -v webkit="$WEBKIT_RE" '
        $3 ~ main || $3 ~ webkit {
          printf "%s,%s,%s,%s,%s\n", ts, $3, $1, $2, $3
        }
      ')"

  if [ -n "$rows" ]; then
    if [ "$header_written" -eq 0 ]; then
      printf 'timestamp,proc,rss_kb,cpu_pct,cmd\n' > "$OUT"
      header_written=1
    fi
    printf '%s\n' "$rows" >> "$OUT"
  fi

  sleep "$INTERVAL"
  elapsed=$((elapsed + INTERVAL))
done

echo "wrote $(wc -l < "$OUT") lines to $OUT"
