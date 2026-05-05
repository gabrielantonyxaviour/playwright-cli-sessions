#!/usr/bin/env bash
# 03 — Attached mode: one Chrome, many commands.
#
# Without attached mode, every CLI invocation cold-starts Chrome (~2s
# per launch + window pop). With attached mode, Chrome runs once;
# subsequent commands open a tab via CDP, do the work, optionally close
# the tab. Same Chrome, no window pops, persistent profile.
#
# Run:
#   bash 03-attached-mode-tab-reuse.sh
set -euo pipefail

# Idempotent setup: only start if not already running.
if ! playwright-cli-sessions browser status 2>/dev/null | grep -q "running"; then
  playwright-cli-sessions browser start
fi

# Three commands, all hitting the same Chrome window. Notice the window
# does not pop three times — only on the very first `browser start`.
playwright-cli-sessions screenshot https://example.com \
  --out=/tmp/example-03-a.png

playwright-cli-sessions navigate https://news.ycombinator.com \
  --wait-until=domcontentloaded

playwright-cli-sessions snapshot https://playwright.dev \
  > /tmp/example-03-snapshot.txt

playwright-cli-sessions browser tabs list

# In real use you'd leave Chrome running for the rest of the day and
# `browser stop` when you're done. Comment the next line out to keep it
# alive between runs of this example.
# playwright-cli-sessions browser stop

echo "Done. Tabs are reused, profile persists, no window theft."
