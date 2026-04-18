#!/usr/bin/env bash
# _smoke.sh — the leading underscore keeps it first in alphabetical runs.
# Proves the harness + sandbox + setup + assert plumbing works end to end.
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

# Sandbox must exist and be empty.
[[ -d "$PLAYWRIGHT_SESSIONS_DIR" ]] || { echo "sandbox dir missing" >&2; exit 1; }
[[ -z "$(ls -A "$PLAYWRIGHT_SESSIONS_DIR" 2>/dev/null)" ]] || {
  echo "sandbox is not empty: $PLAYWRIGHT_SESSIONS_DIR" >&2
  exit 1
}

# Help should mention the binary name.
help_output="$(PCS --help)"
assert_contains "$help_output" "playwright-cli-sessions" "help mentions CLI name"
assert_contains "$help_output" "screenshot" "help mentions screenshot command"

# Fixture copy smoke-test.
pcs_fixture empty-session
assert_file_exists "$PLAYWRIGHT_SESSIONS_DIR/empty-session.json" "fixture copied"

# pcs_tmp should produce a usable absolute path inside SANDBOX_TMP.
tmpf="$(pcs_tmp smoke.txt)"
[[ "$tmpf" == "$SANDBOX_TMP/smoke.txt" ]] || {
  echo "pcs_tmp returned unexpected path: $tmpf" >&2
  exit 1
}
printf "ok" > "$tmpf"
assert_file_exists "$tmpf" "pcs_tmp writable"
