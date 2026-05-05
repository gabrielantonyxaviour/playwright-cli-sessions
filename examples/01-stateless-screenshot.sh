#!/usr/bin/env bash
# 01 — Stateless screenshot.
#
# The simplest thing the CLI can do: capture a page and exit. No saved
# session, no attached browser. A fresh headless Chromium spawns, takes
# the screenshot, dies. Useful when:
#   - you don't need auth
#   - you don't care about a persistent profile
#   - you want a one-off capture from CI or a script
#
# Run:
#   bash 01-stateless-screenshot.sh
set -euo pipefail

OUT="/tmp/example-01.png"

playwright-cli-sessions screenshot https://example.com \
  --out="$OUT" \
  --wait-until=domcontentloaded

echo "Saved → $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
