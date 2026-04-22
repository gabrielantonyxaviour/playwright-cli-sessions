#!/usr/bin/env bash
# tests/scenarios/stealth.sh — stealth fingerprint patch scenarios (v0.5.x).
#
# Verifies that createStealthContext() correctly patches the browser fingerprint:
#   1. UA does not contain "HeadlessChrome" (default mode)
#   2. navigator.webdriver is false (rebrowser / CreepJS flag `undefined` as a tell;
#      v0.5.0 switched to explicit `false`)
#   3. navigator.connection.rtt is non-zero (spoofed)
#   4. devicePixelRatio matches platform (2 on macOS, 1 elsewhere)
#   5. Opt-out: PLAYWRIGHT_CLI_NO_STEALTH_PATCH=1 restores HeadlessChrome UA
#
# Uses a data: URL — fully hermetic, no external network calls.
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

# ── Shared probe script ───────────────────────────────────────────────────────
probe="$(pcs_tmp probe.mjs)"
cat > "$probe" <<'JS'
export async function run({ page }) {
  await page.goto('data:text/html,<html><body>stealth probe</body></html>');
  return await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    webdriver: navigator.webdriver,
    rtt: navigator.connection != null ? navigator.connection.rtt : null,
    dpr: window.devicePixelRatio,
  }));
}
JS

# Helper: extract the first valid JSON object from messy CLI output
extract_json() {
  node -e "
    const out = process.argv[1];
    const start = out.indexOf('{');
    if (start < 0) process.exit(1);
    for (let i = start; i < out.length; i++) {
      if (out[i] !== '{') continue;
      for (let j = out.length; j > i; j--) {
        if (out[j-1] !== '}') continue;
        try { JSON.parse(out.slice(i, j)); process.stdout.write(out.slice(i, j)); process.exit(0); } catch {}
      }
    }
    process.exit(1);
  " "$1"
}

# ── Run probe (default — stealth patch active) ────────────────────────────────
rc=0
out="$(timeout 60 node "$CLI_JS" exec "$probe" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "stealth probe exits 0"

json="$(extract_json "$out")" || {
  _assert_fail "could not extract JSON from exec output
      raw output:
$(printf '%s\n' "$out" | sed 's/^/        /')"
}
assert_valid_json "$json" "probe output is valid JSON"

# ── Case 1: UA must not contain HeadlessChrome ───────────────────────────────
ua="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).userAgent)" "$json")"
assert_not_contains "$ua" "HeadlessChrome" "UA does not contain HeadlessChrome"

# UA must match Chrome/<major>.<minor>.<patch>.<build> pattern
ua_ok="$(node -e "
  const ua = process.argv[1];
  process.stdout.write(/Chrome\/\d+\.\d+\.\d+\.\d+/.test(ua) ? 'OK' : 'FAIL:' + ua);
" "$ua")"
assert_eq "OK" "$ua_ok" "UA matches Chrome/<ver> pattern"

# ── Case 2: navigator.webdriver is false (not undefined — rebrowser/CreepJS) ──
wd="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).webdriver))" "$json")"
assert_eq "false" "$wd" "navigator.webdriver is false"

# ── Case 3: navigator.connection.rtt is non-zero ─────────────────────────────
rtt_status="$(node -e "
  const rtt = JSON.parse(process.argv[1]).rtt;
  if (rtt === null || rtt === undefined) process.stdout.write('NULL');
  else if (rtt > 0) process.stdout.write('NONZERO:' + rtt);
  else process.stdout.write('ZERO');
" "$json")"
[[ "$rtt_status" == NONZERO:* ]] || _assert_fail "navigator.connection.rtt should be spoofed non-zero, got: $rtt_status"
_assert_ok "navigator.connection.rtt is non-zero (spoofed: $rtt_status)"

# ── Case 4: devicePixelRatio matches platform ─────────────────────────────────
dpr="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).dpr))" "$json")"
if [[ "$(uname -s)" == "Darwin" ]]; then
  assert_eq "2" "$dpr" "devicePixelRatio is 2 on macOS"
else
  assert_eq "1" "$dpr" "devicePixelRatio is 1 on non-macOS"
fi

# ── Case 5: opt-out restores HeadlessChrome UA ───────────────────────────────
rc2=0
out2="$(PLAYWRIGHT_CLI_NO_STEALTH_PATCH=1 timeout 60 node "$CLI_JS" exec "$probe" 2>&1)" || rc2=$?
assert_exit_code 0 "$rc2" "stealth probe with opt-out exits 0"

json2="$(extract_json "$out2")" || {
  _assert_fail "could not extract JSON from opt-out exec output
      raw output:
$(printf '%s\n' "$out2" | sed 's/^/        /')"
}
ua2="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).userAgent)" "$json2")"
assert_contains "$ua2" "HeadlessChrome" "opt-out: UA contains HeadlessChrome"
