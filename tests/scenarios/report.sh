#!/usr/bin/env bash
# tests/scenarios/report.sh — feedback-loop (report + reports + usage log) scenarios.
#
# Exercises the feedback-loop primitives introduced alongside browser
# automation: structured issue reports and the append-only usage log.
# No browser launches needed — every case is purely filesystem + CLI routing.
#
# Covers:
#   1. `reports` with no reports filed → clean empty-state message
#   2. `reports --json` empty-state → valid JSON (empty array)
#   3. `report "<msg>"` → writes markdown under .reports/ and stamps .usage-log.jsonl
#   4. Report file contents — title, message, CWD, Environment, recent-invocations table
#   5. Reports list (human) — newest-first, shows title + path
#   6. Reports list (JSON) — valid JSON, fields (path, fileName, filedAt, title)
#   7. `report` with no message → usageError exit 1, stays out of .reports/
#   8. `--context=N` honored — recent-invocations table is capped at N rows
#   9. `reports --limit=N` → caps output to N entries
#  10. Usage log JSONL shape — one line per invocation, parseable, carries cmd/args/exitCode
#  11. Arg value with spaces survives round-trip through the log (no split)
#  12. invokedBy="user" stamped in log + report when CLAUDECODE is unset
#  13. invokedBy="claude-code" stamped when CLAUDECODE=1, [CC] marker in listing
#  14. --no-notify flag is accepted and does not crash the report
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

# The harness itself may be invoked by a Claude Code session, which leaks
# CLAUDECODE=1 into every child PCS invocation and would fire a macOS
# notification on every `report` case. Suppress that here — we test the
# detection logic explicitly below by toggling CLAUDECODE per invocation.
export PLAYWRIGHT_CLI_SESSIONS_NO_NOTIFY=1

REPORTS_DIR="$PLAYWRIGHT_SESSIONS_DIR/.reports"
LOG_FILE="$PLAYWRIGHT_SESSIONS_DIR/.usage-log.jsonl"

# ── 1. Empty-state: `reports` (human) ─────────────────────────────────
out_empty="$(PCS reports 2>&1)"
assert_contains "$out_empty" "No reports filed" "empty reports shows guidance"

# ── 2. Empty-state: `reports --json` ──────────────────────────────────
# Before any report exists the .reports/ dir doesn't exist either — the
# code path prints "[]" via console.log.
empty_json="$(PCS reports --json 2>&1)"
assert_valid_json "$empty_json" "empty --json reports is valid JSON"
assert_eq "[]" "$empty_json" "empty --json reports is an empty array"

# ── 3. File a first report ────────────────────────────────────────────
msg="screenshot of https://example.com returned blank — expected Example Domain heading"
out_r="$(PCS report "$msg" 2>&1)"
assert_contains "$out_r" "Report saved to" "report prints save confirmation"
assert_contains "$out_r" ".reports/" "report path is under a .reports/ directory"

