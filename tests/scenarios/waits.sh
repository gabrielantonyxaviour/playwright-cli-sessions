#!/usr/bin/env bash
# tests/scenarios/waits.sh — rich wait primitives (v0.4.2).
#
# Verifies --wait-for-text, --wait-for-count, --wait-for-network, and
# composition with --wait-for.
#
# Covers:
#   1. --wait-for-text="Example" on https://example.com → exit 0
#   2. --wait-for-text="NeverAppears_xyz_12345" → exit 10 (PCS_SELECTOR_TIMEOUT)
#   3. --wait-for-count=p:1 on https://example.com → exit 0
#   4. --wait-for-count=p:9999 → exit 10
#   5. --wait-for-network=idle on https://example.com → exit 0
#   6. Composition: --wait-for-text="Example" --wait-for=h1 → exit 0
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

URL="https://example.com"

# ── 1. --wait-for-text (text present) → exit 0 ──────────────────────────────
rc=0
out1="$(timeout 90 node "$CLI_JS" navigate "$URL" '--wait-for-text=Example' 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "--wait-for-text='Example' on example.com exits 0"
[[ "$out1" != *"Error"* ]] || { echo "Unexpected error: $out1" >&2; exit 1; }
_assert_ok "--wait-for-text passes when text is present"

# ── 2. --wait-for-text (text absent) → exit 10 ──────────────────────────────
rc=0
out2="$(timeout 90 node "$CLI_JS" navigate "$URL" '--wait-for-text=NeverAppears_xyz_12345' 2>&1)" || rc=$?
assert_exit_code 10 "$rc" "--wait-for-text with absent text exits 10 (PCS_SELECTOR_TIMEOUT)"
assert_contains "$out2" "Error [PCS_SELECTOR_TIMEOUT]" "absent text emits PCS_SELECTOR_TIMEOUT"

# ── 3. --wait-for-count (count met) → exit 0 ────────────────────────────────
rc=0
out3="$(timeout 90 node "$CLI_JS" navigate "$URL" '--wait-for-count=p:1' 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "--wait-for-count=p:1 on example.com exits 0"
[[ "$out3" != *"Error"* ]] || { echo "Unexpected error: $out3" >&2; exit 1; }
_assert_ok "--wait-for-count passes when count is met"

# ── 4. --wait-for-count (count too high) → exit 10 ──────────────────────────
rc=0
out4="$(timeout 90 node "$CLI_JS" navigate "$URL" '--wait-for-count=p:9999' 2>&1)" || rc=$?
assert_exit_code 10 "$rc" "--wait-for-count=p:9999 exits 10 (PCS_SELECTOR_TIMEOUT)"
assert_contains "$out4" "Error [PCS_SELECTOR_TIMEOUT]" "unmet count emits PCS_SELECTOR_TIMEOUT"

# ── 5. --wait-for-network=idle → exit 0, no errors ──────────────────────────
rc=0
out5="$(timeout 90 node "$CLI_JS" navigate "$URL" --wait-for-network=idle 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "--wait-for-network=idle on example.com exits 0"
[[ "$out5" != *"Error"* ]] || { echo "Unexpected error: $out5" >&2; exit 1; }
_assert_ok "--wait-for-network=idle works without errors"

# ── 6. Composition: --wait-for-text + --wait-for → exit 0 ───────────────────
rc=0
out6="$(timeout 90 node "$CLI_JS" navigate "$URL" '--wait-for-text=Example' '--wait-for=h1' 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "composed --wait-for-text + --wait-for exits 0"
[[ "$out6" != *"Error"* ]] || { echo "Unexpected error: $out6" >&2; exit 1; }
_assert_ok "--wait-for-text and --wait-for compose (AND semantics)"
