#!/usr/bin/env bash
# tests/scenarios/http-errors.sh — HTTP-error detection (v0.4.2).
#
# Verifies that navigation to 4xx/5xx pages exits 11 (PCS_HTTP_ERROR) and that
# opt-out flags and auth-wall priority work correctly.
#
# Covers:
#   1. Stable non-error page → exit 0, no PCS_HTTP_ERROR
#   2. Known 404 URL → exit 11, PCS_HTTP_ERROR + status: 404 in details
#   3. --allow-http-error on same 404 → exit 0
#   4. PLAYWRIGHT_CLI_ALLOW_HTTP_ERROR=1 env bypass → exit 0
#   5. Auth-wall URL → exit 77 PCS_AUTH_WALL (takes priority over HTTP error)
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

# ── 1. Stable non-error page → exit 0 ───────────────────────────────────────
tmpshot="$(pcs_tmp screenshot.png)"
rc=0
out1="$(timeout 60 node "$CLI_JS" screenshot https://example.com --out="$tmpshot" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "example.com exits 0 (no HTTP error)"
[[ "$out1" != *"PCS_HTTP_ERROR"* ]] || {
  echo "Unexpected PCS_HTTP_ERROR on example.com: $out1" >&2; exit 1
}
_assert_ok "no PCS_HTTP_ERROR on stable page"

# ── 2. Known 404 URL → exit 11, PCS_HTTP_ERROR ──────────────────────────────
# Throws before taking screenshot, so /dev/null is fine.
rc=0
out2="$(timeout 60 node "$CLI_JS" screenshot https://example.com/does-not-exist --out=/dev/null 2>&1)" || rc=$?
assert_exit_code 11 "$rc" "404 URL exits 11 (PCS_HTTP_ERROR)"
assert_contains "$out2" "Error [PCS_HTTP_ERROR]" "stderr contains PCS_HTTP_ERROR code"
assert_contains "$out2" '"status":404' "details include status: 404"

# ── 3. --allow-http-error on same 404 → exit 0 ──────────────────────────────
tmpshot3="$(pcs_tmp screenshot3.png)"
rc=0
out3="$(timeout 60 node "$CLI_JS" screenshot https://example.com/does-not-exist --allow-http-error --out="$tmpshot3" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "--allow-http-error on 404 exits 0"
[[ "$out3" != *"PCS_HTTP_ERROR"* ]] || {
  echo "--allow-http-error still emitted PCS_HTTP_ERROR: $out3" >&2; exit 1
}
_assert_ok "--allow-http-error suppresses PCS_HTTP_ERROR"

# ── 4. PLAYWRIGHT_CLI_ALLOW_HTTP_ERROR=1 env bypass → exit 0 ────────────────
tmpshot4="$(pcs_tmp screenshot4.png)"
rc=0
out4="$(timeout 60 env PLAYWRIGHT_CLI_ALLOW_HTTP_ERROR=1 node "$CLI_JS" screenshot https://example.com/does-not-exist --out="$tmpshot4" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "PLAYWRIGHT_CLI_ALLOW_HTTP_ERROR=1 env bypass exits 0"
[[ "$out4" != *"PCS_HTTP_ERROR"* ]] || {
  echo "Env bypass still emitted PCS_HTTP_ERROR: $out4" >&2; exit 1
}
_assert_ok "PLAYWRIGHT_CLI_ALLOW_HTTP_ERROR=1 suppresses PCS_HTTP_ERROR"

# ── 5. Auth-wall URL → exit 77 PCS_AUTH_WALL (not 11 PCS_HTTP_ERROR) ────────
# GitHub /settings redirects unauthenticated users to /login (302 → login page).
# Auth-wall detection runs first and takes priority.
# Throws before screenshot, so /dev/null is fine.
rc=0
out5="$(timeout 90 node "$CLI_JS" screenshot https://github.com/settings --out=/dev/null 2>&1)" || rc=$?
assert_exit_code 77 "$rc" "auth-gated URL exits 77 (PCS_AUTH_WALL takes priority)"
assert_contains "$out5" "Error [PCS_AUTH_WALL]" "auth-wall error emitted, not PCS_HTTP_ERROR"
[[ "$out5" != *"Error [PCS_HTTP_ERROR]"* ]] || {
  echo "PCS_HTTP_ERROR wrongly emitted instead of PCS_AUTH_WALL: $out5" >&2; exit 1
}
_assert_ok "PCS_AUTH_WALL takes priority over PCS_HTTP_ERROR"
