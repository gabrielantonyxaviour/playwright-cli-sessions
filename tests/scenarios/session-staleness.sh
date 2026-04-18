#!/usr/bin/env bash
# tests/scenarios/session-staleness.sh — session freshness / staleness-probe scenarios.
#
# Covers the checkSessionFreshness() guard added in v0.4.1:
#   1. Fresh session (cache <6h old)  → no extra probe; command proceeds.
#   2. Stale session (cache >6h old)  → probe fires; LIVE → command proceeds.
#   3. Stale + DEAD                   → probe fires; DEAD → exit 77 + refresh hint.
#   4. --no-probe flag                → skip probe entirely; command proceeds.
#   5. PLAYWRIGHT_CLI_NO_STALE_CHECK=1 → same as (4) but via env var.
#   6. PLAYWRIGHT_CLI_STALE_HOURS=0   → forces probe even with a just-refreshed cache.
#
# Network notes:
#   Cases 2, 4, 5, 6: launch a real browser against https://example.com — wrapped in timeout 60.
#   Case 1: also launches a browser (needs freshness check to skip) — wrapped in timeout 60.
#   Case 3: probe fires and fails BEFORE browser launch → fast, no timeout guard needed.
#
# Case 3 uses the github-session fixture which has a fake GitHub cookie. The
# GitHub probe (https://github.com/settings/profile) returns 302 for invalid
# cookies, which our dead-filter classifies as DEAD → exit 77.
# If GitHub is unreachable the probe returns "error"/"timeout" — still DEAD,
# still exit 77. The test is network-tolerant for the DEAD direction.

set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

URL="https://example.com"

# ── Helper: write .probe-cache.json with a given session entry ──────────────
# Usage: write_probe_cache <session-name> <age-hours>
# Creates a cache entry whose probedAt is <age-hours> hours ago.
write_probe_cache() {
  local sess="$1"
  local age_hours="$2"
  node -e '
    const fs = require("fs");
    const [,path, name, ageHours] = process.argv;
    const cache = {};
    cache[name] = { probedAt: Date.now() - parseFloat(ageHours) * 3600 * 1000, services: {} };
    fs.writeFileSync(path, JSON.stringify(cache, null, 2));
  ' "$PLAYWRIGHT_SESSIONS_DIR/.probe-cache.json" "$sess" "$age_hours"
}

# Read probedAt for a session from .probe-cache.json
read_probe_at() {
  local sess="$1"
  node -e '
    const fs = require("fs");
    const [,path, name] = process.argv;
    const cache = JSON.parse(fs.readFileSync(path, "utf-8"));
    process.stdout.write(String(cache[name]?.probedAt ?? "missing"));
  ' "$PLAYWRIGHT_SESSIONS_DIR/.probe-cache.json" "$sess"
}

# ── Case 1: Fresh session — no probe fires ───────────────────────────────────
# Set up an empty session + a probe-cache entry that is 1h old (< 6h threshold).
# The screenshot command should proceed without any "probed just now" output.
pcs_fixture empty-session fresh-sess
write_probe_cache "fresh-sess" "1"

f1="$(pcs_tmp case1.png)"
rc=0
out1="$(timeout 60 node "$CLI_JS" screenshot "$URL" --session=fresh-sess --out="$f1" 2>&1)" || rc=$?
assert_exit_code "0" "$rc" "case1: fresh session exits 0"
assert_file_exists "$f1" "case1: screenshot file written"
assert_not_contains "$out1" "probed just now" "case1: no staleness probe output"
assert_not_contains "$out1" "probe failed" "case1: no probe-failed message"

# ── Case 2: Stale session — probe fires, session is LIVE → proceeds ──────────
# Empty session has no probeable services; probe returns no dead results → LIVE.
# Cache entry is 8h old (> 6h threshold).
pcs_fixture empty-session stale-live-sess
write_probe_cache "stale-live-sess" "8"

