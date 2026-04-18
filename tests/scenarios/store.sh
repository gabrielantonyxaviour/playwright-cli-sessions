#!/usr/bin/env bash
# tests/scenarios/store.sh — store-manipulation command scenarios.
#
# Covers the commands that read/write ~/.playwright-sessions/ without
# launching a browser:
#   clone, tag, delete, probe, save, restore (--out path only)
#
# Restore's browser-launch path is explicitly NOT tested here (would open
# a visible browser and hang). Save's happy path is also out of scope —
# it requires a live playwright-cli session, which the scenario harness
# does not (and should not) stand up.
#
# History: `writeSaved` originally keyed off `session.name` while
# `readSaved(name)` keyed off the caller-supplied name — so a file on disk
# whose internal `.name` disagreed with its filename stem (e.g. after a
# manual `mv`) would silently get tagged into a DIFFERENT file. Fixed in
# 0.2.6: `writeSaved(name, session)` now takes the filename explicitly and
# normalizes `session.name` to match.
# The `mk_session` helper is kept for convenience — it mints a session
# where the internal .name already matches, which keeps most cases simple.
# Case 8b below is the regression guard that keeps the fix honest.
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

# Create a minimal saved-session file where internal .name matches the
# filename stem. Usage: mk_session <name>
mk_session() {
  local name="$1"
  local path="$PLAYWRIGHT_SESSIONS_DIR/${name}.json"
  node -e '
    const fs = require("fs");
    const [, path, name] = process.argv;
    fs.writeFileSync(path, JSON.stringify({
      name,
      storageState: { cookies: [], origins: [] },
      lastUrl: "https://example.com/",
      savedAt: "2026-04-17T00:00:00.000Z",
      savedBy: "fixture",
    }, null, 2));
  ' "$path" "$name"
}

# Helper: parse a JSON file and print a single dotted-path value via node.
# Usage: json_get <file> <expr>  (expr is raw JS against `data`)
json_get() {
  node -e '
    const fs = require("fs");
    const [, path, expr] = process.argv;
    const data = JSON.parse(fs.readFileSync(path, "utf-8"));
    const out = new Function("data", `return (${expr});`)(data);
    process.stdout.write(out === undefined ? "__undefined__" : String(out));
  ' "$1" "$2"
}

# ── clone ─────────────────────────────────────────────────────────────

# 1. Clone a fixture session — new file appears, exit 0.
pcs_fixture github-session src
PCS clone src dst >/dev/null
assert_file_exists "$PLAYWRIGHT_SESSIONS_DIR/dst.json" "clone wrote dst.json"

# 2. Cloned file has cloneOf set to the source name.
assert_eq "src" "$(json_get "$PLAYWRIGHT_SESSIONS_DIR/dst.json" 'data.cloneOf')" \
  "clone sets .cloneOf to source name"

# 3. Cloned file preserves storageState — cookie count matches source.
src_cookies="$(json_get "$PLAYWRIGHT_SESSIONS_DIR/src.json" 'data.storageState.cookies.length')"
dst_cookies="$(json_get "$PLAYWRIGHT_SESSIONS_DIR/dst.json" 'data.storageState.cookies.length')"
assert_eq "$src_cookies" "$dst_cookies" "clone preserves cookie count"
assert_eq "1" "$dst_cookies" "clone preserves github-session's single cookie"

# Also check that the first cookie's name survived verbatim.
assert_eq "user_session" \
  "$(json_get "$PLAYWRIGHT_SESSIONS_DIR/dst.json" 'data.storageState.cookies[0].name')" \
  "clone preserves cookie contents"

# 4. Clone missing source errors with a clear message.
rc=0
clone_err="$(PCS clone no-such-source new-name 2>&1)" || rc=$?
assert_exit_code "3" "$rc" "clone missing source exits non-zero"
assert_contains "$clone_err" "No saved session" "clone missing source error message"
[[ ! -f "$PLAYWRIGHT_SESSIONS_DIR/new-name.json" ]] || {
  echo "clone of missing source still wrote new-name.json" >&2
  exit 1
}

# ── tag ───────────────────────────────────────────────────────────────

