#!/usr/bin/env bash
# tests/scenarios/refresh.sh — refresh command error-path scenarios.
#
# The happy path for `refresh` opens a visible browser and waits for the
# user to close it — not something the scenario harness can exercise
# hermetically. What we CAN (and must) guard are the two synchronous
# error paths in cmdRefresh: they fail before any browser launches, so
# they're cheap regression-tests for the CLI router + store resolution.
#
# Covers:
#   1. Missing session name → usage error, no browser launched
#   2. Nonexistent session → "No saved session" error
#   3. Existing session with no lastUrl and no --url → "has no lastUrl" error
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

# ── 1. Missing session name ───────────────────────────────────────────
rc=0
out1="$(node "$CLI_JS" refresh 2>&1)" || rc=$?
[[ $rc -ne 0 ]] || _assert_fail "refresh without name should fail but exited 0"
_assert_ok "refresh without name exits non-zero (rc=$rc)"
assert_contains "$out1" "Error: refresh requires a session name" "missing name error message"

# ── 2. Nonexistent session ────────────────────────────────────────────
# No file at $PLAYWRIGHT_SESSIONS_DIR/ghost.json → readSaved returns null
# → cmdRefresh throws "No saved session: ...".
rc=0
out2="$(node "$CLI_JS" refresh ghost --url=https://example.com 2>&1)" || rc=$?
[[ $rc -ne 0 ]] || _assert_fail "refresh of nonexistent session should fail but exited 0"
_assert_ok "refresh of nonexistent session exits non-zero (rc=$rc)"
assert_contains "$out2" "No saved session" "nonexistent-session error message"

# ── 3. Existing session with no lastUrl, no --url ─────────────────────
# Write a session fixture explicitly WITHOUT lastUrl. cmdRefresh reads
# existing.lastUrl, finds undefined, no --url provided → throws
# "Session \"X\" has no lastUrl".
node -e '
  const fs = require("fs");
  const [, path] = process.argv;
  fs.writeFileSync(path, JSON.stringify({
    name: "no-lasturl",
    storageState: { cookies: [], origins: [] },
    savedAt: "2026-04-17T00:00:00.000Z",
    savedBy: "fixture",
  }, null, 2));
' "$PLAYWRIGHT_SESSIONS_DIR/no-lasturl.json"

rc=0
out3="$(node "$CLI_JS" refresh no-lasturl 2>&1)" || rc=$?
[[ $rc -ne 0 ]] || _assert_fail "refresh with no --url and no lastUrl should fail but exited 0"
_assert_ok "refresh with no --url and no lastUrl exits non-zero (rc=$rc)"
assert_contains "$out3" "has no lastUrl" "no-lastUrl error message"
