#!/usr/bin/env bash
# tests/scenarios/default-channel.sh — chrome is the default channel (v0.4.0).
#
# Verifies that omitting --channel still uses real Chrome (stealth UA — no
# HeadlessChrome token). Also verifies that --channel=chromium explicitly
# opts out to the bundled Chromium (HeadlessChrome UA present).
#
# Uses a data: URL — fully hermetic, no external network calls.
#
# Covers:
#   1. No --channel flag → UA does NOT contain HeadlessChrome (real Chrome default)
#   2. --channel=chromium → UA DOES contain HeadlessChrome (bundled opt-out)
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

# Shared probe script: navigate to a data: URL and return the userAgent.
probe="$(pcs_tmp probe-default-channel.mjs)"
cat > "$probe" <<'JS'
export async function run({ page }) {
  await page.goto('data:text/html,<html><body>channel probe</body></html>');
  return await page.evaluate(() => navigator.userAgent);
}
JS

# Helper: extract UA string from exec output (skips Chromium noise lines)
extract_ua() {
  node -e "
    const lines = process.argv[1].split('\n');
    for (const line of lines) {
      const s = line.trim();
      if (s.includes('Mozilla/5.0')) { process.stdout.write(s); process.exit(0); }
    }
    process.exit(1);
  " "$1"
}

# ── 1. No --channel → real Chrome UA (no HeadlessChrome) ─────────────────────
rc=0
out1="$(timeout 60 node "$CLI_JS" exec "$probe" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "exec without --channel exits 0"
ua1="$(extract_ua "$out1")" || {
  _assert_fail "could not extract UA from default-channel output
      raw output:
$(printf '%s\n' "$out1" | sed 's/^/        /')"
}
assert_not_contains "$ua1" "HeadlessChrome" "no --channel: UA does not contain HeadlessChrome"
# UA must look like a real Chrome UA
ua1_ok="$(node -e "
  const ua = process.argv[1];
  process.stdout.write(/Chrome\/\d+\.\d+\.\d+\.\d+/.test(ua) && !ua.includes('HeadlessChrome') ? 'OK' : 'FAIL:' + ua);
" "$ua1")"
assert_eq "OK" "$ua1_ok" "no --channel: UA matches Chrome/<ver> pattern without Headless"

# ── 2. --channel=chromium → bundled Chromium (HeadlessChrome present) ────────
rc=0
out2="$(timeout 60 node "$CLI_JS" exec "$probe" --channel=chromium 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "exec --channel=chromium exits 0"
ua2="$(extract_ua "$out2")" || {
  _assert_fail "could not extract UA from chromium-channel output
      raw output:
$(printf '%s\n' "$out2" | sed 's/^/        /')"
}
assert_contains "$ua2" "HeadlessChrome" "--channel=chromium: UA contains HeadlessChrome"
