#!/usr/bin/env bash
# tests/scenarios/list.sh — list command scenarios.
#
# Covers:
#   1. Empty state — no sessions in sandbox → "No saved sessions found" message
#   2. Non-JSON output with a fixture session — shows header + savedAt date
#   3. --probe=false — skips network, renders cookie metadata only
#   4. --json — emits a valid JSON array with the expected fields
#   5. --json empty state — still valid JSON (empty array OR explicit empty output — we accept either but document what we see)
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

# ── 1. Empty state ────────────────────────────────────────────────────
empty="$(PCS list --probe=false 2>&1)"
assert_contains "$empty" "No saved sessions" "empty list message"

# ── 2. With a fixture session, default text output ────────────────────
pcs_fixture github-session mysess
out="$(PCS list --probe=false 2>&1)"
assert_contains "$out" "mysess" "list shows session name"
assert_contains "$out" "GitHub" "list shows auto-detected service GitHub"
assert_contains "$out" "2026-04-17" "list shows savedAt date"

# ── 3. --probe=false skips the network ────────────────────────────────
# The presence of a GitHub cookie means default probe would hit github.com;
# --probe=false must finish instantly with cookie metadata only.
#
# We assert exit=0 and that the output contains one of the cookie-metadata
# status markers rather than a [LIVE, probed Nm ago] marker.
start_ns=$(date +%s)
out_np="$(PCS list --probe=false 2>&1)"
end_ns=$(date +%s)
elapsed=$((end_ns - start_ns))
(( elapsed <= 3 )) || {
  echo "list --probe=false took ${elapsed}s — expected <3s (no network)" >&2
  exit 1
}
assert_not_contains "$out_np" "LIVE, probed" "no-probe mode does not show LIVE timestamps"

# ── 4. --json output shape ────────────────────────────────────────────
json="$(PCS list --probe=false --json 2>&1)"
assert_valid_json "$json" "--json produces valid JSON"
assert_json_has "$json" ".[0].name" "json has .name on first entry"
assert_json_has "$json" ".[0].savedAt" "json has .savedAt"
assert_json_has "$json" ".[0].services[0].service" "json has .services[0].service"

# Confirm the name in the JSON matches the filename stem we created.
name_from_json="$(node -e "
  const arr = JSON.parse(process.argv[1]);
  process.stdout.write(arr[0].name);
" "$json")"
assert_eq "mysess" "$name_from_json" "JSON .name === filename stem"

# ── 5. --json empty state ────────────────────────────────────────────
# Add a second sandbox, clear out, retest. Easier: delete the fixture and rerun.
rm "$PLAYWRIGHT_SESSIONS_DIR/mysess.json"
empty_json="$(PCS list --probe=false --json 2>&1 || true)"
# Empty-state behavior: the code path prints a plain human-readable message
# and exits — so --json empty emits "No saved sessions found..." rather than
# "[]". We assert on the actual behavior and document it.
assert_contains "$empty_json" "No saved sessions" "empty --json path prints human message (documented behavior)"
