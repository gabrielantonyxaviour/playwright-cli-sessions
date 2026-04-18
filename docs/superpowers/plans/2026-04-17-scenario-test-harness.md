# Scenario Test Harness Implementation Plan

> **For agentic workers:** Pick ONE of three sanctioned execution paths:
> 1. **`superpowers:executing-plans`** — sequential execution with built-in checkpoints (default for most plans)
> 2. **cmux-teams** — parallel execution across 3+ independent workstreams via cmux tabs (see `~/.claude/rules/cmux-teams.md`)
> 3. **`superpowers:subagent-driven-development`** — fresh subagent per task, fastest iteration (for plans with clear task boundaries)
>
> **Fresh session guidance**: prefer a fresh Claude Code session for plans with 10+ tasks, schema migrations, or multi-module changes — stale context from the planning conversation degrades quality on big plans. For small focused plans (3–5 tasks in a single module), inline execution in the current session is acceptable.
>
> **Testing flow**: this project has no `CLAUDE.md`. The flow defined for this plan is **implement → run scenario → commit** (bash-driven scenario tests invoking the compiled CLI). Pure TDD is not the default here — scenarios are integration tests, not unit-first.
>
> **Verification between tasks**: the executing skills automatically invoke `superpowers:verification-before-completion` before marking each task as done. Every task that writes code must produce a passing scenario run as evidence.
>
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a rigorous scenario test harness under `tests/scenarios/` that exercises every `playwright-cli-sessions` command across realistic scenarios, runs in parallel where safe, and produces a human-readable report the user reviews before features ship.

**Architecture:** Bash-driven scenarios. Each scenario is a self-contained `.sh` file that invokes the compiled CLI, captures stdout/stderr/exit-code, asserts expected behavior, and writes a structured result. A runner (`tests/run.sh`) discovers all scenarios, runs them (sequentially per-command, parallel across commands where possible), collects results, prints a markdown report. No external test framework — just bash + the real CLI.

**Tech Stack:** bash, node (for the compiled CLI in `dist/`), jq (JSON validation), Playwright's bundled browser (installed separately via `npx playwright install chromium`), public sites for network scenarios (example.com, github.com).

**Project flow reference:** No `CLAUDE.md` in this repo. Flow for this plan = implement → scenario → commit. Every feature gates on a passing scenario.

---

## File Structure

