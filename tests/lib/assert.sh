#!/usr/bin/env bash
# tests/lib/assert.sh — assertion helpers for scenario scripts.
#
# Source this file from tests/scenarios/*.sh. Every assert_* function prints
# a clear failure message and returns non-zero on failure; scripts using
# `set -e` will abort on the first failed assertion.
#
# Conventions:
#   - First argument is always the expected/condition value(s).
#   - Last argument is always a short human-readable description.
#   - Failures print "assert_NAME FAIL: <what went wrong> [desc]" to stderr.
#   - Successes are silent unless ASSERT_VERBOSE=1.

_assert_ok() {
  if [[ "${ASSERT_VERBOSE:-0}" = "1" ]]; then
    printf "  \033[32m✓\033[0m %s\n" "$1"
  fi
}

_assert_fail() {
  printf "  \033[31m✗\033[0m %s\n" "$1" >&2
  return 1
}

# assert_eq <expected> <actual> <desc>
# Exact string equality.
assert_eq() {
  local expected="$1"
  local actual="$2"
  local desc="${3:-assert_eq}"
  if [[ "$expected" == "$actual" ]]; then
    _assert_ok "$desc"
  else
    _assert_fail "assert_eq FAIL [$desc]
      expected: $expected
      actual:   $actual"
  fi
}

# assert_exit_code <expected-code> <actual-code> <desc>
assert_exit_code() {
  local expected="$1"
  local actual="$2"
  local desc="${3:-assert_exit_code}"
  if [[ "$expected" == "$actual" ]]; then
    _assert_ok "$desc (exit $actual)"
  else
    _assert_fail "assert_exit_code FAIL [$desc]
      expected exit: $expected
      actual exit:   $actual"
  fi
}

# assert_file_exists <path> <desc>
assert_file_exists() {
  local path="$1"
  local desc="${2:-assert_file_exists}"
  if [[ -f "$path" ]]; then
    _assert_ok "$desc ($path)"
  else
    _assert_fail "assert_file_exists FAIL [$desc]
      file not found: $path"
  fi
}

# assert_file_min_size <path> <min-bytes> <desc>
# Passes when file size >= min-bytes.
assert_file_min_size() {
  local path="$1"
  local min="$2"
  local desc="${3:-assert_file_min_size}"
  if [[ ! -f "$path" ]]; then
    _assert_fail "assert_file_min_size FAIL [$desc]
      file not found: $path"
    return 1
  fi
  # BSD stat (-f) on macOS, GNU stat (-c) on linux
  local size
  size="$(stat -f%z "$path" 2>/dev/null || stat -c%s "$path" 2>/dev/null || echo 0)"
  if (( size >= min )); then
    _assert_ok "$desc (size=$size ≥ $min)"
  else
    _assert_fail "assert_file_min_size FAIL [$desc]
      file:     $path
      size:     $size
      min:      $min"
  fi
}

# assert_contains <haystack> <needle> <desc>
# Substring match. Haystack can be multi-line.
assert_contains() {
  local haystack="$1"
  local needle="$2"
  local desc="${3:-assert_contains}"
  if [[ "$haystack" == *"$needle"* ]]; then
    _assert_ok "$desc"
  else
    _assert_fail "assert_contains FAIL [$desc]
      needle not found: $needle
      haystack:
$(printf '%s\n' "$haystack" | sed 's/^/        /')"
  fi
}

# assert_not_contains <haystack> <needle> <desc>
assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  local desc="${3:-assert_not_contains}"
  if [[ "$haystack" != *"$needle"* ]]; then
    _assert_ok "$desc"
  else
    _assert_fail "assert_not_contains FAIL [$desc]
      unexpected needle found: $needle"
  fi
}

# assert_valid_json <json-string-or-path> <desc>
# If argument is an existing file, validates the file; otherwise validates the string.
assert_valid_json() {
  local input="$1"
  local desc="${2:-assert_valid_json}"
  local tmp
  if [[ -f "$input" ]]; then
    if node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$input" >/dev/null 2>&1; then
      _assert_ok "$desc (file $input)"
    else
      _assert_fail "assert_valid_json FAIL [$desc]
        invalid JSON in file: $input"
    fi
  else
    if node -e "JSON.parse(process.argv[1])" "$input" >/dev/null 2>&1; then
      _assert_ok "$desc"
    else
      _assert_fail "assert_valid_json FAIL [$desc]
        invalid JSON:
$(printf '%s\n' "$input" | sed 's/^/          /')"
    fi
  fi
}

# assert_json_has <json-string-or-path> <dot-path> <desc>
# Passes when the dot-path resolves to a non-undefined value.
# Example: assert_json_has "$output" ".sessions[0].name" "first session has name"
assert_json_has() {
  local input="$1"
  local path="$2"
  local desc="${3:-assert_json_has $path}"
  local src
  if [[ -f "$input" ]]; then
    src="$(cat "$input")"
  else
    src="$input"
  fi
  if node -e "
    const data = JSON.parse(process.argv[1]);
    const parts = process.argv[2].split(/\.|\[|\]/).filter(Boolean);
    let cur = data;
    for (const p of parts) {
      if (cur == null) process.exit(1);
      cur = /^\d+$/.test(p) ? cur[Number(p)] : cur[p];
    }
    if (cur === undefined) process.exit(1);
  " "$src" "$path" 2>/dev/null; then
    _assert_ok "$desc"
  else
    _assert_fail "assert_json_has FAIL [$desc]
      path not found: $path
      json:
$(printf '%s\n' "$src" | sed 's/^/        /')"
  fi
}
