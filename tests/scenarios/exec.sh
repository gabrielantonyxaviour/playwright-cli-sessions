#!/usr/bin/env bash
# tests/scenarios/exec.sh — exec command scenarios.
#
# Exercises `playwright-cli-sessions exec <script> [<url>] [flags]`. Each
# scenario writes a tiny .mjs file under the sandbox tmp dir, invokes PCS,
# and asserts on stdout / stderr / exit code. Real browsers are expensive —
# every run is wrapped in `timeout 60` as a safety net.
#
# Covers:
#   1. Script navigates itself + returns a string → printed as-is
#   2. Script receives { page, context, browser } with the expected API surface
#   3. Script returns a non-string (object) → CLI JSON-stringifies it
#   4. URL positional argument navigates before run() is called
#   5. --wait-for=h1 combined with URL positional succeeds
#   6. Script's run() throws → non-zero exit + error surfaced
#   7. Missing script path → usage error, no browser launched
#   8. Script without a run() export → specific error from exec.ts
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

URL="https://example.com"

# ── 1. Script navigates itself and returns the title ──────────────────
s1="$(pcs_tmp s1.mjs)"
cat > "$s1" <<'JS'
export async function run({ page, context, browser }) {
  await page.goto('https://example.com');
  return await page.title();
}
JS

rc=0
out1="$(timeout 60 node "$CLI_JS" exec "$s1" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "exec self-navigating script exits 0"
assert_contains "$out1" "Example" "output contains 'Example' (from page title)"

# ── 2. Script receives page, context, browser with expected API shape ─
s2="$(pcs_tmp s2.mjs)"
cat > "$s2" <<'JS'
export async function run({ page, context, browser }) {
  await page.goto('https://example.com');
  return JSON.stringify({
    hasPage: !!page,
    hasContext: !!context,
    hasBrowser: !!browser,
    contextHasPages: typeof context.pages === 'function',
    browserIsConnected: typeof browser.isConnected === 'function' && browser.isConnected(),
  });
}
JS

rc=0
out2="$(timeout 60 node "$CLI_JS" exec "$s2" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "exec param-probe script exits 0"

# The script's return value (a JSON string) is printed as-is. The stdout may
# contain stray warnings (e.g. Chromium headless noise) — extract the line
# that parses as JSON so assertions are robust.
json2="$(node -e "
  const lines = process.argv[1].split('\n');
  for (const line of lines) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try { JSON.parse(s); process.stdout.write(s); process.exit(0); } catch {}
  }
  process.exit(1);
" "$out2")" || {
  _assert_fail "could not find JSON object in exec output
      raw output:
$(printf '%s\n' "$out2" | sed 's/^/        /')"
}

assert_valid_json "$json2" "param-probe output is valid JSON"
assert_json_has "$json2" ".hasPage" "JSON has .hasPage"
assert_json_has "$json2" ".hasContext" "JSON has .hasContext"
assert_json_has "$json2" ".hasBrowser" "JSON has .hasBrowser"
assert_json_has "$json2" ".contextHasPages" "JSON has .contextHasPages"
assert_json_has "$json2" ".browserIsConnected" "JSON has .browserIsConnected"

# Verify each flag is truthy.
truthy_check="$(node -e "
  const d = JSON.parse(process.argv[1]);
  const keys = ['hasPage','hasContext','hasBrowser','contextHasPages','browserIsConnected'];
  for (const k of keys) {
    if (!d[k]) { process.stdout.write('FAIL:' + k); process.exit(0); }
  }
  process.stdout.write('OK');
" "$json2")"
assert_eq "OK" "$truthy_check" "all run() params are present and live"

# ── 3. Script returns a non-string object → CLI stringifies it ────────
s3="$(pcs_tmp s3.mjs)"
cat > "$s3" <<'JS'
export async function run({ page, context, browser }) {
  return { foo: 'bar', n: 42 };
}
JS

rc=0
out3="$(timeout 60 node "$CLI_JS" exec "$s3" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "exec object-returning script exits 0"

