#!/usr/bin/env bash
# tests/scenarios/navigate.sh — navigate command scenarios.
#
# Exercises `playwright-cli-sessions navigate <url> [flags]` against stable
# public URLs (example.com). Each real-browser invocation is expensive, so we
# combine assertions where possible to minimise Chromium launches.
#
# Covers:
#   1. Basic navigate → prints confirmation + title
#   2. --snapshot also emits ARIA tree (combined with title/✓ checks)
#   3. Without --snapshot no ARIA markup is printed
#   4. --wait-for on an existing selector succeeds
#   5. --wait-for on a missing selector times out (non-zero exit)
#   6. --wait-until=bogus → argument validation error
#   7. Missing URL → usage error
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

URL="https://example.com"

# ── 1+2. Basic navigate with --snapshot ───────────────────────────────
# Running with --snapshot once lets us assert on all three outputs at
# once: the ✓ confirmation line, the Title: line, AND the ARIA tree.
rc=0
out_snap="$(timeout 60 node "$CLI_JS" navigate "$URL" --snapshot 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "navigate --snapshot exits 0"
assert_contains "$out_snap" "✓ Navigated to" "navigate prints ✓ confirmation"
assert_contains "$out_snap" "example.com" "navigate confirmation includes host"
assert_contains "$out_snap" "Title:" "navigate prints Title: line"
assert_contains "$out_snap" "Example" "navigate shows 'Example' in title"
# ARIA snapshot from example.com — the page has an <h1>, so the aria
# tree includes a 'heading' node and the word 'Example'.
assert_contains "$out_snap" "heading" "--snapshot emits ARIA heading node"

# ── 3. Without --snapshot, no ARIA tree ───────────────────────────────
# Separate run without --snapshot. example.com's title is "Example Domain"
# (no 'heading' substring), so 'heading' MUST NOT appear in plain output.
rc=0
out_plain="$(timeout 60 node "$CLI_JS" navigate "$URL" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "navigate (no --snapshot) exits 0"
assert_contains "$out_plain" "✓ Navigated to" "plain navigate still prints ✓"
assert_contains "$out_plain" "Title:" "plain navigate still prints Title:"
assert_not_contains "$out_plain" "heading" "no ARIA tree without --snapshot"

# ── 4. --wait-for on an existing selector ─────────────────────────────
# example.com has an <h1>; waiting for it should succeed.
rc=0
out_wf="$(timeout 60 node "$CLI_JS" navigate "$URL" --wait-for=h1 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "--wait-for=h1 succeeds on example.com"
assert_contains "$out_wf" "✓ Navigated to" "--wait-for success still prints ✓"

# ── 5. --wait-for on a missing selector times out ─────────────────────
# The selector never appears → Playwright's 30s timeout fires → non-zero exit.
# Harness `timeout 60` is a safety net in case CLI hangs.
rc=0
out_miss="$(timeout 60 node "$CLI_JS" navigate "$URL" --wait-for="#pcs-test-missing-element" 2>&1)" || rc=$?
[[ $rc -ne 0 ]] || _assert_fail "--wait-for missing selector should fail but exited 0
      output:
$(printf '%s\n' "$out_miss" | sed 's/^/        /')"
_assert_ok "--wait-for missing selector exits non-zero (rc=$rc)"

# ── 6. Invalid --wait-until value ─────────────────────────────────────
# parseWaitUntil throws synchronously — no browser is launched.
rc=0
out_bad="$(node "$CLI_JS" navigate "$URL" --wait-until=bogus 2>&1)" || rc=$?
[[ $rc -ne 0 ]] || _assert_fail "--wait-until=bogus should fail but exited 0"
_assert_ok "--wait-until=bogus exits non-zero (rc=$rc)"
assert_contains "$out_bad" "Invalid --wait-until" "stderr mentions 'Invalid --wait-until'"

# ── 7. Missing URL ────────────────────────────────────────────────────
rc=0
out_nourl="$(node "$CLI_JS" navigate 2>&1)" || rc=$?
[[ $rc -ne 0 ]] || _assert_fail "navigate without URL should fail but exited 0"
_assert_ok "navigate without URL exits non-zero (rc=$rc)"
assert_contains "$out_nourl" "navigate requires a URL" "missing URL error message"
