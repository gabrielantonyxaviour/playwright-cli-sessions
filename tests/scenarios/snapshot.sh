#!/usr/bin/env bash
# tests/scenarios/snapshot.sh — snapshot command scenarios.
#
# Exercises `playwright-cli-sessions snapshot <url> [flags]`. Unlike navigate,
# snapshot prints ONLY the ARIA tree (no ✓ line, no Title: line). Each
# invocation launches a real headless Chromium — scenarios are tight.
#
# Covers:
#   1. Basic snapshot → emits ARIA tree (combined with 'no Title:' + 'no ✓' to save a browser launch)
#   2. --wait-for on an existing selector succeeds
#   3. --wait-for on a missing selector times out (non-zero exit)
#   4. Missing URL → usage error
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

URL="https://example.com"

# ── 1. Basic snapshot (also covers "no Title:", "no ✓ Navigated") ─────
# One browser launch, multiple assertions — the command either prints a
# well-formed ARIA tree OR it doesn't, so we check the positive and
# negative conditions from the same output buffer.
rc=0
out="$(timeout 60 node "$CLI_JS" snapshot "$URL" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "snapshot exits 0"
assert_contains "$out" "heading" "snapshot emits ARIA heading node"
assert_contains "$out" "Example" "snapshot includes page text 'Example'"
# The snapshot command must NOT print navigation confirmation text —
# that's what distinguishes it from `navigate --snapshot`.
assert_not_contains "$out" "Title:" "snapshot does not print Title: line"
assert_not_contains "$out" "✓ Navigated" "snapshot does not print ✓ confirmation"

# ── 2. --wait-for on an existing selector ─────────────────────────────
rc=0
out_wf="$(timeout 60 node "$CLI_JS" snapshot "$URL" --wait-for=h1 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "snapshot --wait-for=h1 exits 0"
assert_contains "$out_wf" "heading" "--wait-for=h1 still produces ARIA tree"

# ── 3. --wait-for on a missing selector times out ─────────────────────
# The CLI's internal Playwright timeout is 30s; harness timeout 60s is
# a safety net in case the process hangs.
rc=0
out_miss="$(timeout 60 node "$CLI_JS" snapshot "$URL" --wait-for="#pcs-test-missing-element" 2>&1)" || rc=$?
[[ $rc -ne 0 ]] || _assert_fail "snapshot --wait-for missing selector should fail but exited 0
      output:
$(printf '%s\n' "$out_miss" | sed 's/^/        /')"
_assert_ok "snapshot --wait-for missing selector exits non-zero (rc=$rc)"

# ── 4. Missing URL ────────────────────────────────────────────────────
rc=0
out_nourl="$(node "$CLI_JS" snapshot 2>&1)" || rc=$?
[[ $rc -ne 0 ]] || _assert_fail "snapshot without URL should fail but exited 0"
_assert_ok "snapshot without URL exits non-zero (rc=$rc)"
assert_contains "$out_nourl" "Error: snapshot requires a URL" "missing URL error message"
