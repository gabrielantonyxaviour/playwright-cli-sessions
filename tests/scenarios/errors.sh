#!/usr/bin/env bash
# tests/scenarios/errors.sh — error-format regression tests (v0.4.0).
#
# Verifies that all error paths emit the stable `Error [CODE]: message` format
# on stderr and exit with the correct code per EXIT_CODE_MAP.
#
# Covers:
#   1. Missing positional arg → Error [PCS_MISSING_ARG]: ... exit 2
#   2. Invalid --wait-until   → Error [PCS_INVALID_FLAG]: ... exit 2
#   3. Session not found      → Error [PCS_SESSION_NOT_FOUND]: ... exit 3
#   4. No expectation flags   → Error [PCS_MISSING_ARG]: ... exit 2
#   5. Unknown command        → unstructured error, exit 1 (legacy path)
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

URL="https://example.com"

# ── 1. Missing positional: screenshot requires URL ───────────────────��───────
rc=0
out1="$(timeout 10 node "$CLI_JS" screenshot 2>&1)" || rc=$?
assert_exit_code 2 "$rc" "missing URL exits 2 (PCS_MISSING_ARG)"
assert_contains "$out1" "Error [PCS_MISSING_ARG]" "missing URL emits PCS_MISSING_ARG code"
assert_contains "$out1" "screenshot requires a URL" "missing URL emits descriptive message"

# ── 2. Invalid --wait-until → PCS_INVALID_FLAG, exit 2 ───────────────────────
rc=0
out2="$(timeout 10 node "$CLI_JS" screenshot "$URL" --wait-until=bogus --out=/dev/null 2>&1)" || rc=$?
assert_exit_code 2 "$rc" "invalid --wait-until exits 2 (PCS_INVALID_FLAG)"
assert_contains "$out2" "Error [PCS_INVALID_FLAG]" "invalid --wait-until emits PCS_INVALID_FLAG"
assert_contains "$out2" "Invalid --wait-until" "invalid --wait-until includes message"

# ── 3. Session not found → PCS_SESSION_NOT_FOUND, exit 3 ─────────────────────
# No file at $PLAYWRIGHT_SESSIONS_DIR/no-such-session.json
rc=0
out3="$(timeout 10 node "$CLI_JS" screenshot "$URL" --session=no-such-session --out=/dev/null 2>&1)" || rc=$?
assert_exit_code 3 "$rc" "missing session exits 3 (PCS_SESSION_NOT_FOUND)"
assert_contains "$out3" "Error [PCS_SESSION_NOT_FOUND]" "missing session emits PCS_SESSION_NOT_FOUND"
assert_contains "$out3" "No saved session" "missing session includes descriptive message"

# ── 4. expect with no expectation flags → PCS_MISSING_ARG, exit 2 ────────────
rc=0
out4="$(timeout 10 node "$CLI_JS" expect "$URL" 2>&1)" || rc=$?
assert_exit_code 2 "$rc" "expect no flags exits 2 (PCS_MISSING_ARG)"
assert_contains "$out4" "Error [PCS_MISSING_ARG]" "expect no flags emits PCS_MISSING_ARG"
assert_contains "$out4" "requires at least one" "expect no flags message is descriptive"

# ── 5. Unknown command → exits 1 (legacy path, no PcsError code) ─────────────
rc=0
out5="$(timeout 10 node "$CLI_JS" not-a-real-command 2>&1)" || rc=$?
[[ "$rc" != "0" ]] || { echo "unknown command unexpectedly succeeded" >&2; exit 1; }
_assert_ok "unknown command exits non-zero (rc=$rc)"
assert_contains "$out5" "Unknown command" "unknown command mentions the bad command"
