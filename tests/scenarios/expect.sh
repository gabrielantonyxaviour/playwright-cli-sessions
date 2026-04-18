#!/usr/bin/env bash
# tests/scenarios/expect.sh — expect command scenarios.
#
# Exercises `playwright-cli-sessions expect <url>` against stable public URLs.
# Every case that launches a browser is bounded by a timeout and uses a short
# --timeout on the assertion itself so failures don't hang the suite.
#
# Covers:
#   1. --title substring hit → exit 0
#   2. --title substring miss → exit 1, clear diagnostic
#   3. --selector visible → exit 0
#   4. --selector missing → exit 1
#   5. --text substring hit → exit 0
#   6. --text substring miss → exit 1
#   7. --status matches → exit 0
#   8. --status mismatches → exit 1
#   9. Combined expectations all pass → exit 0
#  10. Combined with one failing → exit 1 lists ONLY the failing one
#  11. Missing URL → usage error (exit 1), guidance text
#  12. No expectation flags → error "requires at least one"
#  13. --screenshot-on-fail creates a file on failure (and only on failure)
#  14. --retry=N retries, then fails, with visible "attempt K/N+1" output
#  15. --timeout=N caps selector wait (fast fail on missing selector)
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

URL="https://example.com"

# ── 1. --title hit ────────────────────────────────────────────────────
rc=0
out="$(timeout 60 node "$CLI_JS" expect "$URL" --title="Example Domain" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "--title hit exits 0"
assert_contains "$out" "all expectations passed" "success prints summary"

# ── 2. --title miss ───────────────────────────────────────────────────
rc=0
out="$(timeout 60 node "$CLI_JS" expect "$URL" --title="Not a real title" --timeout=3000 2>&1)" || rc=$?
assert_exit_code 1 "$rc" "--title miss exits 1"
assert_contains "$out" "title: expected to contain" "failure explains the title mismatch"
assert_contains "$out" "Example Domain" "failure includes actual title"

# ── 3. --selector hit (h1 exists on example.com) ──────────────────────
rc=0
out="$(timeout 60 node "$CLI_JS" expect "$URL" --selector=h1 --timeout=5000 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "--selector=h1 hit exits 0"

# ── 4. --selector miss ────────────────────────────────────────────────
rc=0
out="$(timeout 60 node "$CLI_JS" expect "$URL" --selector=".nonexistent-class-xyz" --timeout=2000 2>&1)" || rc=$?
assert_exit_code 1 "$rc" "--selector miss exits 1"
assert_contains "$out" "selector:" "failure labels the selector"
assert_contains "$out" "not visible within" "failure explains timeout"

# ── 5. --text hit ─────────────────────────────────────────────────────
rc=0
out="$(timeout 60 node "$CLI_JS" expect "$URL" --text="This domain" --timeout=5000 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "--text hit exits 0"

# ── 6. --text miss ────────────────────────────────────────────────────
rc=0
out="$(timeout 60 node "$CLI_JS" expect "$URL" --text="this exact phrase appears nowhere zzz" --timeout=2000 2>&1)" || rc=$?
assert_exit_code 1 "$rc" "--text miss exits 1"
assert_contains "$out" "text:" "failure labels the text"

# ── 7. --status hit ───────────────────────────────────────────────────
rc=0
out="$(timeout 60 node "$CLI_JS" expect "$URL" --status=200 --timeout=5000 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "--status=200 hit exits 0"

# ── 8. --status miss ──────────────────────────────────────────────────
rc=0
out="$(timeout 60 node "$CLI_JS" expect "$URL" --status=404 --timeout=5000 2>&1)" || rc=$?
assert_exit_code 1 "$rc" "--status=404 miss on example.com exits 1"
assert_contains "$out" "status: expected 404" "failure explains status mismatch"
assert_contains "$out" "got 200" "failure includes actual status"

# ── 9. Combined: all pass ─────────────────────────────────────────────
rc=0
out="$(timeout 60 node "$CLI_JS" expect "$URL" --title="Example Domain" --selector=h1 --status=200 --timeout=5000 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "combined expectations all pass"
assert_contains "$out" "all expectations passed" "combined success prints summary"

