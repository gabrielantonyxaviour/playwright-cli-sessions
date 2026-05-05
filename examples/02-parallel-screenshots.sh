#!/usr/bin/env bash
# 02 — Parallel screenshots, no MCP, no coordination.
#
# Each `playwright-cli-sessions screenshot` invocation is a self-contained
# process. To capture five pages at once, fork five jobs with shell `&`
# and `wait`. Linear speedup until your machine runs out of cores —
# unlike an MCP server which serializes through a single stdio pipe.
#
# Run:
#   bash 02-parallel-screenshots.sh
set -euo pipefail

URLS=(
  https://example.com
  https://news.ycombinator.com
  https://www.rust-lang.org
  https://playwright.dev
  https://github.com
)

mkdir -p /tmp/example-02
PIDS=()

for i in "${!URLS[@]}"; do
  out="/tmp/example-02/page-$i.png"
  playwright-cli-sessions screenshot "${URLS[$i]}" --out="$out" \
    --wait-until=domcontentloaded &
  PIDS+=($!)
done

# Wait for every fork. set -e + the for-loop below preserves any non-zero
# exit code from a child instead of swallowing it.
fails=0
for pid in "${PIDS[@]}"; do
  if ! wait "$pid"; then
    fails=$((fails + 1))
  fi
done

ls -lh /tmp/example-02
echo "$((${#URLS[@]} - fails)) / ${#URLS[@]} succeeded"
exit "$fails"
