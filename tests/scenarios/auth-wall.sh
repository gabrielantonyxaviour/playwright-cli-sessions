#!/usr/bin/env bash
# tests/scenarios/auth-wall.sh — auth-wall auto-detection (v0.4.0).
#
# Verifies that navigation to an auth-gated URL (no session) exits 77 with
# the stable AUTH_WALL prefix line on stderr.
#
# Test target: https://github.com/settings — GitHub redirects unauthenticated
# users to https://github.com/login?return_to=%2Fsettings, matching the
# LOGIN_PATH_RE (/login) heuristic.
#
# Covers:
#   1. navigate to auth-gated URL → exit 77, AUTH_WALL line, PCS_AUTH_WALL code
#   2. navigate to login URL itself → NOT treated as auth wall (intentional)
#   3. screenshot to auth-gated URL → exit 77
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

# ── 1. navigate to auth-gated URL → exit 77 ─────────────────────────────────
rc=0
out1="$(timeout 90 node "$CLI_JS" navigate https://github.com/settings 2>&1)" || rc=$?
assert_exit_code 77 "$rc" "auth-gated URL exits 77 (PCS_AUTH_WALL)"
assert_contains "$out1" "AUTH_WALL" "stderr contains AUTH_WALL prefix line"
assert_contains "$out1" "service=github" "AUTH_WALL identifies github service"
assert_contains "$out1" "Error [PCS_AUTH_WALL]" "stderr contains PCS_AUTH_WALL error code"
assert_contains "$out1" "suggest=" "AUTH_WALL line includes suggest= field"

# ── 2. Navigating TO a login URL is NOT an auth wall ────────────────��────────
# When the input URL itself is a login route, detection is skipped.
# github.com/login is a valid page — the command should succeed (exit 0).
rc=0
out2="$(timeout 90 node "$CLI_JS" navigate https://github.com/login 2>&1)" || rc=$?
[[ "$rc" == "0" || "$rc" != "77" ]] || {
  echo "navigate to login URL wrongly detected as auth wall (exit 77)" >&2
  echo "$out2" >&2
  exit 1
}
_assert_ok "navigate to /login itself is not treated as auth wall (rc=$rc)"

# ── 3. screenshot to auth-gated URL → exit 77 ───────────────────────────────
rc=0
out3="$(timeout 90 node "$CLI_JS" screenshot https://github.com/settings --out=/dev/null 2>&1)" || rc=$?
assert_exit_code 77 "$rc" "screenshot of auth-gated URL exits 77"
assert_contains "$out3" "AUTH_WALL" "screenshot stderr contains AUTH_WALL"
assert_contains "$out3" "Error [PCS_AUTH_WALL]" "screenshot stderr contains PCS_AUTH_WALL"
