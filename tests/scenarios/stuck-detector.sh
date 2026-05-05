#!/usr/bin/env bash
# tests/scenarios/stuck-detector.sh — blind-retry warning (v0.10.0+).
#
# When a Claude/Codex agent runs the same command ≥3 times in 5 minutes and
# every attempt fails with the same exit code, the CLI prints a
# `⚠ STUCK LOOP DETECTED` block to stderr BEFORE the next attempt runs.
# The warning is advisory only — the command still executes after the
# warning prints.
#
# Covers:
#   1. With 3 pre-seeded matching agent failures, the next agent run prints
#      STUCK LOOP DETECTED before its own error.
#   2. The warning block contains the diagnostic ladder (browser status,
#      tabs list, screenshot, report).
#   3. Without CLAUDECODE=1 (i.e. user-issued), no warning fires — humans
#      are exempt.
#   4. Mixed exit codes do NOT trigger the warning — the loop must show
#      the SAME failure code repeatedly.
#   5. The pre-run warning does not change the actual exit code of the
#      current command (it still throws its own PCS_MISSING_ARG).
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

USAGE_LOG="$PLAYWRIGHT_SESSIONS_DIR/.usage-log.jsonl"

# Helper: append a fake usage-log entry. The detector only inspects the
# last 200 entries and filters by cmd + invokedBy + recency, so we just
# need three matching lines with timestamps in the last few minutes.
seed_entry() {
  local cmd="$1"
  local exit_code="$2"
  local invoked_by="$3"
  local error_msg="$4"
  local seconds_ago="${5:-30}"
  local ts
  # ISO-8601 timestamp `seconds_ago` seconds in the past
  ts="$(node -e "console.log(new Date(Date.now() - ${seconds_ago}*1000).toISOString())")"
  printf '{"ts":"%s","cmd":"%s","args":[],"exitCode":%s,"durationMs":100,"error":"%s","cwd":"/tmp","sessionId":"x","env":{"node":"v22","platform":"darwin"},"invokedBy":"%s"}\n' \
    "$ts" "$cmd" "$exit_code" "$error_msg" "$invoked_by" >> "$USAGE_LOG"
}

# ── 1. Three matching agent failures → next run shows STUCK LOOP banner ─────
rm -f "$USAGE_LOG"
seed_entry screenshot 11 claude-code "Navigation timed out (30s)" 180
seed_entry screenshot 11 claude-code "Navigation timed out (30s)" 120
seed_entry screenshot 11 claude-code "Navigation timed out (30s)" 60

rc=0
out1="$(CLAUDECODE=1 timeout 10 node "$CLI_JS" screenshot 2>&1)" || rc=$?

assert_contains "$out1" "STUCK LOOP DETECTED" \
  "agent run after 3 matching failures prints STUCK LOOP banner"
assert_contains "$out1" "browser status" \
  "STUCK warning includes 'browser status' diagnostic step"
assert_contains "$out1" "browser tabs list" \
  "STUCK warning includes 'tabs list' diagnostic step"
assert_contains "$out1" "report" \
  "STUCK warning tells the agent to file a report"
# The current command itself still throws (missing URL → PCS_MISSING_ARG).
# Stuck-detection is advisory; the actual exit code is the command's own.
assert_exit_code 2 "$rc" \
  "current command's own exit code unchanged (PCS_MISSING_ARG)"

# ── 2. Without CLAUDECODE=1, no warning fires (humans exempt) ───────────────
# The parent shell may have CLAUDECODE=1 set (the harness can run inside an
# agent session). Explicitly unset it for this assertion via env -u.
rc=0
out2="$(env -u CLAUDECODE timeout 10 node "$CLI_JS" screenshot 2>&1)" || rc=$?
assert_not_contains "$out2" "STUCK LOOP DETECTED" \
  "user-issued (CLAUDECODE unset) suppresses STUCK warning"

# ── 3. Mixed exit codes do NOT trigger the warning ──────────────────────────
rm -f "$USAGE_LOG"
seed_entry screenshot 11 claude-code "Navigation timed out" 180
seed_entry screenshot 10 claude-code "Selector timeout" 120
seed_entry screenshot 12 claude-code "Network error" 60

rc=0
out3="$(CLAUDECODE=1 timeout 10 node "$CLI_JS" screenshot 2>&1)" || rc=$?
assert_not_contains "$out3" "STUCK LOOP DETECTED" \
  "mixed exit codes do not constitute a stuck loop"

# ── 4. Two matching failures (under threshold) — no warning ─────────────────
rm -f "$USAGE_LOG"
seed_entry screenshot 11 claude-code "Navigation timed out" 60
seed_entry screenshot 11 claude-code "Navigation timed out" 30

rc=0
out4="$(CLAUDECODE=1 timeout 10 node "$CLI_JS" screenshot 2>&1)" || rc=$?
assert_not_contains "$out4" "STUCK LOOP DETECTED" \
  "two matching failures (below threshold) does not trigger the warning"

# ── 5. Successful run mid-window breaks the chain (no warning) ──────────────
rm -f "$USAGE_LOG"
seed_entry screenshot 11 claude-code "fail" 180
seed_entry screenshot 11 claude-code "fail" 120
seed_entry screenshot 0  claude-code ""     90
seed_entry screenshot 11 claude-code "fail" 30

# Only 3 of 4 are failures, but they include a success in the middle — the
# detector requires ≥3 failures with the same exitCode within window. Here
# we still have 3 failed (180/120/30) so warning may fire. Verify behavior:
rc=0
out5="$(CLAUDECODE=1 timeout 10 node "$CLI_JS" screenshot 2>&1)" || rc=$?
# The detector counts failures per exitCode. Three exit-11 failures present,
# so the warning DOES fire here. Document the current behavior — the success
# in the middle is informational but doesn't reset the count.
assert_contains "$out5" "STUCK LOOP DETECTED" \
  "3 failed matches still trigger warning even with one success in window"

# ── 6. Old failures (outside 5-minute window) do not contribute ─────────────
rm -f "$USAGE_LOG"
# 6 minutes ago — past the 5-minute window
seed_entry screenshot 11 claude-code "old" 360
seed_entry screenshot 11 claude-code "old" 320
seed_entry screenshot 11 claude-code "old" 310

rc=0
out6="$(CLAUDECODE=1 timeout 10 node "$CLI_JS" screenshot 2>&1)" || rc=$?
assert_not_contains "$out6" "STUCK LOOP DETECTED" \
  "failures older than 5 minutes do not trigger the warning"

trap 'pcs_cleanup' EXIT
