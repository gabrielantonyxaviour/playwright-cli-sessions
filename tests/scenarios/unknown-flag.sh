#!/usr/bin/env bash
# tests/scenarios/unknown-flag.sh — unknown-flag rejection with Levenshtein suggestion.
#
# Verifies that passing an unrecognised flag to any command:
#   - exits 2 (PCS_INVALID_FLAG)
#   - emits Error [PCS_INVALID_FLAG]: unknown flag '...'
#   - suggests the nearest known flag (edit-distance ≤ 2) when one exists
#   - falls back to "See --help" when no close match exists
#
# Covers:
#   1. --waite-for (typo for --wait-for) → suggests --wait-for
#   2. --headedd   (typo for --headed)   → suggests --headed
#   3. --xyz       (no match)            → "See --help"
#   4. No browser is launched — fast (timeout 5s each)
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

URL="https://example.com"

# ── 1. Typo: --waite-for → suggests --wait-for ───────────────────────────────
rc=0
out1="$(timeout 5 node "$CLI_JS" screenshot "$URL" --waite-for=h1 2>&1)" || rc=$?
assert_exit_code 2 "$rc" "--waite-for exits 2"
assert_contains "$out1" "Error [PCS_INVALID_FLAG]" "--waite-for emits PCS_INVALID_FLAG"
assert_contains "$out1" "waite-for" "--waite-for mentions the bad flag"
assert_contains "$out1" "wait-for" "--waite-for suggests --wait-for"
assert_contains "$out1" "Did you mean" "--waite-for includes suggestion prompt"

# ── 2. Typo: --headedd → suggests --headed ───────────────────────────────────
rc=0
out2="$(timeout 5 node "$CLI_JS" navigate "$URL" --headedd 2>&1)" || rc=$?
assert_exit_code 2 "$rc" "--headedd exits 2"
assert_contains "$out2" "Error [PCS_INVALID_FLAG]" "--headedd emits PCS_INVALID_FLAG"
assert_contains "$out2" "headedd" "--headedd mentions the bad flag"
assert_contains "$out2" "headed" "--headedd suggests --headed"

# ── 3. Completely unknown flag → See --help ───────────────────────────────────
rc=0
out3="$(timeout 5 node "$CLI_JS" screenshot "$URL" --xyz-no-such-flag 2>&1)" || rc=$?
assert_exit_code 2 "$rc" "unknown --xyz flag exits 2"
assert_contains "$out3" "Error [PCS_INVALID_FLAG]" "unknown flag emits PCS_INVALID_FLAG"
assert_contains "$out3" "xyz-no-such-flag" "unknown flag mentions the bad flag"
assert_contains "$out3" "See --help" "no suggestion → directs to --help"

# ── 4. Unknown flag on 'navigate' → same behaviour ──────────────────────���────
rc=0
out4="$(timeout 5 node "$CLI_JS" navigate "$URL" --full-paje 2>&1)" || rc=$?
assert_exit_code 2 "$rc" "--full-paje on navigate exits 2"
assert_contains "$out4" "Error [PCS_INVALID_FLAG]" "--full-paje emits PCS_INVALID_FLAG"
# 'full-paje' is not in navigate's whitelist — no suggestion expected
assert_contains "$out4" "full-paje" "--full-paje mentions the bad flag"
