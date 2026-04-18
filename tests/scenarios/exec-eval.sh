#!/usr/bin/env bash
# tests/scenarios/exec-eval.sh — exec --eval and exec - (stdin) support (v0.4.2).
#
# Verifies inline eval mode and stdin mode for the exec command.
#
# Covers:
#   1. exec --eval='return await page.title()' https://example.com → JSON with "Example Domain"
#   2. exec - https://example.com (stdin) → JSON with example.com in url
#   3. exec --eval='throw new Error("boom")' → exit 1 + "boom" in stderr
#   4. exec --eval with --no-probe → works (options pass through)
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

URL="https://example.com"

# ── 1. --eval returns page title as JSON ─────────────────────────────────────
rc=0
out1="$(timeout 60 node "$CLI_JS" exec --eval='return await page.title()' "$URL" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "exec --eval exits 0 on example.com"
assert_contains "$out1" "Example Domain" "eval result contains page title"

# ── 2. exec - (stdin) returns page URL ───────────────────────────────────────
rc=0
out2="$(echo 'return { u: page.url() }' | timeout 60 node "$CLI_JS" exec - "$URL" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "exec - (stdin) exits 0 on example.com"
assert_contains "$out2" "example.com" "stdin exec result contains page url"

# ── 3. eval script that throws → exit 1 + error message ─────────────────────
rc=0
out3="$(timeout 60 node "$CLI_JS" exec --eval='throw new Error("boom")' 2>&1)" || rc=$?
[[ "$rc" != "0" ]] || { echo "eval throw unexpectedly succeeded" >&2; exit 1; }
assert_contains "$out3" "boom" "thrown error message appears in stderr"
_assert_ok "eval throw exits non-zero with error message (rc=$rc)"

# ── 4. --eval with --no-probe (options pass through) → exit 0 ────────────────
rc=0
out4="$(timeout 60 node "$CLI_JS" exec --eval='return 42' "$URL" --no-probe 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "exec --eval with --no-probe exits 0"
assert_contains "$out4" "42" "eval with --no-probe returns correct result"