# 5. Tag adds an auth entry when none exists.
mk_session s1
PCS tag s1 CustomService alice >/dev/null
assert_file_exists "$PLAYWRIGHT_SESSIONS_DIR/s1.json" "tag preserves session file"
assert_eq "CustomService" \
  "$(json_get "$PLAYWRIGHT_SESSIONS_DIR/s1.json" 'data.auth[0].service')" \
  "tag writes auth[0].service"
assert_eq "alice" \
  "$(json_get "$PLAYWRIGHT_SESSIONS_DIR/s1.json" 'data.auth[0].identity')" \
  "tag writes auth[0].identity"
assert_eq "true" \
  "$(json_get "$PLAYWRIGHT_SESSIONS_DIR/s1.json" 'data.auth[0].manual')" \
  "tag marks auth[0].manual=true"

# 6. Tag without identity still creates entry; identity is missing/undefined.
PCS tag s1 AnotherService >/dev/null
# Find the AnotherService entry (order isn't contractual — search for it).
assert_eq "AnotherService" \
  "$(json_get "$PLAYWRIGHT_SESSIONS_DIR/s1.json" 'data.auth.find(a => a.service === "AnotherService").service')" \
  "tag without identity adds AnotherService"
assert_eq "true" \
  "$(json_get "$PLAYWRIGHT_SESSIONS_DIR/s1.json" 'data.auth.find(a => a.service === "AnotherService").manual')" \
  "tag without identity marks manual=true"
assert_eq "__undefined__" \
  "$(json_get "$PLAYWRIGHT_SESSIONS_DIR/s1.json" 'data.auth.find(a => a.service === "AnotherService").identity')" \
  "tag without identity omits .identity"

# 7. Tag updates existing service (no duplicate entry, identity replaced).
PCS tag s1 CustomService bob >/dev/null
cs_count="$(json_get "$PLAYWRIGHT_SESSIONS_DIR/s1.json" 'data.auth.filter(a => a.service === "CustomService").length')"
assert_eq "1" "$cs_count" "tag updates existing service in place (no duplicate)"
assert_eq "bob" \
  "$(json_get "$PLAYWRIGHT_SESSIONS_DIR/s1.json" 'data.auth.find(a => a.service === "CustomService").identity')" \
  "tag updates identity to bob"
assert_eq "true" \
  "$(json_get "$PLAYWRIGHT_SESSIONS_DIR/s1.json" 'data.auth.find(a => a.service === "CustomService").manual')" \
  "tag re-marks manual=true on update"

# 8. Tag with only a name (missing service) errors.
rc=0
tag_err="$(PCS tag only-name-no-service 2>&1)" || rc=$?
assert_exit_code "2" "$rc" "tag missing service exits non-zero"
assert_contains "$tag_err" "tag requires" "tag missing service error message"

# 8b. Regression: tag writes back to the FILENAME even if the embedded
# `.name` field disagrees (e.g. after a manual rename on disk). Before the
# writeSaved(name, session) fix, tag would silently write to a DIFFERENT
# file matching session.name, leaving the target file unchanged.
pcs_fixture empty-session mismatched
# pcs_fixture copies the fixture bytes, so mismatched.json has
# embedded .name === "empty-session" but the filename stem is "mismatched".
embedded_before="$(json_get "$PLAYWRIGHT_SESSIONS_DIR/mismatched.json" 'data.name')"
assert_eq "empty-session" "$embedded_before" "precondition: embedded name differs from filename"

PCS tag mismatched RegressionCheck alice2 >/dev/null
# The tag must land in mismatched.json — not in empty-session.json.
assert_file_exists "$PLAYWRIGHT_SESSIONS_DIR/mismatched.json" "tag preserves target file"
assert_eq "RegressionCheck" \
  "$(json_get "$PLAYWRIGHT_SESSIONS_DIR/mismatched.json" 'data.auth[0].service')" \
  "tag wrote to the filename-keyed file, not the embedded-name file"
# And the embedded `.name` should now be normalized to match the filename.
assert_eq "mismatched" \
  "$(json_get "$PLAYWRIGHT_SESSIONS_DIR/mismatched.json" 'data.name')" \
  "writeSaved normalized .name to match the filename"
