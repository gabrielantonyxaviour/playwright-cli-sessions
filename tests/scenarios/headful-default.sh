#!/usr/bin/env bash
# tests/scenarios/headful-default.sh — verify default is headful (v0.6.0).
#
# As of v0.6.0 the browser commands default to HEADFUL. This scenario proves
# that default by inspecting the CLI's one-line mode indicator on stderr:
#
#   [pcs] browser: headful chrome     ← default
#   [pcs] browser: headless chrome    ← --headless flag or env
#
# The scenario harness sets PLAYWRIGHT_CLI_HEADLESS=1 for speed; this scenario
# MUST `env -u` it in a subshell for case 1 to exercise the true default.
#
# NOTE: Case 1 pops ONE real Chrome window briefly. That is the intended
# observable proof that default-headful works.
#
# Covers:
#   1. No flags, no env → "[pcs] browser: headful chrome"
#   2. --headless flag → "[pcs] browser: headless chrome"
#   3. PLAYWRIGHT_CLI_HEADLESS=1 env → "[pcs] browser: headless chrome"
#   4. PLAYWRIGHT_CLI_QUIET=1 suppresses the indicator line
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

SENTINEL='about:blank'
NOOP='return 42;'

# ── 1. Default is headful — unset env in subshell ───────────────────────────
rc=0
out1="$(env -u PLAYWRIGHT_CLI_HEADLESS timeout 90 node "$CLI_JS" exec --eval="$NOOP" "$SENTINEL" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "exec with no flags/env runs successfully"
assert_contains "$out1" "[pcs] browser: headful" "default launches headful (stderr note)"

# ── 2. --headless flag forces headless ──────────────────────────────────────
rc=0
out2="$(env -u PLAYWRIGHT_CLI_HEADLESS timeout 90 node "$CLI_JS" exec --headless --eval="$NOOP" "$SENTINEL" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "exec --headless runs successfully"
assert_contains "$out2" "[pcs] browser: headless" "--headless forces headless (stderr note)"

# ── 3. PLAYWRIGHT_CLI_HEADLESS=1 env forces headless ────────────────────────
rc=0
out3="$(PLAYWRIGHT_CLI_HEADLESS=1 timeout 90 node "$CLI_JS" exec --eval="$NOOP" "$SENTINEL" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "exec with PLAYWRIGHT_CLI_HEADLESS=1 runs successfully"
assert_contains "$out3" "[pcs] browser: headless" "PLAYWRIGHT_CLI_HEADLESS=1 forces headless"

# ── 4. PLAYWRIGHT_CLI_QUIET=1 suppresses indicator ──────────────────────────
rc=0
out4="$(PLAYWRIGHT_CLI_HEADLESS=1 PLAYWRIGHT_CLI_QUIET=1 timeout 90 node "$CLI_JS" exec --eval="$NOOP" "$SENTINEL" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "exec with PLAYWRIGHT_CLI_QUIET=1 runs successfully"
if [[ "$out4" == *"[pcs] browser:"* ]]; then
  _assert_fail "PLAYWRIGHT_CLI_QUIET=1 should suppress [pcs] browser: line
$out4"
else
  _assert_ok "PLAYWRIGHT_CLI_QUIET=1 suppresses browser-mode indicator"
fi
