#!/usr/bin/env bash
# tests/run.sh — scenario test harness runner
#
# Runs every tests/scenarios/*.sh file in its own sandboxed PLAYWRIGHT_SESSIONS_DIR,
# against the compiled CLI in dist/. Each scenario is self-contained: it sets up
# fixtures, invokes the CLI, asserts on outputs, and cleans up.
#
# Usage:
#   tests/run.sh                    # run all scenarios
#   tests/run.sh screenshot         # run only tests/scenarios/screenshot.sh
#   tests/run.sh screenshot list    # run multiple specific scenarios
#   VERBOSE=1 tests/run.sh          # stream full output from each scenario
#
# Exit code is the count of failed scenarios (0 = all green).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_JS="$REPO_ROOT/dist/cli.js"

if [[ ! -f "$CLI_JS" ]]; then
  echo "dist/cli.js not found — running \`npm run build\`..."
  (cd "$REPO_ROOT" && npm run build) || {
    echo "Build failed. Aborting scenarios." >&2
    exit 1
  }
fi

export REPO_ROOT
export CLI_JS
export PCS_SCENARIO_LIB="$SCRIPT_DIR/lib"
export PCS_FIXTURES="$SCRIPT_DIR/fixtures"

# Pick scenarios: specific names or all of scenarios/*.sh
declare -a SCENARIO_FILES=()
if [[ $# -gt 0 ]]; then
  for name in "$@"; do
    f="$SCRIPT_DIR/scenarios/${name}.sh"
    if [[ ! -f "$f" ]]; then
      echo "Error: no scenario \"$name\" at $f" >&2
      exit 2
    fi
    SCENARIO_FILES+=("$f")
  done
else
  while IFS= read -r -d '' f; do
    SCENARIO_FILES+=("$f")
  done < <(find "$SCRIPT_DIR/scenarios" -maxdepth 1 -type f -name "*.sh" -print0 | sort -z)
fi

if [[ ${#SCENARIO_FILES[@]} -eq 0 ]]; then
  echo "No scenarios found under $SCRIPT_DIR/scenarios/"
  exit 0
fi

TOTAL=0
PASSED=0
FAILED=0
declare -a FAIL_NAMES=()

printf "\n=== playwright-cli-sessions scenario harness ===\n"
printf "CLI: %s\n" "$CLI_JS"
printf "Scenarios: %d\n\n" "${#SCENARIO_FILES[@]}"

for scenario in "${SCENARIO_FILES[@]}"; do
  name="$(basename "$scenario" .sh)"
  TOTAL=$((TOTAL + 1))

  # Each scenario runs in its own sandbox sessions dir.
  sandbox="$(mktemp -d "${TMPDIR:-/tmp}/pcs-scen-${name}-XXXXXX")"
  export PLAYWRIGHT_SESSIONS_DIR="$sandbox"

  printf "▶ %s ... " "$name"

  log="$(mktemp "${TMPDIR:-/tmp}/pcs-log-${name}-XXXXXX.txt")"
  if (cd "$REPO_ROOT" && bash "$scenario") >"$log" 2>&1; then
    printf "\033[32mPASS\033[0m\n"
    PASSED=$((PASSED + 1))
    if [[ "${VERBOSE:-0}" = "1" ]]; then
      sed 's/^/    /' "$log"
    fi
  else
    rc=$?
    printf "\033[31mFAIL\033[0m (exit %d)\n" "$rc"
    sed 's/^/    /' "$log"
    FAILED=$((FAILED + 1))
    FAIL_NAMES+=("$name")
  fi

  rm -f "$log"
  rm -rf "$sandbox"
done

printf "\n=== Summary ===\n"
printf "Total:  %d\n" "$TOTAL"
printf "\033[32mPassed: %d\033[0m\n" "$PASSED"
if [[ $FAILED -gt 0 ]]; then
  printf "\033[31mFailed: %d\033[0m\n" "$FAILED"
  for n in "${FAIL_NAMES[@]}"; do
    printf "  - %s\n" "$n"
  done
else
  printf "Failed: 0\n"
fi

exit $FAILED
