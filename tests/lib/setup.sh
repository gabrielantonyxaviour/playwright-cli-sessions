#!/usr/bin/env bash
# tests/lib/setup.sh — shared setup for scenario scripts.
#
# Sourced by every tests/scenarios/*.sh. Provides:
#   - PCS()             — invokes the CLI with node (and the sandbox env var)
#   - pcs_tmp <name>    — mktemp under $SANDBOX_TMP, auto-cleaned
#   - pcs_fixture <name>— copy tests/fixtures/<name>.json into the sandbox as <name>.json
#   - pcs_cleanup       — trap handler, called on exit
#
# Environment contract (set by tests/run.sh before calling the scenario):
#   REPO_ROOT                 — absolute path to repo root
#   CLI_JS                    — dist/cli.js path
#   PCS_SCENARIO_LIB          — tests/lib/
#   PCS_FIXTURES              — tests/fixtures/
#   PLAYWRIGHT_SESSIONS_DIR   — sandboxed session store (already exported)
#
# After sourcing this file a scenario script is expected to call `set -e` (or
# the individual asserts will already return non-zero and the harness will
# propagate the exit code).

if [[ -z "${REPO_ROOT:-}" || -z "${CLI_JS:-}" || -z "${PLAYWRIGHT_SESSIONS_DIR:-}" ]]; then
  echo "setup.sh: missing harness env (REPO_ROOT / CLI_JS / PLAYWRIGHT_SESSIONS_DIR)" >&2
  exit 2
fi

# Share one tmp subdirectory per scenario; cleaned up on exit.
SANDBOX_TMP="$(mktemp -d "${TMPDIR:-/tmp}/pcs-scen-tmp-XXXXXX")"

# shellcheck source=./assert.sh
source "${PCS_SCENARIO_LIB}/assert.sh"

# Invoke the CLI. Usage: PCS list --json
#                        out="$(PCS list)"
#                        PCS screenshot "$url" --out="$f"
PCS() {
  node "$CLI_JS" "$@"
}

# Create a sandboxed temp path. Usage: f="$(pcs_tmp shot.png)"
pcs_tmp() {
  local name="${1:-file}"
  printf "%s/%s" "$SANDBOX_TMP" "$name"
}

# Copy a fixture file into PLAYWRIGHT_SESSIONS_DIR as <dstName>.json.
# Usage: pcs_fixture empty-session fakesess
pcs_fixture() {
  local src="$1"
  local dst="${2:-$1}"
  local src_path="$PCS_FIXTURES/${src}.json"
  if [[ ! -f "$src_path" ]]; then
    echo "pcs_fixture: fixture not found: $src_path" >&2
    return 1
  fi
  cp "$src_path" "$PLAYWRIGHT_SESSIONS_DIR/${dst}.json"
}

pcs_cleanup() {
  rm -rf "$SANDBOX_TMP"
}
trap pcs_cleanup EXIT
