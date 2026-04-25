#!/usr/bin/env bash
# tests/scenarios/remote-strict-fallback.sh — strict no-fallback guard (v0.9.1).
#
# When PLAYWRIGHT_CLI_REMOTE is set but no attached Chrome is running (and
# no local-fallback opt-in), every browser command must throw
# PCS_REMOTE_UNREACHABLE (exit 79) instead of silently spawning a local
# Chrome. The user has been explicit: silent-fallback to local is the
# behaviour they don't want.
#
# Covers:
#   1. PLAYWRIGHT_CLI_REMOTE set + no attached → screenshot exits 79
#   2. Same + navigate → exit 79
#   3. Same + snapshot → exit 79
#   4. Same + exec --eval → exit 79
#   5. Same + login → exit 79
#   6. Error message contains the unique "PLAYWRIGHT_CLI_ALLOW_LOCAL_FALLBACK"
#      escape-hatch hint (so callers know how to opt in)
#   7. With PLAYWRIGHT_CLI_ALLOW_LOCAL_FALLBACK=1, screenshot succeeds
#      (local fallback explicitly permitted)
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

# Sanity: harness should have unset the env vars. Re-set just for this
# scenario inside subshells so it doesn't bleed into anything else.
TARGET="https://example.com"

# ── 1. screenshot exits 79 when remote set but no attached ──────────────────
rc=0
out1="$(PLAYWRIGHT_CLI_REMOTE=m2worker timeout 30 node "$CLI_JS" screenshot "$TARGET" --out=/tmp/should-not-exist.png 2>&1)" || rc=$?
assert_exit_code 79 "$rc" "screenshot with PLAYWRIGHT_CLI_REMOTE+no attached exits 79"
assert_contains "$out1" "PCS_REMOTE_UNREACHABLE" "stderr contains PCS_REMOTE_UNREACHABLE code"
assert_contains "$out1" "PLAYWRIGHT_CLI_ALLOW_LOCAL_FALLBACK" "error explains the opt-in env var"

# ── 2. navigate exits 79 ────────────────────────────────────────────────────
rc=0
out2="$(PLAYWRIGHT_CLI_REMOTE=m2worker timeout 30 node "$CLI_JS" navigate "$TARGET" 2>&1)" || rc=$?
assert_exit_code 79 "$rc" "navigate exits 79"
assert_contains "$out2" "PCS_REMOTE_UNREACHABLE" "navigate error has correct code"

# ── 3. snapshot exits 79 ────────────────────────────────────────────────────
rc=0
out3="$(PLAYWRIGHT_CLI_REMOTE=m2worker timeout 30 node "$CLI_JS" snapshot "$TARGET" 2>&1)" || rc=$?
assert_exit_code 79 "$rc" "snapshot exits 79"

# ── 4. exec --eval exits 79 ─────────────────────────────────────────────────
rc=0
out4="$(PLAYWRIGHT_CLI_REMOTE=m2worker timeout 30 node "$CLI_JS" exec --eval='return 1;' "$TARGET" 2>&1)" || rc=$?
assert_exit_code 79 "$rc" "exec exits 79"

# ── 5. login exits 79 (login is purely local-launch, must also be guarded) ─
rc=0
out5="$(PLAYWRIGHT_CLI_REMOTE=m2worker timeout 30 node "$CLI_JS" login throwaway-test --url=https://example.com 2>&1)" || rc=$?
assert_exit_code 79 "$rc" "login exits 79"

# ── 6. With PLAYWRIGHT_CLI_ALLOW_LOCAL_FALLBACK=1, screenshot SUCCEEDS ──────
# Verifies the explicit-opt-in escape hatch works.
tmpshot="$(pcs_tmp escape.png)"
rc=0
out6="$(PLAYWRIGHT_CLI_REMOTE=m2worker PLAYWRIGHT_CLI_ALLOW_LOCAL_FALLBACK=1 timeout 60 node "$CLI_JS" screenshot "$TARGET" --out="$tmpshot" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "screenshot with both env vars set exits 0"
if [[ -s "$tmpshot" ]]; then
  _assert_ok "screenshot file written under explicit fallback opt-in"
else
  _assert_fail "screenshot file empty/missing under explicit fallback opt-in: $tmpshot"
fi

# ── 7. With NO PLAYWRIGHT_CLI_REMOTE at all, screenshot succeeds locally ────
rc=0
out7="$(timeout 60 node "$CLI_JS" screenshot "$TARGET" --out="$tmpshot" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "screenshot with no remote env exits 0 (default local OK)"