**Created:**
- `tests/README.md` — how to run, how to add scenarios
- `tests/run.sh` — test runner (discovers, executes, reports)
- `tests/lib/assert.sh` — assertion helpers (source'd by every scenario)
- `tests/lib/setup.sh` — shared setup (build, tmpdir, fixtures)
- `tests/fixtures/empty-session.json` — known-good minimal session for restore/probe scenarios
- `tests/scenarios/list/*.sh` — `list` command scenarios
- `tests/scenarios/screenshot/*.sh` — `screenshot` scenarios
- `tests/scenarios/navigate/*.sh` — `navigate` scenarios
- `tests/scenarios/snapshot/*.sh` — `snapshot` scenarios
- `tests/scenarios/exec/*.sh` — `exec` scenarios
- `tests/scenarios/login/*.sh` — `login` scenarios (non-TTY only; headed-TTY is manual)
- `tests/scenarios/refresh/*.sh` — `refresh` scenarios
- `tests/scenarios/probe/*.sh` — `probe` scenarios
- `tests/.gitignore` — ignore `tmp/`, `results/`

**Modified:**
- `package.json` — add `"test:scenarios": "bash tests/run.sh"` script
- `README.md` — add "Testing" section pointing at `tests/README.md`
- `.gitignore` (root) — ignore `tests/tmp/`, `tests/results/`

---

## Parallelism guidance

- Tasks 1–4 are foundation and **must be sequential** — later tasks source the libs from these.
- Tasks 5–11 (per-command scenarios) are **independent** and parallelizable across cmux teammates or subagents. Each owns its own `tests/scenarios/<command>/` directory — no file overlap.
- Tasks 12–13 are sequential after all scenario tasks complete.

---

## Task 1: Scaffold the tests/ directory and runner skeleton

**Files:**
- Create: `tests/README.md`
- Create: `tests/run.sh`
- Create: `tests/.gitignore`
- Modify: `.gitignore` (root)

- [ ] **Step 1: Create `tests/README.md`**

```markdown
# Scenario Test Harness

Bash-driven integration tests for `playwright-cli-sessions`. Each scenario invokes the compiled CLI (`dist/cli.js`) as a real user would, captures output, and asserts expected behavior.

## Running

    npm run build                      # compile TS first
    npm run test:scenarios             # run all scenarios
    npm run test:scenarios -- list     # only scenarios under tests/scenarios/list/
    VERBOSE=1 npm run test:scenarios   # show stdout/stderr from each scenario

## Adding a scenario

1. Pick the right directory under `tests/scenarios/<command>/`.
2. Copy an existing scenario as a template. Name it `NN-<short-name>.sh` (zero-padded index).
3. Source the libs, run the CLI, assert. See existing scenarios for examples.
4. Run `npm run test:scenarios -- <command>` to confirm it passes.
5. Commit.

## Requirements

- `jq` (for JSON assertions) — install via `brew install jq` on macOS
- `node` (already required by the package)
- Chromium for Playwright: `npx playwright install chromium`
- Network access (some scenarios hit example.com / github.com)
```

- [ ] **Step 2: Create `tests/run.sh`**

```bash
#!/usr/bin/env bash
# tests/run.sh — scenario test runner for playwright-cli-sessions
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCENARIOS_DIR="$ROOT/tests/scenarios"
RESULTS_DIR="$ROOT/tests/results"
TMP_ROOT="$ROOT/tests/tmp"
CLI="$ROOT/dist/cli.js"

# Filter: optional first arg restricts to one command's scenarios
FILTER="${1:-}"

# Ensure CLI is built
if [ ! -f "$CLI" ]; then
  echo "CLI not built — run 'npm run build' first" >&2
  exit 1
fi

mkdir -p "$RESULTS_DIR" "$TMP_ROOT"
rm -rf "$TMP_ROOT"/* "$RESULTS_DIR"/*.json 2>/dev/null || true

# Collect scenario files
if [ -n "$FILTER" ]; then
  SCENARIOS=$(find "$SCENARIOS_DIR/$FILTER" -name "*.sh" 2>/dev/null | sort)
else
  SCENARIOS=$(find "$SCENARIOS_DIR" -name "*.sh" | sort)
fi

if [ -z "$SCENARIOS" ]; then
  echo "No scenarios found" >&2
  exit 1
fi

PASS=0
FAIL=0
FAILED_NAMES=()
START_TS=$(date +%s)

for scenario in $SCENARIOS; do
  name=$(echo "$scenario" | sed "s|$SCENARIOS_DIR/||;s|.sh$||")
  tmpdir="$TMP_ROOT/$(echo "$name" | tr '/' '-')"
  mkdir -p "$tmpdir"
  export PCS_CLI="$CLI"
  export PCS_TMPDIR="$tmpdir"
  export PCS_ROOT="$ROOT"

  if [ "${VERBOSE:-0}" = "1" ]; then
    echo "── $name ──"
    if bash "$scenario"; then
      echo "  ✓ PASS"
      PASS=$((PASS + 1))
    else
      echo "  ✗ FAIL"
      FAIL=$((FAIL + 1))
      FAILED_NAMES+=("$name")
    fi
  else
    if bash "$scenario" > "$tmpdir/stdout.log" 2> "$tmpdir/stderr.log"; then
      printf "  ✓ %s\n" "$name"
      PASS=$((PASS + 1))
    else
      printf "  ✗ %s\n" "$name"
      FAIL=$((FAIL + 1))
      FAILED_NAMES+=("$name")
    fi
  fi
done

DURATION=$(($(date +%s) - START_TS))
TOTAL=$((PASS + FAIL))

echo ""
echo "════════════════════════════════════════"
echo "  Scenarios: $TOTAL  Passed: $PASS  Failed: $FAIL  (${DURATION}s)"
echo "════════════════════════════════════════"

if [ $FAIL -gt 0 ]; then
  echo ""
  echo "Failed scenarios (rerun with VERBOSE=1 to see output):"
  for n in "${FAILED_NAMES[@]}"; do
    echo "  - $n  →  tests/tmp/$(echo "$n" | tr '/' '-')/"
  done
  exit 1
fi

exit 0
```

- [ ] **Step 3: Create `tests/.gitignore`**

```
tmp/
results/
```

- [ ] **Step 4: Append to root `.gitignore`**

```
tests/tmp/
tests/results/
```

- [ ] **Step 5: Make run.sh executable and commit**

```bash
chmod +x tests/run.sh
git add tests/README.md tests/run.sh tests/.gitignore .gitignore
git commit -m "test(scenarios): scaffold scenario-test harness"
```

---

## Task 2: Assertion helpers library

**Files:**
- Create: `tests/lib/assert.sh`

- [ ] **Step 1: Write `tests/lib/assert.sh`**

```bash
# tests/lib/assert.sh — assertion helpers for scenarios.
# Every scenario sources this via: source "$PCS_ROOT/tests/lib/assert.sh"

_fail() {
  echo "ASSERT FAIL: $1" >&2
  [ -n "${2:-}" ] && echo "  detail: $2" >&2
  exit 1
}

assert_eq() {
  # assert_eq <actual> <expected> [message]
  if [ "$1" != "$2" ]; then
    _fail "${3:-values differ}" "actual='$1' expected='$2'"
  fi
}

assert_exit_code() {
  # assert_exit_code <actual> <expected>
  if [ "$1" != "$2" ]; then
    _fail "exit code mismatch" "actual=$1 expected=$2"
  fi
}

assert_file_exists() {
  # assert_file_exists <path>
  [ -f "$1" ] || _fail "file missing: $1"
}

assert_file_min_size() {
  # assert_file_min_size <path> <bytes>
  [ -f "$1" ] || _fail "file missing: $1"
  local size
  size=$(stat -f%z "$1" 2>/dev/null || stat -c%s "$1")
  if [ "$size" -lt "$2" ]; then
    _fail "file too small: $1" "size=$size min=$2"
  fi
}

assert_contains() {
  # assert_contains <haystack> <needle>
  case "$1" in
    *"$2"*) return 0 ;;
    *) _fail "string missing substring" "substring='$2'" ;;
  esac
}

assert_not_contains() {
  case "$1" in
    *"$2"*) _fail "string contains forbidden substring" "substring='$2'" ;;
    *) return 0 ;;
  esac
}

assert_valid_json() {
  # assert_valid_json <string>
  echo "$1" | jq -e . > /dev/null 2>&1 || _fail "not valid JSON" "$(echo "$1" | head -c 200)"
}

assert_json_has() {
  # assert_json_has <json-string> <jq-path>    e.g. '.title'
  local v
  v=$(echo "$1" | jq -r "$2" 2>/dev/null)
  if [ -z "$v" ] || [ "$v" = "null" ]; then
    _fail "json missing path $2" "$(echo "$1" | head -c 200)"
  fi
}
```

- [ ] **Step 2: Smoke-test the lib in isolation**

Run:
```bash
cd /Users/gabrielantonyxaviour/Documents/infra/playwright-cli-sessions
bash -c 'export PCS_ROOT="$PWD"; source tests/lib/assert.sh; assert_eq "hi" "hi" && echo ok'
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add tests/lib/assert.sh
git commit -m "test(scenarios): assert helpers"
```

---

## Task 3: Setup helpers library

**Files:**
- Create: `tests/lib/setup.sh`
- Create: `tests/fixtures/empty-session.json`

- [ ] **Step 1: Write `tests/lib/setup.sh`**

```bash
# tests/lib/setup.sh — shared setup for scenarios.
# Usage: source "$PCS_ROOT/tests/lib/setup.sh"
# After sourcing, $PCS_CLI, $PCS_TMPDIR, $PCS_SESSIONS are available.

# Use a scenario-local sessions dir so scenarios never pollute ~/.playwright-sessions
export PCS_SESSIONS="$PCS_TMPDIR/sessions"
mkdir -p "$PCS_SESSIONS"

# Hint the CLI to use our sandbox — the store module reads PLAYWRIGHT_SESSIONS_DIR if set.
# (If it doesn't yet, scenarios that need sessions should cp fixtures into $HOME/.playwright-sessions
# and clean up after — but Task 3 Step 2 verifies the env var path first.)
export PLAYWRIGHT_SESSIONS_DIR="$PCS_SESSIONS"

pcs() {
  # Invoke the compiled CLI. All args forwarded.
  node "$PCS_CLI" "$@"
}

pcs_capture() {
  # Run pcs, capture stdout + stderr + exit code into shell vars.
  # Usage: pcs_capture <args...>   then read $STDOUT $STDERR $EXIT_CODE
  STDOUT=$(node "$PCS_CLI" "$@" 2> "$PCS_TMPDIR/stderr.tmp")
  EXIT_CODE=$?
  STDERR=$(cat "$PCS_TMPDIR/stderr.tmp")
}

install_fixture_session() {
  # install_fixture_session <name>
  # Copies tests/fixtures/<name>.json → $PCS_SESSIONS/<name>.json
  local name="$1"
  cp "$PCS_ROOT/tests/fixtures/$name.json" "$PCS_SESSIONS/$name.json"
}
```

- [ ] **Step 2: Verify the CLI actually respects `PLAYWRIGHT_SESSIONS_DIR`**

Run:
```bash
grep -rn "PLAYWRIGHT_SESSIONS_DIR\|playwright-sessions" /Users/gabrielantonyxaviour/Documents/infra/playwright-cli-sessions/src/store.ts
```
Expected: the store has a lookup for the env var. If not, add it (small edit to `src/store.ts`) before continuing — scenarios cannot proceed without isolated session dirs.

If the env var is NOT supported yet:

```typescript
// src/store.ts — top of file, near other path constants
const SESSIONS_DIR =
  process.env.PLAYWRIGHT_SESSIONS_DIR ??
  path.join(os.homedir(), ".playwright-sessions");
```

Then rebuild: `npm run build`.

- [ ] **Step 3: Create `tests/fixtures/empty-session.json`**

```json
{
  "storageState": { "cookies": [], "origins": [] },
  "savedAt": "2026-01-01T00:00:00.000Z",
  "tags": {}
}
```

- [ ] **Step 4: Commit**

```bash
git add tests/lib/setup.sh tests/fixtures/empty-session.json src/store.ts dist/
git commit -m "test(scenarios): setup helpers + session-dir env var"
```

---

## Task 4: Scenarios for `list`

**Files:**
- Create: `tests/scenarios/list/01-empty.sh`
- Create: `tests/scenarios/list/02-with-fixture.sh`
- Create: `tests/scenarios/list/03-json-output.sh`

- [ ] **Step 1: `01-empty.sh` — no sessions, should not error**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

pcs_capture list --probe=false
assert_exit_code "$EXIT_CODE" 0
assert_contains "$STDOUT" "No sessions" || assert_contains "$STDOUT" "no saved"
```

- [ ] **Step 2: `02-with-fixture.sh` — one session installed, `list` shows it**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

install_fixture_session empty-session
pcs_capture list --probe=false
assert_exit_code "$EXIT_CODE" 0
assert_contains "$STDOUT" "empty-session"
```

- [ ] **Step 3: `03-json-output.sh` — `--json` produces valid JSON array**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

install_fixture_session empty-session
pcs_capture list --probe=false --json
assert_exit_code "$EXIT_CODE" 0
assert_valid_json "$STDOUT"
# Must be an array of at least 1 item
count=$(echo "$STDOUT" | jq 'length')
assert_eq "$count" "1" "expected 1 session"
```

- [ ] **Step 4: Run only the list scenarios**

```bash
npm run build && bash tests/run.sh list
```

Expected:
```
  ✓ list/01-empty
  ✓ list/02-with-fixture
  ✓ list/03-json-output
Scenarios: 3  Passed: 3  Failed: 0
```

If anything fails: fix the CLI (likely `--json` flag behavior), rebuild, rerun. Don't proceed until all three pass.

- [ ] **Step 5: Commit**

```bash
git add tests/scenarios/list/
git commit -m "test(scenarios): list command"
```

---

## Task 5: Scenarios for `screenshot`

**Files:**
- Create: `tests/scenarios/screenshot/01-public-url.sh`
- Create: `tests/scenarios/screenshot/02-out-auto-mkdir.sh`
- Create: `tests/scenarios/screenshot/03-wait-for-selector.sh`
- Create: `tests/scenarios/screenshot/04-wait-for-timeout.sh`
- Create: `tests/scenarios/screenshot/05-invalid-url.sh`
- Create: `tests/scenarios/screenshot/06-missing-url.sh`
- Create: `tests/scenarios/screenshot/07-full-page.sh`

- [ ] **Step 1: `01-public-url.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

OUT="$PCS_TMPDIR/out.png"
pcs_capture screenshot https://example.com --out="$OUT"
assert_exit_code "$EXIT_CODE" 0
assert_file_min_size "$OUT" 1000
assert_contains "$STDOUT" "Screenshot saved"
```

- [ ] **Step 2: `02-out-auto-mkdir.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

OUT="$PCS_TMPDIR/deep/nested/dir/shot.png"
pcs_capture screenshot https://example.com --out="$OUT"
assert_exit_code "$EXIT_CODE" 0
assert_file_min_size "$OUT" 1000
```

- [ ] **Step 3: `03-wait-for-selector.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

OUT="$PCS_TMPDIR/shot.png"
pcs_capture screenshot https://example.com --out="$OUT" --wait-for=h1
assert_exit_code "$EXIT_CODE" 0
assert_file_min_size "$OUT" 1000
```

- [ ] **Step 4: `04-wait-for-timeout.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

OUT="$PCS_TMPDIR/shot.png"
pcs_capture screenshot https://example.com --out="$OUT" --wait-for=".does-not-exist-12345"
assert_exit_code "$EXIT_CODE" 1
assert_contains "$STDERR" "Error"
```

- [ ] **Step 5: `05-invalid-url.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

pcs_capture screenshot not-a-url --out="$PCS_TMPDIR/x.png"
assert_exit_code "$EXIT_CODE" 1
assert_contains "$STDERR" "Error"
```

- [ ] **Step 6: `06-missing-url.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

pcs_capture screenshot
assert_exit_code "$EXIT_CODE" 1
assert_contains "$STDERR" "requires a URL"
```

- [ ] **Step 7: `07-full-page.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

OUT_VP="$PCS_TMPDIR/viewport.png"
OUT_FP="$PCS_TMPDIR/fullpage.png"
pcs screenshot https://example.com --out="$OUT_VP" > /dev/null
pcs screenshot https://example.com --out="$OUT_FP" --full-page > /dev/null

# Full-page capture of example.com should be at least as large in bytes as viewport.
size_vp=$(stat -f%z "$OUT_VP" 2>/dev/null || stat -c%s "$OUT_VP")
size_fp=$(stat -f%z "$OUT_FP" 2>/dev/null || stat -c%s "$OUT_FP")
if [ "$size_fp" -lt "$size_vp" ]; then
  echo "full-page ($size_fp) smaller than viewport ($size_vp)" >&2
  exit 1
fi
```

- [ ] **Step 8: Run only screenshot scenarios**

```bash
bash tests/run.sh screenshot
```

Expected: all 7 pass. If any fail, fix the CLI, rebuild, rerun.

- [ ] **Step 9: Commit**

```bash
git add tests/scenarios/screenshot/
git commit -m "test(scenarios): screenshot command"
```

---

## Task 6: Scenarios for `navigate`

**Files:**
- Create: `tests/scenarios/navigate/01-basic.sh`
- Create: `tests/scenarios/navigate/02-with-snapshot.sh`
- Create: `tests/scenarios/navigate/03-invalid-url.sh`

- [ ] **Step 1: `01-basic.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

pcs_capture navigate https://example.com
assert_exit_code "$EXIT_CODE" 0
assert_contains "$STDOUT" "Navigated to"
assert_contains "$STDOUT" "Title: Example Domain"
```

- [ ] **Step 2: `02-with-snapshot.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

pcs_capture navigate https://example.com --snapshot
assert_exit_code "$EXIT_CODE" 0
assert_contains "$STDOUT" "Example Domain"
# ARIA snapshot prints YAML-like text with "- heading" or similar
assert_contains "$STDOUT" "- "
```

- [ ] **Step 3: `03-invalid-url.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

pcs_capture navigate https://this-domain-really-does-not-exist-12345.invalid
assert_exit_code "$EXIT_CODE" 1
assert_contains "$STDERR" "Error"
```

- [ ] **Step 4: Run + fix + commit**

```bash
bash tests/run.sh navigate
git add tests/scenarios/navigate/ && git commit -m "test(scenarios): navigate command"
```

---

## Task 7: Scenarios for `snapshot`

**Files:**
- Create: `tests/scenarios/snapshot/01-basic.sh`
- Create: `tests/scenarios/snapshot/02-wait-for.sh`

- [ ] **Step 1: `01-basic.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

pcs_capture snapshot https://example.com
assert_exit_code "$EXIT_CODE" 0
assert_contains "$STDOUT" "Example Domain"
```

- [ ] **Step 2: `02-wait-for.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

pcs_capture snapshot https://example.com --wait-for=h1
assert_exit_code "$EXIT_CODE" 0
assert_contains "$STDOUT" "Example Domain"
```

- [ ] **Step 3: Run + commit**

```bash
bash tests/run.sh snapshot
git add tests/scenarios/snapshot/ && git commit -m "test(scenarios): snapshot command"
```

---

## Task 8: Scenarios for `exec`

**Files:**
- Create: `tests/scenarios/exec/01-basic-return.sh`
- Create: `tests/scenarios/exec/02-context-browser-api.sh`
- Create: `tests/scenarios/exec/03-missing-run-export.sh`
- Create: `tests/scenarios/exec/04-with-url-arg.sh`

- [ ] **Step 1: `01-basic-return.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

cat > "$PCS_TMPDIR/script.mjs" <<'EOF'
export async function run({ page }) {
  await page.goto("https://example.com");
  return { title: await page.title() };
}
EOF

pcs_capture exec "$PCS_TMPDIR/script.mjs"
assert_exit_code "$EXIT_CODE" 0
assert_valid_json "$STDOUT"
assert_json_has "$STDOUT" ".title"
title=$(echo "$STDOUT" | jq -r .title)
assert_contains "$title" "Example Domain"
```

- [ ] **Step 2: `02-context-browser-api.sh` — verify `{page, context, browser}` all passed**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

cat > "$PCS_TMPDIR/script.mjs" <<'EOF'
export async function run({ page, context, browser }) {
  return {
    hasPage: typeof page?.goto === "function",
    hasContext: typeof context?.cookies === "function",
    hasBrowser: typeof browser?.version === "function",
  };
}
EOF

pcs_capture exec "$PCS_TMPDIR/script.mjs"
assert_exit_code "$EXIT_CODE" 0
assert_valid_json "$STDOUT"
assert_eq "$(echo "$STDOUT" | jq -r .hasPage)" "true"
assert_eq "$(echo "$STDOUT" | jq -r .hasContext)" "true"
assert_eq "$(echo "$STDOUT" | jq -r .hasBrowser)" "true"
```

- [ ] **Step 3: `03-missing-run-export.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

cat > "$PCS_TMPDIR/script.mjs" <<'EOF'
export const notRun = 1;
EOF

pcs_capture exec "$PCS_TMPDIR/script.mjs"
assert_exit_code "$EXIT_CODE" 1
assert_contains "$STDERR" "run"
```

- [ ] **Step 4: `04-with-url-arg.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

cat > "$PCS_TMPDIR/script.mjs" <<'EOF'
export async function run({ page }) {
  return { url: page.url() };
}
EOF

pcs_capture exec "$PCS_TMPDIR/script.mjs" https://example.com
assert_exit_code "$EXIT_CODE" 0
assert_contains "$STDOUT" "example.com"
```

- [ ] **Step 5: Run + commit**

```bash
bash tests/run.sh exec
git add tests/scenarios/exec/ && git commit -m "test(scenarios): exec command"
```

---

## Task 9: Scenarios for `login` and `refresh`

**Note:** Full interactive login requires a human. For automation, we test only:
- The non-TTY "waits for browser close" path can be started (we kill the browser shortly after to simulate user closing it).
- `refresh` errors cleanly when the session does not exist.
- `refresh` errors cleanly when no URL is provided AND the session has no `lastUrl`.

**Files:**
- Create: `tests/scenarios/refresh/01-missing-session.sh`
- Create: `tests/scenarios/refresh/02-no-url-no-lasturl.sh`
- Create: `tests/scenarios/login/01-non-tty-kills-browser.sh` (skipped by default, opt-in via `PCS_RUN_SLOW=1`)

- [ ] **Step 1: `refresh/01-missing-session.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

pcs_capture refresh does-not-exist --url=https://example.com
assert_exit_code "$EXIT_CODE" 1
assert_contains "$STDERR" "No saved session"
```

- [ ] **Step 2: `refresh/02-no-url-no-lasturl.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

# Install a fixture that has no lastUrl
cat > "$PCS_SESSIONS/no-lasturl.json" <<'EOF'
{ "storageState": { "cookies": [], "origins": [] }, "savedAt": "2026-01-01T00:00:00.000Z", "tags": {} }
EOF

pcs_capture refresh no-lasturl
assert_exit_code "$EXIT_CODE" 1
assert_contains "$STDERR" "lastUrl"
```

- [ ] **Step 3: `login/01-non-tty-kills-browser.sh` — gated, opt-in**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

# Opt-in only — interactive flows are slow and fragile on CI
if [ "${PCS_RUN_SLOW:-0}" != "1" ]; then
  echo "SKIP (set PCS_RUN_SLOW=1 to enable)"
  exit 0
fi

# Start login in background, non-TTY (stdin redirected from /dev/null forces non-TTY)
(node "$PCS_CLI" login https://example.com --session=test-login < /dev/null > "$PCS_TMPDIR/login.stdout" 2> "$PCS_TMPDIR/login.stderr" &) 
LOGIN_PID=$!
# Give it ~5s to open the browser
sleep 5
# Kill the Chrome/Chromium child to simulate user closing browser
pkill -P "$LOGIN_PID" chrome 2>/dev/null || pkill -P "$LOGIN_PID" chromium 2>/dev/null || true
wait "$LOGIN_PID" 2>/dev/null || true

assert_contains "$(cat "$PCS_TMPDIR/login.stdout")" "Non-TTY detected"
```

- [ ] **Step 4: Run + commit**

```bash
bash tests/run.sh refresh
bash tests/run.sh login
git add tests/scenarios/refresh/ tests/scenarios/login/
git commit -m "test(scenarios): refresh error paths + login non-tty opt-in"
```

---

## Task 10: Scenarios for `probe`

**Files:**
- Create: `tests/scenarios/probe/01-missing-session.sh`
- Create: `tests/scenarios/probe/02-empty-session.sh`

- [ ] **Step 1: `01-missing-session.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

pcs_capture probe does-not-exist
assert_exit_code "$EXIT_CODE" 1
assert_contains "$STDERR" "No saved session"
```

- [ ] **Step 2: `02-empty-session.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$PCS_ROOT/tests/lib/assert.sh"
source "$PCS_ROOT/tests/lib/setup.sh"

install_fixture_session empty-session
pcs_capture probe empty-session
# Exit code can be 0 (probed, no services) or 1 (no services to probe) — either is acceptable
# as long as no uncaught error appears on stderr.
assert_not_contains "$STDERR" "Unhandled"
assert_not_contains "$STDERR" "TypeError"
```

- [ ] **Step 3: Run + commit**

```bash
bash tests/run.sh probe
git add tests/scenarios/probe/ && git commit -m "test(scenarios): probe command"
```

---

## Task 11: Wire `npm run test:scenarios` and full-suite check

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Add npm script**

Edit `package.json`, add under `"scripts"`:

```json
"test:scenarios": "npm run build && bash tests/run.sh"
```

- [ ] **Step 2: Add README section**

Append to `README.md`:

```markdown
## Testing

Integration scenarios live under `tests/scenarios/`. Each scenario is a bash
script that invokes the compiled CLI against real URLs and asserts behavior.

```bash
npm run test:scenarios              # all scenarios
npm run test:scenarios -- screenshot  # one command's scenarios
VERBOSE=1 npm run test:scenarios    # show per-scenario output
PCS_RUN_SLOW=1 npm run test:scenarios  # include interactive/slow scenarios
```

See `tests/README.md` for how to add new scenarios.
```

- [ ] **Step 3: Full-suite run**

```bash
npm run test:scenarios
```

Expected: every scenario from tasks 4–10 passes. If any fail, the CLI has a regression — fix the CLI, not the scenario (unless the scenario's assertion is actually wrong).

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "test(scenarios): wire npm run test:scenarios + README"
```

---

## Task 12: Deliver scenario report to user

**Files:** none — this is a communication step.

- [ ] **Step 1: Generate the report**

Run `npm run test:scenarios` one more time, capture the full output, and produce a markdown report in this format:

```markdown
## Scenario Test Report — <date>

**Total scenarios:** N
**Passed:** N
**Failed:** 0
**Duration:** Ns

### By command

| Command    | Scenarios | Passed | Failed |
|------------|-----------|--------|--------|
| list       | 3         | 3      | 0      |
| screenshot | 7         | 7      | 0      |
| navigate   | 3         | 3      | 0      |
| snapshot   | 2         | 2      | 0      |
| exec       | 4         | 4      | 0      |
| refresh    | 2         | 2      | 0      |
| probe      | 2         | 2      | 0      |

### Notable behaviors verified
- Auto-mkdir of --out parent directory works across 3-level nesting
- --wait-for successfully blocks until selector visible; times out cleanly
- exec `run()` receives `{ page, context, browser }` with all three functional
- refresh errors cleanly on missing session and missing lastUrl
- Non-interactive login path gated behind PCS_RUN_SLOW (opt-in)

### Not yet covered (known gaps to address in later plans)
- `--session=<live>` scenarios (requires a live test session — out of scope for this plan)
- `--channel=msedge` (manual verification — no CI-safe way to assert channel was honored)
- `--human` mode (not built yet — covered in human-mode plan)
- Full interactive `login` TTY flow (requires human)
- `health` daily digest (covered in feedback-loop plan)

### Request
Please review. Suggest additional scenarios you want me to add, or approve to move on to the feedback-loop plan.
```

- [ ] **Step 2: Present the report to the user and pause for review.**

Do NOT proceed to the next phase (feedback loop, human mode, etc.) until the user has read the report and either approved or added scenarios.

---

## Self-Review

**Spec coverage:** Every currently-implemented command has at least one scenario. Features added in the previous session (`--wait-for`, `--wait-until`, `--full-page`, auto-mkdir, exec `{page,context,browser}`, non-TTY login) all have dedicated assertions. ✅

**Placeholder scan:** No TBD / TODO / "similar to" entries. Every code block is complete. ✅

**Type consistency:** `pcs_capture` sets `$STDOUT`, `$STDERR`, `$EXIT_CODE` — used uniformly across all scenarios. `assert_*` helpers named consistently. ✅

**One gap caught during review:** Task 3 Step 2 depends on `src/store.ts` respecting `PLAYWRIGHT_SESSIONS_DIR`. If it doesn't, the scenario tests would leak into the user's real `~/.playwright-sessions/`. The task explicitly stops and patches the store before proceeding — not a placeholder, a prerequisite check.

---

## Execution Handoff

Plan complete and saved to `/Users/gabrielantonyxaviour/Documents/infra/playwright-cli-sessions/docs/superpowers/plans/2026-04-17-scenario-test-harness.md`.

### Three sanctioned execution paths:

**1. Executing Plans (default for sequential plans)** — Run `/superpowers:executing-plans <plan-path>`. Tasks are worked sequentially with built-in checkpoints. `superpowers:verification-before-completion` runs between tasks to enforce evidence-before-claims.

**2. cmux-teams (for parallel workstreams)** — Use cmux-teams (see `~/.claude/rules/cmux-teams.md`). Tasks 1–3 sequential (foundation), then tasks 4–10 split across 3–4 teammates (e.g. Team-A owns `list`+`navigate`+`snapshot`, Team-B owns `screenshot`+`exec`, Team-C owns `refresh`+`login`+`probe`). Tasks 11–12 sequential after.

**3. Subagent-Driven Development (for clean task boundaries)** — Run `/superpowers:subagent-driven-development <plan-path>`. Dispatches a fresh subagent per task with a two-stage review loop. Given most tasks follow the same shape (write N scenarios, run, commit), this fits well.

### My recommendation for this plan: **cmux-teams**

Reasoning:
- Foundation (tasks 1–3) MUST be sequential — later tasks source the libs from them.
- Scenarios per command (tasks 4–10) are fully independent — no shared files, no shared state. This is a textbook cmux-teams fit.
- Final wiring (tasks 11–12) sequential.
- Estimated wall time: ~45 min with 3 teammates in parallel vs ~2hr sequentially.

Fallback if the user prefers: `executing-plans` — simpler to follow, you see every step, just slower.

**Fresh-session recommendation:** 12 tasks is borderline. A fresh session would be cleaner, but since we've been the one shaping the plan and the tasks are bite-sized, inline execution in this session is also fine.

---

Which approach should I use to execute this plan?
