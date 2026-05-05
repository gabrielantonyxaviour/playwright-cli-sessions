#!/usr/bin/env bash
# 05 — Save once, reuse forever.
#
# The pattern for working with services that need authentication:
#   1. ONE-TIME: `login <name> --url=<login-url>` opens a real Chrome.
#      You log in (password, OTP, whatever). The CLI saves cookies +
#      localStorage + storage state under that name.
#   2. EVERY FUTURE COMMAND: pass `--session=<name>`. The browser
#      hydrates the saved state and you're already logged in.
#
# This is the part most stateless tools get wrong — they either
# re-authenticate every run (slow + 2FA hell) or hold a long-lived
# process (an MCP server, a Selenium grid, etc). This pattern is
# stateless per-command but stateful per-session.
#
# Run:
#   bash 05-saved-session-flow.sh
set -euo pipefail

SESSION_NAME="example-github"

# Already saved? Use it.
if playwright-cli-sessions list --json 2>/dev/null | grep -q "\"$SESSION_NAME\""; then
  echo "Session '$SESSION_NAME' exists. Using it."
else
  echo "First-time setup. A real Chrome window will open."
  echo "Log in to GitHub, then press Enter in this terminal."
  playwright-cli-sessions login "$SESSION_NAME" --url=https://github.com/login
fi

# Now every authed command uses --session=<name>. The cookies are loaded
# automatically, no second login.
playwright-cli-sessions screenshot https://github.com/settings \
  --session="$SESSION_NAME" \
  --out=/tmp/example-05-settings.png

# Multi-step authed work: an exec script with the saved session attached.
cat > /tmp/example-05-script.mjs <<'JS'
export async function run({ page }) {
  await page.goto("https://github.com");
  // After session load, the page renders as the logged-in user.
  const username = await page
    .locator('img.avatar-user[alt^="@"]')
    .getAttribute("alt");
  return { loggedInAs: username ?? "(not logged in?)" };
}
JS

playwright-cli-sessions exec /tmp/example-05-script.mjs --session="$SESSION_NAME"
rm -f /tmp/example-05-script.mjs
