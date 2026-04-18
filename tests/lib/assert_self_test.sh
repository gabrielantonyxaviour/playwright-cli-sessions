#!/usr/bin/env bash
# Sanity-check for assert.sh. Run: bash tests/lib/assert_self_test.sh
# Expected: every "SHOULD PASS" line succeeds silently; every "SHOULD FAIL"
# line prints a failure message but the script overall exits 0.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/assert.sh"

fails=0

# --- Passing cases (silent unless ASSERT_VERBOSE=1) ---
assert_eq "foo" "foo" "eq match" || fails=$((fails + 1))
assert_exit_code 0 0 "exit match" || fails=$((fails + 1))
tmpf="$(mktemp)"; printf "hello world" > "$tmpf"
assert_file_exists "$tmpf" "file exists" || fails=$((fails + 1))
assert_file_min_size "$tmpf" 5 "file >= 5 bytes" || fails=$((fails + 1))
assert_contains "needle in haystack" "needle" "substring" || fails=$((fails + 1))
assert_not_contains "needle in haystack" "pitchfork" "absent substring" || fails=$((fails + 1))
assert_valid_json '{"a":1}' "valid inline json" || fails=$((fails + 1))
echo '{"b":2}' > "$tmpf"
assert_valid_json "$tmpf" "valid file json" || fails=$((fails + 1))
assert_json_has '{"x":{"y":[10,20]}}' ".x.y[1]" "nested json path" || fails=$((fails + 1))

if (( fails > 0 )); then
  echo "assert.sh self-test: $fails passing case(s) unexpectedly FAILED" >&2
  exit 1
fi

# --- Failing cases: confirm they produce failure output but do not crash the harness. ---
expected_fail_count=0
assert_eq "foo" "bar" "eq mismatch (expected fail)" 2>/dev/null && {
  echo "assert_eq false-positive" >&2; exit 1
} || expected_fail_count=$((expected_fail_count + 1))
assert_exit_code 0 1 "exit mismatch (expected fail)" 2>/dev/null && {
  echo "assert_exit_code false-positive" >&2; exit 1
} || expected_fail_count=$((expected_fail_count + 1))
assert_file_exists "/no/such/path/ever.txt" "missing (expected fail)" 2>/dev/null && {
  echo "assert_file_exists false-positive" >&2; exit 1
} || expected_fail_count=$((expected_fail_count + 1))
assert_file_min_size "$tmpf" 99999 "too small (expected fail)" 2>/dev/null && {
  echo "assert_file_min_size false-positive" >&2; exit 1
} || expected_fail_count=$((expected_fail_count + 1))
assert_contains "foo" "bar" "absent (expected fail)" 2>/dev/null && {
  echo "assert_contains false-positive" >&2; exit 1
} || expected_fail_count=$((expected_fail_count + 1))
assert_not_contains "foobar" "bar" "present (expected fail)" 2>/dev/null && {
  echo "assert_not_contains false-positive" >&2; exit 1
} || expected_fail_count=$((expected_fail_count + 1))
assert_valid_json '{bad json' "invalid json (expected fail)" 2>/dev/null && {
  echo "assert_valid_json false-positive" >&2; exit 1
} || expected_fail_count=$((expected_fail_count + 1))
assert_json_has '{"a":1}' ".missing.path" "missing path (expected fail)" 2>/dev/null && {
  echo "assert_json_has false-positive" >&2; exit 1
} || expected_fail_count=$((expected_fail_count + 1))

if (( expected_fail_count != 8 )); then
  echo "assert.sh self-test: expected 8 failing cases, got $expected_fail_count" >&2
  exit 1
fi

rm -f "$tmpf"
echo "assert.sh self-test OK — 9 passes, 8 expected-fails detected."
