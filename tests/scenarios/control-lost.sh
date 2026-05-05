#!/usr/bin/env bash
# tests/scenarios/control-lost.sh — PCS_BROWSER_CONTROL_LOST reclassification (v0.10.0+).
#
# When a regular Error (not a PcsError) escapes a command with one of the
# Playwright disconnect/teardown fragments in its message, the cli catch
# handler reclassifies it as PCS_BROWSER_CONTROL_LOST (exit 21) so the
# agent gets a tailored next-steps block instead of a generic PCS_UNKNOWN.
#
# We simulate the disconnect by writing an exec script whose run() throws
# an Error containing the fragment. A real disconnect would surface the
# same string via Playwright; we don't need a real disconnect to verify
# the classification logic.
#
# Covers:
#   1. Script throws "Target page, context or browser has been closed"
#      → exit 21, PCS_BROWSER_CONTROL_LOST in stderr, next-steps block.
#   2. Script throws "Frame was detached"
#      → same classification.
#   3. Script throws "browser has disconnected"
#      → same classification.
#   4. An unrelated error message stays as PCS_UNKNOWN (exit 1).
#   5. The next-steps block in the control-lost case mentions
#      `browser stop` / `browser start`.
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

# Run scripts in headless launch-fallback mode so no Chrome window pops.
# The exec command launches its own browser, runs the script, and tears
# down — perfect for a deterministic disconnect-string test.
export PLAYWRIGHT_CLI_HEADLESS=1

run_exec_and_capture() {
  local script_path="$1"
  local rc=0
  local out
  out="$(timeout 60 node "$CLI_JS" exec "$script_path" 2>&1)" || rc=$?
  printf '%s\n--RC--%s\n' "$out" "$rc"
}

# ── 1. "Target page, context or browser has been closed" → exit 21 ──────────
s1="$(pcs_tmp s1.mjs)"
cat > "$s1" <<'JS'
export async function run() {
  throw new Error("Target page, context or browser has been closed");
}
JS

captured="$(run_exec_and_capture "$s1")"
out1="${captured%--RC--*}"
rc1="${captured##*--RC--}"; rc1="${rc1//[$'\n\r ']}"

assert_exit_code 21 "$rc1" \
  "Target-closed error reclassified to PCS_BROWSER_CONTROL_LOST (exit 21)"
assert_contains "$out1" "Error [PCS_BROWSER_CONTROL_LOST]" \
  "stderr identifies error code as PCS_BROWSER_CONTROL_LOST"
assert_contains "$out1" "next steps:" \
  "PCS_BROWSER_CONTROL_LOST prints a next steps block"
assert_contains "$out1" "browser stop" \
  "next steps tell the agent to run 'browser stop'"
assert_contains "$out1" "browser start" \
  "next steps tell the agent to run 'browser start'"

# ── 2. "Frame was detached" → exit 21 ───────────────────────────────────────
s2="$(pcs_tmp s2.mjs)"
cat > "$s2" <<'JS'
export async function run() {
  throw new Error("Frame was detached during navigation");
}
JS

captured="$(run_exec_and_capture "$s2")"
out2="${captured%--RC--*}"
rc2="${captured##*--RC--}"; rc2="${rc2//[$'\n\r ']}"

assert_exit_code 21 "$rc2" \
  "Frame-detached error reclassified to PCS_BROWSER_CONTROL_LOST"
assert_contains "$out2" "PCS_BROWSER_CONTROL_LOST" \
  "Frame-detached: stderr identifies the new code"

# ── 3. "browser has disconnected" → exit 21 ─────────────────────────────────
s3="$(pcs_tmp s3.mjs)"
cat > "$s3" <<'JS'
export async function run() {
  throw new Error("playwright: browser has disconnected unexpectedly");
}
JS

captured="$(run_exec_and_capture "$s3")"
out3="${captured%--RC--*}"
rc3="${captured##*--RC--}"; rc3="${rc3//[$'\n\r ']}"

assert_exit_code 21 "$rc3" \
  "browser-disconnected reclassified to PCS_BROWSER_CONTROL_LOST"

# ── 4. Unrelated error message stays as PCS_UNKNOWN (exit 1) ────────────────
s4="$(pcs_tmp s4.mjs)"
cat > "$s4" <<'JS'
export async function run() {
  throw new Error("something else entirely went wrong");
}
JS

captured="$(run_exec_and_capture "$s4")"
out4="${captured%--RC--*}"
rc4="${captured##*--RC--}"; rc4="${rc4//[$'\n\r ']}"

assert_exit_code 1 "$rc4" \
  "unrelated error stays as PCS_UNKNOWN (exit 1)"
assert_contains "$out4" "PCS_UNKNOWN" \
  "unrelated error classified as PCS_UNKNOWN"
assert_not_contains "$out4" "PCS_BROWSER_CONTROL_LOST" \
  "unrelated error NOT reclassified as control-lost"
# Even PCS_UNKNOWN now prints a next-steps block (no more empty stderr).
assert_contains "$out4" "next steps:" \
  "PCS_UNKNOWN also prints a next-steps block (fail-loud-fail-useful)"

trap 'pcs_cleanup' EXIT