# The object return is JSON.stringify'd with 2-space indent across multiple
# lines. Extract the JSON object starting at the first '{' line.
json3="$(node -e "
  const out = process.argv[1];
  const start = out.indexOf('{');
  if (start < 0) process.exit(1);
  // Try to parse from each '{' onward until one works.
  for (let i = start; i < out.length; i++) {
    if (out[i] !== '{') continue;
    for (let j = out.length; j > i; j--) {
      if (out[j-1] !== '}') continue;
      try {
        const s = out.slice(i, j);
        JSON.parse(s);
        process.stdout.write(s);
        process.exit(0);
      } catch {}
    }
  }
  process.exit(1);
" "$out3")" || {
  _assert_fail "could not find JSON object in exec output
      raw output:
$(printf '%s\n' "$out3" | sed 's/^/        /')"
}

assert_valid_json "$json3" "object-return output is valid JSON"
assert_json_has "$json3" ".foo" "JSON has .foo"
assert_json_has "$json3" ".n"   "JSON has .n"

foo_val="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).foo)" "$json3")"
assert_eq "bar" "$foo_val" ".foo === 'bar'"

# ── 4. URL positional navigates before run() ──────────────────────────
s4="$(pcs_tmp s4.mjs)"
cat > "$s4" <<'JS'
export async function run({ page, context, browser }) {
  // Script does NOT call page.goto — rely on CLI to have navigated.
  return page.url();
}
JS

rc=0
out4="$(timeout 60 node "$CLI_JS" exec "$s4" "$URL" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "exec with URL positional exits 0"
assert_contains "$out4" "example.com" "page.url() reflects CLI-driven navigation"

# ── 5. --wait-for=h1 with URL positional ──────────────────────────────
rc=0
out5="$(timeout 60 node "$CLI_JS" exec "$s4" "$URL" --wait-for=h1 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "exec with URL + --wait-for=h1 exits 0"
assert_contains "$out5" "example.com" "--wait-for=h1 path still returns example.com URL"

# ── 6. Script throws → non-zero exit, error surfaced ──────────────────
s6="$(pcs_tmp s6.mjs)"
cat > "$s6" <<'JS'
export async function run({ page, context, browser }) {
  throw new Error('boom');
}
JS

rc=0
out6="$(timeout 60 node "$CLI_JS" exec "$s6" 2>&1)" || rc=$?
[[ $rc -ne 0 ]] || _assert_fail "exec script that throws should fail but exited 0
      output:
$(printf '%s\n' "$out6" | sed 's/^/        /')"
_assert_ok "exec throwing script exits non-zero (rc=$rc)"
assert_contains "$out6" "boom" "thrown error message surfaced"

# ── 7. Missing script path → usage error, no browser launched ─────────
rc=0
out7="$(node "$CLI_JS" exec 2>&1)" || rc=$?
[[ $rc -ne 0 ]] || _assert_fail "exec with no script path should fail but exited 0"
_assert_ok "exec with no script path exits non-zero (rc=$rc)"
assert_contains "$out7" "Error: exec requires a script path" "missing script path error message"

# ── 8. Script without a run() export ──────────────────────────────────
# exec.ts (lines 60-64) throws:
#   Error: Script must export a "run" function:
#     export async function run({ page, context, browser }) { ... }
# which the CLI's top-level catch prefixes with "Error: ".
s8="$(pcs_tmp s8.mjs)"
cat > "$s8" <<'JS'
export const x = 1;
JS

rc=0
out8="$(timeout 60 node "$CLI_JS" exec "$s8" 2>&1)" || rc=$?
[[ $rc -ne 0 ]] || _assert_fail "exec script without run() should fail but exited 0
      output:
$(printf '%s\n' "$out8" | sed 's/^/        /')"
_assert_ok "exec script without run() exits non-zero (rc=$rc)"
assert_contains "$out8" 'Script must export a "run" function' "missing run() error mirrors exec.ts message"