# ── 10. Combined: one fails — report ONLY the failing one ─────────────
rc=0
out="$(timeout 60 node "$CLI_JS" expect "$URL" --title="Example Domain" --selector=h1 --status=418 --timeout=5000 2>&1)" || rc=$?
assert_exit_code 1 "$rc" "combined with one failing exits 1"
assert_contains "$out" "1 expectation(s) failed" "failure count is accurate"
assert_contains "$out" "status: expected 418" "failing expectation listed"
assert_not_contains "$out" "title: expected" "passing --title is not listed as a failure"
assert_not_contains "$out" "selector:" "passing --selector is not listed as a failure"

# ── 11. Missing URL ───────────────────────────────────────────────────
rc=0
out="$(timeout 10 node "$CLI_JS" expect 2>&1)" || rc=$?
assert_exit_code 1 "$rc" "no URL exits 1"
assert_contains "$out" "expect requires a URL" "no URL error message is clear"

# ── 12. No expectation flags ──────────────────────────────────────────
rc=0
out="$(timeout 10 node "$CLI_JS" expect "$URL" 2>&1)" || rc=$?
assert_exit_code 1 "$rc" "no expectation flags exits 1"
assert_contains "$out" "requires at least one of --title, --selector, --text, or --status" \
  "missing-expectation error enumerates the valid flags"

# ── 13. --screenshot-on-fail ──────────────────────────────────────────
shot_path="$(pcs_tmp expect-fail.png)"
[[ ! -f "$shot_path" ]] || rm "$shot_path"
rc=0
out="$(timeout 60 node "$CLI_JS" expect "$URL" --title="impossible match xyzzy" \
  --screenshot-on-fail="$shot_path" --timeout=3000 2>&1)" || rc=$?
assert_exit_code 1 "$rc" "screenshot-on-fail path exits 1 on failure"
assert_file_exists "$shot_path" "failure screenshot was written"
assert_file_min_size "$shot_path" 500 "failure screenshot has real bytes"
assert_contains "$out" "screenshot saved" "failure mentions the screenshot path"

# A successful check must NOT write a screenshot.
shot_path2="$(pcs_tmp expect-pass.png)"
[[ ! -f "$shot_path2" ]] || rm "$shot_path2"
rc=0
out="$(timeout 60 node "$CLI_JS" expect "$URL" --title="Example Domain" \
  --screenshot-on-fail="$shot_path2" --timeout=5000 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "screenshot-on-fail ignored on success"
[[ ! -f "$shot_path2" ]] || {
  echo "screenshot written on success when it shouldn't have been: $shot_path2" >&2
  exit 1
}
_assert_ok "no screenshot written when the check passes"

# ── 14. --retry=N — attempts announced, then fails ───────────────────
rc=0
out="$(timeout 90 node "$CLI_JS" expect "$URL" --title="zzz unreachable phrase" \
  --retry=2 --timeout=2000 2>&1)" || rc=$?
assert_exit_code 1 "$rc" "retry still ends in exit 1 when every attempt fails"
# With --retry=2 we get attempts 1/3 and 2/3 (the 3rd is the last, no message).
assert_contains "$out" "attempt 1/3" "retry output announces attempt 1/3"
assert_contains "$out" "attempt 2/3" "retry output announces attempt 2/3"
assert_contains "$out" "retrying in" "retry output announces backoff"

# ── 15. --timeout caps waiting on a missing selector ─────────────────
start_ns=$(date +%s)
rc=0
timeout 30 node "$CLI_JS" expect "$URL" --selector=".still-not-here-abc123" --timeout=1500 >/dev/null 2>&1 || rc=$?
end_ns=$(date +%s)
elapsed=$((end_ns - start_ns))
assert_exit_code 1 "$rc" "short --timeout on missing selector still exits 1"
(( elapsed <= 20 )) || {
  echo "expected missing-selector check to finish in <20s, took ${elapsed}s" >&2
  exit 1
}
_assert_ok "short --timeout honored (elapsed=${elapsed}s)"
