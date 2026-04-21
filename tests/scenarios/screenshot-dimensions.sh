#!/usr/bin/env bash
# tests/scenarios/screenshot-dimensions.sh — AI-safe screenshot dimensions (v0.4.3).
#
# The Anthropic image input API rejects any image > 2000px on either axis in
# many-image requests, so Claude Code sessions cannot Read raw DPR-2 captures.
# This scenario verifies the screenshot-guard downscales by default and honors
# opt-outs.
#
# Covers:
#   1. Default capture (non-full-page) → dimensions ≤ 2000 on both axes
#   2. --full-page on a tall page → downscale stderr line printed, output ≤ 2000
#   3. --no-downscale → keeps full resolution (dimensions may exceed 2000)
#   4. --max-dimension=800 → output ≤ 800 on both axes
set -euo pipefail
source "${PCS_SCENARIO_LIB}/setup.sh"

png_dim() {
  node -e "require('sharp')('$1').metadata().then(m=>console.log(m.width+' '+m.height)).catch(()=>process.exit(1))"
}

# ── 1. Default capture ≤ 2000 on both axes ─────────────────────────────────
f1="$(pcs_tmp dim1.png)"
rc=0
timeout 60 node "$CLI_JS" screenshot https://example.com --out="$f1" >/dev/null 2>&1 || rc=$?
assert_exit_code 0 "$rc" "default capture exits 0"
read -r w1 h1 < <(png_dim "$f1")
[[ "$w1" -le 2000 && "$h1" -le 2000 ]] || {
  echo "default capture exceeded 2000px: ${w1}×${h1}" >&2; exit 1
}
_assert_ok "default capture ≤ 2000px on both axes (${w1}×${h1})"

# ── 2. Full-page tall → downscale fires ─────────────────────────────────────
f2="$(pcs_tmp dim2.png)"
rc=0
out2="$(timeout 90 node "$CLI_JS" screenshot https://en.wikipedia.org/wiki/Node.js --full-page --out="$f2" 2>&1)" || rc=$?
assert_exit_code 0 "$rc" "full-page tall capture exits 0"
[[ "$out2" == *"Downscaled screenshot"* ]] || {
  echo "expected 'Downscaled screenshot' stderr line, got: $out2" >&2; exit 1
}
read -r w2 h2 < <(png_dim "$f2")
[[ "$w2" -le 2000 && "$h2" -le 2000 ]] || {
  echo "full-page output exceeded 2000px: ${w2}×${h2}" >&2; exit 1
}
_assert_ok "full-page downscaled to ≤ 2000px (${w2}×${h2})"

# ── 3. --no-downscale keeps full resolution ─────────────────────────────────
f3="$(pcs_tmp dim3.png)"
rc=0
timeout 90 node "$CLI_JS" screenshot https://en.wikipedia.org/wiki/Node.js --full-page --no-downscale --out="$f3" >/dev/null 2>&1 || rc=$?
assert_exit_code 0 "$rc" "--no-downscale exits 0"
read -r w3 h3 < <(png_dim "$f3")
[[ "$h3" -gt 2000 ]] || {
  echo "expected full-page height > 2000 with --no-downscale, got: ${w3}×${h3}" >&2; exit 1
}
_assert_ok "--no-downscale preserves full resolution (${w3}×${h3})"

# ── 4. --max-dimension=800 → ≤ 800 on both axes ─────────────────────────────
f4="$(pcs_tmp dim4.png)"
rc=0
timeout 60 node "$CLI_JS" screenshot https://example.com --max-dimension=800 --out="$f4" >/dev/null 2>&1 || rc=$?
assert_exit_code 0 "$rc" "--max-dimension=800 exits 0"
read -r w4 h4 < <(png_dim "$f4")
[[ "$w4" -le 800 && "$h4" -le 800 ]] || {
  echo "--max-dimension=800 output exceeded 800px: ${w4}×${h4}" >&2; exit 1
}
_assert_ok "--max-dimension=800 caps output at 800 (${w4}×${h4})"
