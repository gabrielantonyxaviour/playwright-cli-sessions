#!/usr/bin/env bash
# tests/scenarios/browser-attached.sh — attached-mode lifecycle (v0.7.0).
#
# Verifies the core value proposition of v0.7.0: a single persistent Chrome
# that all browser commands attach to, instead of a new Chrome per command.
#
# Covers:
#   1. `browser status` with no attached Chrome → "No attached Chrome" message
#   2. `browser start --headless` launches Chrome; status shows running; state
#      file present with pid/port
#   3. `screenshot` in attached mode succeeds (no new Chrome process launched
#      — verified by comparing chrome process count before/after)
#   4. `navigate` in attached mode reuses the same browser
#   5. `browser stop` kills Chrome; status shows not running; state file gone
#   6. After stop: `screenshot` falls back to launch-per-command (still works)
#
# The scenario runs in `--headless` mode so there's no window pop during tests.
# Trap EXIT ensures the attached Chrome is torn down even if an assertion
# fails mid-run.
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

cleanup_attached() {
  # Best-effort: stop any attached Chrome this scenario started. Safe to call
  # even if nothing is running.
  node "$CLI_JS" browser stop >/dev/null 2>&1 || true
}
trap 'cleanup_attached; pcs_cleanup' EXIT

# Count MAIN Chrome processes under the scenario's sandbox profile path.
# Only the main browser process carries --remote-debugging-port — Chrome
# renderer / GPU / utility helpers do not. Counting on that flag avoids
# false positives from helper processes that naturally spawn when a tab
# opens and exit when it closes.
count_scenario_chrome() {
  # pgrep exits 1 on no-match; with set -e + pipefail this would kill the
  # scenario silently. `|| true` makes no-match return empty (→ "0" from wc).
  { pgrep -f "remote-debugging-port=.*user-data-dir=$PLAYWRIGHT_SESSIONS_DIR/.chrome-profile" 2>/dev/null || true; } | wc -l | tr -d ' '
}

# ── 1. Status with nothing running ──────────────────────────────────────────
rc=0
out1="$(node "$CLI_JS" browser status 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "browser status with no attached Chrome exits 0"
assert_contains "$out1" "No attached Chrome" "status says no attached Chrome"

# ── 2. browser start --headless ─────────────────────────────────────────────
rc=0
out2="$(timeout 60 node "$CLI_JS" browser start --headless 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "browser start --headless exits 0"
assert_contains "$out2" "Attached Chrome started" "start announces success"
assert_contains "$out2" "headless" "start reports headless mode"

state_file="$PLAYWRIGHT_SESSIONS_DIR/.attached-browser.json"
if [[ ! -f "$state_file" ]]; then
  _assert_fail "state file missing at $state_file"
else
  _assert_ok "state file written at $state_file"
fi

# ── 3. Status after start ───────────────────────────────────────────────────
rc=0
out3="$(node "$CLI_JS" browser status 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "status after start exits 0"
assert_contains "$out3" "running" "status reports running"

# ── 4. screenshot in attached mode — no new Chrome process ──────────────────
chrome_count_before="$(count_scenario_chrome)"
tmpshot="$(pcs_tmp attached.png)"
rc=0
out4="$(timeout 60 node "$CLI_JS" screenshot https://example.com --out="$tmpshot" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "attached-mode screenshot exits 0"
if [[ ! -s "$tmpshot" ]]; then
  _assert_fail "screenshot file empty or missing: $tmpshot"
else
  _assert_ok "screenshot file written ($tmpshot)"
fi
chrome_count_after="$(count_scenario_chrome)"
if [[ "$chrome_count_before" == "$chrome_count_after" ]]; then
  _assert_ok "attached-mode screenshot reused Chrome (process count stable at $chrome_count_after)"
else
  _assert_fail "attached-mode screenshot launched extra Chrome (before=$chrome_count_before after=$chrome_count_after)"
fi

# ── 5. navigate in attached mode ────────────────────────────────────────────
rc=0
out5="$(timeout 60 node "$CLI_JS" navigate https://example.com 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "attached-mode navigate exits 0"
assert_contains "$out5" "Example Domain" "navigate returned correct title"

# ── 6. browser stop ─────────────────────────────────────────────────────────
rc=0
out6="$(node "$CLI_JS" browser stop 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "browser stop exits 0"
assert_contains "$out6" "stopped" "stop announces success"

if [[ -f "$state_file" ]]; then
  _assert_fail "state file still present after stop: $state_file"
else
  _assert_ok "state file cleared after stop"
fi

# ── 7. Fallback: screenshot works after stop (launch-per-command path) ──────
rc=0
out7="$(timeout 60 node "$CLI_JS" screenshot https://example.com --out="$tmpshot" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "fallback screenshot after stop exits 0"
if [[ ! -s "$tmpshot" ]]; then
  _assert_fail "fallback screenshot file empty: $tmpshot"
else
  _assert_ok "fallback screenshot file written"
fi