f2="$(pcs_tmp case2.png)"
rc=0
out2="$(timeout 60 node "$CLI_JS" screenshot "$URL" --session=stale-live-sess --out="$f2" 2>&1)" || rc=$?
assert_exit_code "0" "$rc" "case2: stale-live session exits 0"
assert_file_exists "$f2" "case2: screenshot file written"
assert_contains "$out2" "probed just now" "case2: staleness probe fires and reports live"

# ── Case 3: Stale + DEAD — probe fires, session is DEAD → exit 77 ────────────
# github-session fixture has a fake GitHub cookie. The GitHub probe returns 302
# (not logged in), which qualifies as DEAD. Exit code must be 77.
# Note: if GitHub is unreachable, probe returns "error"/"timeout" — still DEAD.
pcs_fixture github-session stale-dead-sess
write_probe_cache "stale-dead-sess" "8"

rc=0
out3="$(timeout 30 node "$CLI_JS" screenshot "$URL" --session=stale-dead-sess --out="$(pcs_tmp case3.png)" 2>&1)" || rc=$?
assert_exit_code "77" "$rc" "case3: stale dead session exits 77"
assert_contains "$out3" "probe failed" "case3: error message says 'probe failed'"
assert_contains "$out3" "refresh stale-dead-sess" "case3: error suggests refresh <name>"
# Browser must NOT have launched (probe fails before browser launch)
assert_not_contains "$out3" "Screenshot saved" "case3: browser was not launched"

# ── Case 4: --no-probe flag — stale session, probe bypassed → proceeds ────────
# Use github-session (would exit 77 without --no-probe). With --no-probe,
# the browser launches and visits example.com (no GitHub auth needed).
pcs_fixture github-session no-probe-flag-sess
write_probe_cache "no-probe-flag-sess" "8"

f4="$(pcs_tmp case4.png)"
rc=0
out4="$(timeout 60 node "$CLI_JS" screenshot "$URL" --session=no-probe-flag-sess --no-probe --out="$f4" 2>&1)" || rc=$?
assert_exit_code "0" "$rc" "case4: --no-probe skips probe, exits 0"
assert_file_exists "$f4" "case4: screenshot file written"
assert_not_contains "$out4" "probed just now" "case4: no probe output with --no-probe"
assert_not_contains "$out4" "probe failed" "case4: no probe-failed with --no-probe"

# ── Case 5: PLAYWRIGHT_CLI_NO_STALE_CHECK=1 — same bypass via env var ─────────
pcs_fixture github-session no-stale-check-sess
write_probe_cache "no-stale-check-sess" "8"

f5="$(pcs_tmp case5.png)"
rc=0
out5="$(timeout 60 env PLAYWRIGHT_CLI_NO_STALE_CHECK=1 node "$CLI_JS" screenshot "$URL" --session=no-stale-check-sess --out="$f5" 2>&1)" || rc=$?
assert_exit_code "0" "$rc" "case5: PLAYWRIGHT_CLI_NO_STALE_CHECK=1 skips check, exits 0"
assert_file_exists "$f5" "case5: screenshot file written"
assert_not_contains "$out5" "probed just now" "case5: no probe output with NO_STALE_CHECK"
assert_not_contains "$out5" "probe failed" "case5: no probe-failed with NO_STALE_CHECK"

# ── Case 6: PLAYWRIGHT_CLI_STALE_HOURS=0 — forces probe even with fresh cache ─
# Write a brand-new probe cache entry (0 hours old).
# STALE_HOURS=0 means ANY age is stale → probe must fire.
# The empty session has no dead services → "probed just now" must appear.
pcs_fixture empty-session zero-hours-sess
write_probe_cache "zero-hours-sess" "0"

f6="$(pcs_tmp case6.png)"
rc=0
out6="$(timeout 60 env PLAYWRIGHT_CLI_STALE_HOURS=0 node "$CLI_JS" screenshot "$URL" --session=zero-hours-sess --out="$f6" 2>&1)" || rc=$?
assert_exit_code "0" "$rc" "case6: STALE_HOURS=0 forces probe, exits 0"
assert_file_exists "$f6" "case6: screenshot file written"
assert_contains "$out6" "probed just now" "case6: STALE_HOURS=0 forced probe fires"