# The .reports/ dir should now exist with exactly one .md file.
[[ -d "$REPORTS_DIR" ]] || { echo ".reports dir not created: $REPORTS_DIR" >&2; exit 1; }
shopt -s nullglob
md_files=( "$REPORTS_DIR"/*.md )
shopt -u nullglob
(( ${#md_files[@]} == 1 )) || {
  echo "expected 1 report file, got ${#md_files[@]}" >&2
  exit 1
}
report_path="${md_files[0]}"
assert_file_exists "$report_path" "report markdown file exists"
assert_file_min_size "$report_path" 100 "report markdown has real content"

# ── 4. Report file shape ──────────────────────────────────────────────
body="$(cat "$report_path")"
assert_contains "$body" "# Report:" "report starts with # Report: heading"
assert_contains "$body" "$msg" "report embeds the original message"
assert_contains "$body" "**Filed:**" "report has Filed: timestamp"
assert_contains "$body" "**CWD:**" "report has CWD"
assert_contains "$body" "## Message" "report has Message section"
assert_contains "$body" "## Environment" "report has Environment block"
assert_contains "$body" "- node:" "report lists node version"
assert_contains "$body" "- platform:" "report lists platform"

# The recent-invocations table is present because we already ran `reports`
# (and `reports --json`) above, so there's usage-log history to embed.
assert_contains "$body" "## Recent CLI invocations" "report has recent-invocations section"
assert_contains "$body" "| time | cmd | exit | duration | error |" "report includes invocations table header"

# ── 5. `reports` lists the new report (human) ─────────────────────────
out_list="$(PCS reports 2>&1)"
assert_contains "$out_list" "Recent reports (1 of 1)" "reports list shows count line"
# Title is truncated (sluggable prefix); just assert something recognizable survives.
assert_contains "$out_list" "screenshot of" "reports list shows the title"
# $report_path may contain double slashes from $TMPDIR while the printed path
# is normalized — compare the basename, which is stable either way.
report_basename="$(basename "$report_path")"
assert_contains "$out_list" "$report_basename" "reports list references the report file by name"

# ── 6. `reports --json` shape ─────────────────────────────────────────
json_list="$(PCS reports --json 2>&1)"
assert_valid_json "$json_list" "reports --json is valid JSON"
assert_json_has "$json_list" ".[0].path" "json entry has .path"
assert_json_has "$json_list" ".[0].fileName" "json entry has .fileName"
assert_json_has "$json_list" ".[0].filedAt" "json entry has .filedAt"
assert_json_has "$json_list" ".[0].title" "json entry has .title"
assert_json_has "$json_list" ".[0].invokedBy" "json entry has .invokedBy"

# ── 7. Empty message → usage error ────────────────────────────────────
rc=0
out_err="$(PCS report "" 2>&1)" || rc=$?
assert_exit_code 2 "$rc" "empty report exits 2"
assert_contains "$out_err" "requires a message" "empty report explains the rule"
# Must NOT have created a new report file.
shopt -s nullglob
md_files_after=( "$REPORTS_DIR"/*.md )
shopt -u nullglob
assert_eq "1" "${#md_files_after[@]}" "failed report did not create a file"

# ── 8. --context=N caps embedded invocations ──────────────────────────
# File a report with --context=1. The rendered table should have exactly
# one data row (plus the 2 header rows: column names + separator).
PCS report "second report for context test" --context=1 >/dev/null 2>&1

shopt -s nullglob
md_files2=( "$REPORTS_DIR"/*.md )
shopt -u nullglob
# Newest-first by file name (timestamp prefix): the last entry by sort is newest.
IFS=$'\n' sorted=($(printf '%s\n' "${md_files2[@]}" | sort))
unset IFS
newest="${sorted[-1]}"
table_rows="$(grep -c '^| ' "$newest" || true)"
# 2 header lines + 1 data row = 3 rows total.
assert_eq "3" "$table_rows" "--context=1 embeds exactly one data row (plus 2 header rows)"

# ── 9. --limit caps the list output ───────────────────────────────────
# File several more reports so --limit actually has work to do.
for i in 1 2 3; do
  PCS report "filler report $i for limit test" >/dev/null 2>&1
done

limited_json="$(PCS reports --json --limit=2 2>&1)"
assert_valid_json "$limited_json" "reports --limit --json is valid JSON"
len="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).length))" "$limited_json")"
assert_eq "2" "$len" "reports --limit=2 returns exactly 2 entries"

# ── 10. Usage log exists and is well-formed JSONL ─────────────────────
assert_file_exists "$LOG_FILE" "usage log file created"

# Each non-empty line must parse as JSON with the required keys.
node -e "
  const lines = require('fs').readFileSync(process.argv[1],'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    const entry = JSON.parse(line);
    for (const k of ['ts','cmd','args','exitCode','durationMs','cwd','sessionId','env','invokedBy']) {
      if (!(k in entry)) {
        console.error('missing key', k, 'in', line);
        process.exit(1);
      }
    }
    if (!Array.isArray(entry.args)) { console.error('args not array'); process.exit(1); }
  }
" "$LOG_FILE" || {
  echo "usage log JSONL shape check failed" >&2
  exit 1
}
_assert_ok "every usage-log line has required keys"

# At least one entry should record cmd="report" with exitCode=0.
ok_report="$(node -e "
  const lines = require('fs').readFileSync(process.argv[1],'utf8').split('\n').filter(Boolean);
  const hit = lines.map(l => JSON.parse(l)).find(e => e.cmd === 'report' && e.exitCode === 0);
  process.stdout.write(hit ? 'yes' : 'no');
" "$LOG_FILE")"
assert_eq "yes" "$ok_report" "usage log contains at least one successful report entry"

# And at least one failed invocation (from case 7) with exitCode=1 + an 'error' field.
ok_failed="$(node -e "
  const lines = require('fs').readFileSync(process.argv[1],'utf8').split('\n').filter(Boolean);
  const hit = lines.map(l => JSON.parse(l)).find(e => e.exitCode === 1 && typeof e.error === 'string' && e.error.length > 0);
  process.stdout.write(hit ? 'yes' : 'no');
" "$LOG_FILE")"
assert_eq "yes" "$ok_failed" "usage log carries error field for failed invocations"

# ── 11. Spaces in args survive the log round-trip ─────────────────────
spacey='blank screenshot from gmail.com with session foo'
PCS report "$spacey" >/dev/null 2>&1

# The last line of the log is our latest invocation; args[1] should equal $spacey.
last_args1="$(node -e "
  const lines = require('fs').readFileSync(process.argv[1],'utf8').split('\n').filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  process.stdout.write(last.args[1] ?? '');
" "$LOG_FILE")"
assert_eq "$spacey" "$last_args1" "spaces preserved in logged arg value"

# ── 12. invokedBy="user" when CLAUDECODE is unset ─────────────────────
# Run PCS with CLAUDECODE removed from the environment — the usage log
# entry and the report markdown should both record invokedBy="user".
env -u CLAUDECODE node "$CLI_JS" report "run as user" >/dev/null 2>&1

last_invoked_user="$(node -e "
  const lines = require('fs').readFileSync(process.argv[1],'utf8').split('\n').filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  process.stdout.write(last.invokedBy ?? '');
" "$LOG_FILE")"
assert_eq "user" "$last_invoked_user" "usage log stamps invokedBy=user when CLAUDECODE unset"

# Find the newest report and confirm the Invoked by: line.
shopt -s nullglob
md_files_user=( "$REPORTS_DIR"/*.md )
shopt -u nullglob
IFS=$'\n' sorted_user=($(printf '%s\n' "${md_files_user[@]}" | sort))
unset IFS
newest_user="${sorted_user[-1]}"
assert_contains "$(cat "$newest_user")" "**Invoked by:** user" "user-filed report stamps invokedBy=user"

# ── 13. invokedBy="claude-code" when CLAUDECODE=1 ─────────────────────
CLAUDECODE=1 node "$CLI_JS" report "filed by cc agent" >/dev/null 2>&1

last_invoked_cc="$(node -e "
  const lines = require('fs').readFileSync(process.argv[1],'utf8').split('\n').filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  process.stdout.write(last.invokedBy ?? '');
" "$LOG_FILE")"
assert_eq "claude-code" "$last_invoked_cc" "usage log stamps invokedBy=claude-code when CLAUDECODE=1"

shopt -s nullglob
md_files_cc=( "$REPORTS_DIR"/*.md )
shopt -u nullglob
IFS=$'\n' sorted_cc=($(printf '%s\n' "${md_files_cc[@]}" | sort))
unset IFS
newest_cc="${sorted_cc[-1]}"
assert_contains "$(cat "$newest_cc")" "**Invoked by:** claude-code" "cc-filed report stamps invokedBy=claude-code"

# Reports list shows [CC] marker for that entry.
cc_list="$(PCS reports 2>&1)"
assert_contains "$cc_list" "[CC]" "reports list shows [CC] marker for claude-code reports"
assert_contains "$cc_list" "filed by cc agent" "reports list shows cc-filed title"

# ── 14. --no-notify flag is accepted and does not crash ───────────────
# A report with --no-notify must succeed whether or not CLAUDECODE is set.
rc_nn=0
out_nn="$(CLAUDECODE=1 node "$CLI_JS" report "no-notify flag test" --no-notify 2>&1)" || rc_nn=$?
assert_exit_code 0 "$rc_nn" "--no-notify report exits 0"
assert_contains "$out_nn" "Report saved to" "--no-notify report still writes the file"
