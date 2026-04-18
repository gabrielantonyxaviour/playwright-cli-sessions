#!/usr/bin/env bash
# tests/scenarios/screenshot.sh — screenshot command scenarios.
#
# Covers:
#   1. Basic headless screenshot to explicit --out
#   2. --out auto-creates nested parent directories
#   3. --full-page succeeds (and default viewport succeeds)
#   4. --wait-for=<selector> with an existing selector
#   5. --wait-for with a never-matching selector times out (non-zero exit)
#   6. --wait-until=load succeeds
#   7. --wait-until=bogus rejected with clear error + valid values listed
#   8. Missing URL argument → clear error
#   9. Default --out path → /tmp/screenshot-<ts>.png is created (and cleaned up)
#
# Target URL: https://example.com — static, tiny, always up, has <h1> and <body>.
# Every network-facing command is wrapped in `timeout 60` so a hung browser
# can't stall CI.

set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

URL="https://example.com"

# ── 1. Basic headless screenshot to explicit --out ───────────────────────────
# Proves: exit=0, PNG written, file is non-trivial, success line printed,
# and the output echoes the URL we requested.
f1="$(pcs_tmp basic.png)"
rc=0
out1="$(timeout 60 node "$CLI_JS" screenshot "$URL" --out="$f1" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "basic screenshot exits 0"
assert_file_exists "$f1" "basic screenshot file written"
assert_file_min_size "$f1" 1000 "basic screenshot file ≥ 1000 bytes"
assert_contains "$out1" "✓ Screenshot saved" "basic screenshot prints success line"
assert_contains "$out1" "$URL" "basic screenshot output mentions the URL"

# ── 2. --out auto-creates nested parent directories ──────────────────────────
# The nested dirs don't exist yet — the command must mkdir -p for us.
f2="$(pcs_tmp nested/deep/cap.png)"
[[ ! -d "$(dirname "$f2")" ]] || { echo "precondition: nested dir shouldn't exist yet" >&2; exit 1; }
rc=0
out2="$(timeout 60 node "$CLI_JS" screenshot "$URL" --out="$f2" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "nested --out exits 0"
assert_file_exists "$f2" "nested --out file written (parents created)"
assert_file_min_size "$f2" 1000 "nested --out file ≥ 1000 bytes"

# ── 3. --full-page succeeds alongside default viewport ───────────────────────
# Both modes must produce a valid PNG. example.com is short enough that
# full-page may equal viewport in size, so we don't compare magnitudes.
f3a="$(pcs_tmp viewport.png)"
f3b="$(pcs_tmp full.png)"
rc=0
out3a="$(timeout 60 node "$CLI_JS" screenshot "$URL" --out="$f3a" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "default viewport screenshot exits 0"
assert_file_min_size "$f3a" 1000 "default viewport screenshot ≥ 1000 bytes"

rc=0
out3b="$(timeout 60 node "$CLI_JS" screenshot "$URL" --full-page --out="$f3b" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "--full-page screenshot exits 0"
assert_file_min_size "$f3b" 1000 "--full-page screenshot ≥ 1000 bytes"

# ── 4. --wait-for=<selector> with an existing selector ───────────────────────
# <h1> is present on example.com → navigation + selector wait succeeds.
f4="$(pcs_tmp wait-for-h1.png)"
rc=0
out4="$(timeout 60 node "$CLI_JS" screenshot "$URL" --wait-for=h1 --out="$f4" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "--wait-for=h1 exits 0"
assert_file_exists "$f4" "--wait-for=h1 file written"
assert_file_min_size "$f4" 1000 "--wait-for=h1 file ≥ 1000 bytes"

# ── 5. --wait-for selector that never matches must fail ──────────────────────
# Playwright's 30s selector timeout + browser overhead < 60s guard.
# On timeout we expect non-zero exit and an Error line mentioning the selector.
f5="$(pcs_tmp never.png)"
rc=0
out5="$(timeout 60 node "$CLI_JS" screenshot "$URL" --wait-for="#no-such-element-ever" --out="$f5" 2>&1)" || rc=$?
[[ "$rc" != "0" ]] || {
  echo "--wait-for with missing selector unexpectedly succeeded (rc=0)" >&2
  echo "$out5" >&2
  exit 1
}
assert_contains "$out5" "Error [" "missing-selector timeout prints error code"
# Playwright's timeout message includes "Timeout" — case-insensitive match via lowercased copy.
out5_lc="$(printf '%s' "$out5" | tr '[:upper:]' '[:lower:]')"
assert_contains "$out5_lc" "timeout" "missing-selector error mentions timeout"

# ── 6. --wait-until=load succeeds ────────────────────────────────────────────
f6="$(pcs_tmp wait-until-load.png)"
rc=0
out6="$(timeout 60 node "$CLI_JS" screenshot "$URL" --wait-until=load --out="$f6" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "--wait-until=load exits 0"
assert_file_exists "$f6" "--wait-until=load file written"

# ── 7. --wait-until=bogus must be rejected ───────────────────────────────────
# parseWaitUntil throws; main()'s catch prints "Error: Invalid --wait-until=..."
# and lists the valid values. No browser is launched → should be fast.
rc=0
out7="$(timeout 15 node "$CLI_JS" screenshot "$URL" --wait-until=bogus --out="$(pcs_tmp bogus.png)" 2>&1)" || rc=$?
[[ "$rc" != "0" ]] || { echo "--wait-until=bogus unexpectedly succeeded" >&2; echo "$out7" >&2; exit 1; }
assert_contains "$out7" "Invalid --wait-until" "invalid --wait-until produces specific error"
assert_contains "$out7" "load" "invalid --wait-until lists 'load'"
assert_contains "$out7" "domcontentloaded" "invalid --wait-until lists 'domcontentloaded'"
assert_contains "$out7" "networkidle" "invalid --wait-until lists 'networkidle'"
assert_contains "$out7" "commit" "invalid --wait-until lists 'commit'"

# ── 8. Missing URL argument ──────────────────────────────────────────────────
# No browser is launched; error is printed by the CLI router.
rc=0
out8="$(timeout 10 node "$CLI_JS" screenshot 2>&1)" || rc=$?
[[ "$rc" != "0" ]] || { echo "missing URL unexpectedly succeeded" >&2; echo "$out8" >&2; exit 1; }
assert_contains "$out8" "screenshot requires a URL" "missing URL prints error message"

# ── 9. Default --out path (no --out) → /tmp/screenshot-<ts>.png ─────────────
# The code path: `resolve(tmpdir(), "screenshot-${Date.now()}.png")`.
# We parse the emitted success line to learn the exact path, then verify.
rc=0
out9="$(timeout 60 node "$CLI_JS" screenshot "$URL" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "default --out exits 0"
assert_contains "$out9" "✓ Screenshot saved to " "default --out prints saved path"
# Extract the path from the "✓ Screenshot saved to <path>" line.
default_path="$(printf '%s\n' "$out9" | sed -n 's/^.*✓ Screenshot saved to \(.*\)$/\1/p' | head -n1)"
[[ -n "$default_path" ]] || {
  echo "could not parse default screenshot path from output:" >&2
  echo "$out9" >&2
  exit 1
}
assert_file_exists "$default_path" "default --out file exists at parsed path"
assert_file_min_size "$default_path" 1000 "default --out file ≥ 1000 bytes"
# Clean up so repeated runs don't pollute /tmp with stale captures.
rm -f "$default_path"