# The "empty-session" file must NOT exist — the fixture was copied AS
# mismatched, not under its original name.
[[ ! -f "$PLAYWRIGHT_SESSIONS_DIR/empty-session.json" ]] || {
  echo "regression: tag leaked a write into empty-session.json" >&2
  exit 1
}
_assert_ok "tag did not leak a stray empty-session.json"

# ── delete ────────────────────────────────────────────────────────────

# 9. Delete an existing session removes the file.
pcs_fixture empty-session victim
assert_file_exists "$PLAYWRIGHT_SESSIONS_DIR/victim.json" "delete precondition: victim exists"
PCS delete victim >/dev/null
[[ ! -f "$PLAYWRIGHT_SESSIONS_DIR/victim.json" ]] || {
  echo "delete did not remove victim.json" >&2
  exit 1
}

# 10. Delete a missing session errors with a clear message.
rc=0
del_err="$(PCS delete ghost 2>&1)" || rc=$?
assert_exit_code "3" "$rc" "delete missing session exits non-zero"
assert_contains "$del_err" "No saved session" "delete missing error message"

# ── probe ─────────────────────────────────────────────────────────────

# 11. Probe with no positional arg errors.
rc=0
probe_err="$(PCS probe 2>&1)" || rc=$?
assert_exit_code "2" "$rc" "probe missing name exits non-zero"
assert_contains "$probe_err" "probe requires a session name" "probe missing-name error"

# 12. Probe of a nonexistent session errors.
rc=0
probe_err2="$(PCS probe ghost 2>&1)" || rc=$?
assert_exit_code "3" "$rc" "probe nonexistent session exits non-zero"
assert_contains "$probe_err2" "No saved session" "probe nonexistent error"

# 13. Probe on a session with no detected services exits 0 and announces so —
#     this is the short-circuit path (no network I/O). Confirmed behavior:
#     the command prints 'No services detected in session "<name>".' and returns.
mk_session empty-s
probe_out="$(PCS probe empty-s 2>&1)"
assert_contains "$probe_out" "No services detected" "probe on no-services session short-circuits"

# ── restore ───────────────────────────────────────────────────────────
# We only exercise the `--out` path — the browser-launch path would hang the
# scenario.

# 14. Restore --out writes a valid storageState JSON to the given file.
pcs_fixture empty-session r1
out_path="$(pcs_tmp restore-out.json)"
PCS restore r1 --out="$out_path" >/dev/null
assert_file_exists "$out_path" "restore --out wrote file"
assert_valid_json "$out_path" "restore --out produced valid JSON"
assert_json_has "$out_path" ".cookies" "restore --out has .cookies"
assert_json_has "$out_path" ".origins" "restore --out has .origins"

# 15. Restore on a missing session errors.
rc=0
rest_err="$(PCS restore ghost 2>&1)" || rc=$?
assert_exit_code "3" "$rc" "restore missing session exits non-zero"
assert_contains "$rest_err" "No saved session" "restore missing error message"

# ── save ──────────────────────────────────────────────────────────────
# We do NOT spin up a real playwright-cli session. save's happy path is
# explicitly out of scope. We only assert that save gracefully errors when
# there is no live playwright-cli session to read from.

# 16. Save errors when playwright-cli has no open session named <name>.
#
# Two possible failure modes:
#   (a) `playwright-cli` is installed but no session is open → playwright-cli
#       prints "not open" and exits non-zero; our wrapper rethrows as
#       "Command failed".
#   (b) `playwright-cli` is not installed at all → execFileSync ENOENT,
#       also rethrown as an Error.
# In either case, save must exit non-zero with an "Error:" prefix.
rc=0
save_err="$(PCS save whatever 2>&1)" || rc=$?
assert_exit_code "1" "$rc" "save without live playwright-cli exits non-zero"
assert_contains "$save_err" "Error" "save failure surfaces an Error message"
[[ ! -f "$PLAYWRIGHT_SESSIONS_DIR/whatever.json" ]] || {
  echo "failed save still wrote whatever.json" >&2
  exit 1
}
