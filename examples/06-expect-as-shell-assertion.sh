#!/usr/bin/env bash
# 06 — `expect` as a shell-native assertion.
#
# `expect` is screenshot + assertion in one. It navigates, evaluates the
# given checks (--title, --selector, --text, --status), and exits 0 on
# success or non-zero with a structured PCS_* code on failure. Perfect
# for CI smoke tests or post-deploy verification.
#
# Run:
#   bash 06-expect-as-shell-assertion.sh
set -euo pipefail

# Expect a page to load AND contain a specific selector AND have title.
# All checks must pass. On failure, a screenshot is saved to the path
# you give it for human review.
playwright-cli-sessions expect https://playwright.dev \
  --title="Playwright" \
  --selector="header" \
  --status=200 \
  --screenshot-on-fail=/tmp/example-06-fail.png

echo "Smoke test passed. (If it had failed, /tmp/example-06-fail.png would tell us why.)"
