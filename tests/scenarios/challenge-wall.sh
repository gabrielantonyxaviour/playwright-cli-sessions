#!/usr/bin/env bash
# tests/scenarios/challenge-wall.sh — challenge-wall hand-off (v0.5.2).
#
# Verifies that navigation to a page containing a Cloudflare / hCaptcha /
# reCAPTCHA challenge selector exits 78 (PCS_CHALLENGE_WALL) rather than 77
# (PCS_AUTH_WALL). A challenge wall is non-scriptable — the user must complete
# it interactively, so the CLI surfaces a distinct exit code.
#
# The fixture is a local HTML file served via file:// — it contains an iframe
# whose src matches the Cloudflare challenge-selector pattern.
#
# Covers:
#   1. navigate to page with CF challenge iframe → exit 78, CHALLENGE_WALL line,
#      PCS_CHALLENGE_WALL code
#   2. navigate to page with CHALLENGE_BODY_RE text → exit 78 (body heuristic)
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

# ── Fixture 1: page with a Cloudflare challenge iframe selector ──────────────
cf_html="$(pcs_tmp cf-challenge.html)"
cat >"$cf_html" <<'HTML'
<!doctype html>
<html><head><title>just a moment</title></head>
<body>
  <h1>Checking your browser</h1>
  <iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/a/0/0000" width="300" height="65"></iframe>
</body></html>
HTML

rc=0
out1="$(timeout 90 node "$CLI_JS" navigate "file://${cf_html}" 2>&1)" || rc=$?
assert_exit_code 78 "$rc" "CF-challenge page exits 78 (PCS_CHALLENGE_WALL)"
assert_contains "$out1" "CHALLENGE_WALL" "stderr contains CHALLENGE_WALL prefix line"
assert_contains "$out1" "Error [PCS_CHALLENGE_WALL]" "stderr contains PCS_CHALLENGE_WALL error code"
assert_contains "$out1" "suggest=" "CHALLENGE_WALL line includes suggest= field"

# ── Fixture 2: body-text heuristic (CHALLENGE_BODY_RE) ──────────────────────
body_html="$(pcs_tmp body-challenge.html)"
cat >"$body_html" <<'HTML'
<!doctype html>
<html><head><title>please wait</title></head>
<body>
  <p>Please complete the security check to continue.</p>
</body></html>
HTML

rc=0
out2="$(timeout 90 node "$CLI_JS" navigate "file://${body_html}" 2>&1)" || rc=$?
assert_exit_code 78 "$rc" "challenge body-text page exits 78"
assert_contains "$out2" "CHALLENGE_WALL" "body-heuristic stderr contains CHALLENGE_WALL"
assert_contains "$out2" "Error [PCS_CHALLENGE_WALL]" "body-heuristic stderr contains PCS_CHALLENGE_WALL"
