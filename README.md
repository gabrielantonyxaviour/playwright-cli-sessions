# playwright-cli-sessions

Session management layer for `@playwright/cli` — named saved logins, live service probes, and clone safety. Reads/writes `~/.playwright-sessions/`, making it fully interoperable with the [`playwright-sessions`](https://www.npmjs.com/package/playwright-sessions) MCP.

## Install

```bash
npm install -g playwright-cli-sessions
# Browser commands require Chromium:
npx playwright install chromium
```

## Commands

```
playwright-cli-sessions list [--probe=false] [--json]
playwright-cli-sessions save <name>
playwright-cli-sessions restore <name>
playwright-cli-sessions clone <source> <newName>
playwright-cli-sessions tag <name> <service> [identity]
playwright-cli-sessions delete <name>
playwright-cli-sessions probe <name> [--service=X]
playwright-cli-sessions install --skills
playwright-cli-sessions screenshot <url> [--session=<name>] [--out=<path>] [--headed] [--channel=<channel>] [--wait-for=<selector>] [--wait-until=<event>] [--full-page]
playwright-cli-sessions navigate <url> [--session=<name>] [--snapshot] [--headed] [--channel=<channel>] [--wait-for=<selector>] [--wait-until=<event>]
playwright-cli-sessions snapshot <url> [--session=<name>] [--headed] [--channel=<channel>] [--wait-for=<selector>] [--wait-until=<event>]
playwright-cli-sessions exec <script> [<url>] [--session=<name>] [--headed] [--channel=<channel>] [--wait-for=<selector>] [--wait-until=<event>]
playwright-cli-sessions login <url> [--session=<name>] [--channel=<channel>]
playwright-cli-sessions refresh <name> [--url=<url>] [--channel=<channel>]
playwright-cli-sessions expect <url> [--title=<substr>] [--selector=<sel>] [--text=<substr>] [--status=<code>] [--session=<name>] [--timeout=<ms>] [--retry=<N>] [--screenshot-on-fail=<path>]
playwright-cli-sessions report "<message>" [--context=<N>] [--no-notify]
playwright-cli-sessions reports [--limit=<N>] [--json]
```

### `list`

Enumerate all saved sessions with live HTTP probe status (1-hour cache):

```
gabriel-platforms (saved 2026-03-24, https://console.neon.tech/...)
  GitHub (BonneyMantra)      [LIVE, probed 3m ago]
  Google                     [LIVE, probed 3m ago]
  Vercel (gabriel@...)       [LIVE, probed 3m ago]
  Neon (e9e2717e-...)        [DEAD, 401]
```

Pass `--probe=false` to skip network calls (uses cookie-expiry metadata only).

### `save <name>`

Capture the auth state from a running `playwright-cli` session:

```bash
# 1. Open a browser and log in
playwright-cli -s=my-session open https://github.com

# 2. Save the authenticated state
playwright-cli-sessions save my-session
```

### `restore <name>`

Open a browser pre-loaded with a saved session's auth state:

```bash
playwright-cli-sessions restore gabriel-platforms
# → opens browser with GitHub, Google, Vercel, etc. already logged in
```

### `clone <source> <newName>`

Copy a session for throwaway use (clone-safety: save throws on clones):

```bash
playwright-cli-sessions clone gabriel-platforms test-clone
playwright-cli-sessions restore test-clone
# Do work... clone is throwaway, source is never modified
```

### `probe <name> [--service=X]`

Run live HTTP probes and update the shared cache:

```bash
playwright-cli-sessions probe gabriel-platforms
playwright-cli-sessions probe gabriel-platforms --service=Vercel
```

### `install --skills`

Copy Claude Code skill files into the current project:

```bash
playwright-cli-sessions install --skills
# → .claude/skills/playwright-cli-sessions/SKILL.md + references/
```

## Stealth (v0.3.2+)

Browser automation commands automatically apply a fingerprint patch that removes
the `HeadlessChrome` token from the User-Agent string. Despite `--channel=chrome`
launching real Chrome, Playwright's `--headless=new` mode still emits
`HeadlessChrome/<ver>` in the HTTP `User-Agent` header — a signal that CDN-level
bot filters (Cloudflare, Akamai, DataDome) check before any JavaScript runs.

**What gets patched automatically:**

- **User-Agent** — rewrites `HeadlessChrome/<ver>` → `Chrome/<ver>` in both the
  HTTP header and `navigator.userAgent`, using the real version from the launched
  browser binary.
- **`navigator.connection.rtt`** — spoofed to a realistic 50–99ms value (headless
  reports 0, which is a known JS-level detection signal).
- **`devicePixelRatio`** — set to 2 on macOS (Retina) and 1 elsewhere, with a
  matching viewport (1440×900 on macOS, 1920×1080 on Linux/Windows).

The patch was validated by a real Tinder signup field test on 2026-04-18 which
confirmed `HeadlessChrome/147.0.0.0` in the UA despite `--channel=chrome`.

**Opt-outs:**

| Flag / Env var | Effect |
|----------------|--------|
| `--channel=chromium` | Explicit opt-out to bundled Chromium (no stealth). |
| `PLAYWRIGHT_CLI_NO_STEALTH_PATCH=1` | Skip UA rewrite, RTT spoof, and DPR patch. Keeps `--channel=chrome` launch args. Useful for testing your own site's bot-detection pipeline against a raw headless UA. |
| `PLAYWRIGHT_CLI_BUNDLED=1` | Use the bundled Chrome for Testing (no `--channel=chrome`, no stealth args). For CI servers without real Chrome installed. |

## Browser automation (v0.2.0+)

These commands launch a headless Chrome browser directly — no running
`playwright-cli` instance needed. Pass `--session=<name>` to any command to
pre-load a saved session's cookies into the browser context. Pass `--headed`
to open a visible browser window instead of running headless.

> **Prerequisite:** run `npx playwright install chromium` once after installing.

### `screenshot <url>`

Take a PNG screenshot of any URL, optionally with a saved session:

```bash
playwright-cli-sessions screenshot https://github.com --session=gabriel-platforms --out=/tmp/gh.png
# ✓ Screenshot saved to /tmp/gh.png
#   Page: GitHub · Build software better, together. — https://github.com/
```

Options:
- `--session=<name>` — load a saved session's cookies (optional)
- `--out=<path>` — output PNG path (default: `/tmp/screenshot-<ts>.png`). Parent directory is auto-created.
- `--headed` — open a visible browser window (default: headless)
- `--channel=<channel>` — browser channel: `chrome` (default), `msedge`, etc.
- `--wait-for=<selector>` — CSS selector to wait for after navigation (strongly recommended for dynamic pages to avoid blank captures)
- `--wait-until=<event>` — Playwright `waitUntil`: `load` | `domcontentloaded` (default) | `networkidle` | `commit`
- `--full-page` — capture the full scrollable page (default: viewport only)

### `navigate <url>`

Navigate to a URL and print page info. Add `--snapshot` to also dump the
ARIA accessibility tree — useful for building automation scripts:

```bash
playwright-cli-sessions navigate https://github.com --session=gabriel-platforms --snapshot
# ✓ Navigated to https://github.com/
#   Title: GitHub · ...
# - document:
#   - banner:
#     - heading "Navigation Menu" ...
```

Options:
- `--session=<name>` — load a saved session's cookies (optional)
- `--snapshot` — print the ARIA accessibility tree after navigating
- `--headed` — open a visible browser window (default: headless)
- `--channel=<channel>` — browser channel: `chrome` (default), `msedge`, etc.
- `--wait-for=<selector>` — CSS selector to wait for after navigation
- `--wait-until=<event>` — Playwright `waitUntil`: `load` | `domcontentloaded` (default) | `networkidle` | `commit`

### `snapshot <url>`

Print the full ARIA accessibility tree for a URL (shorthand for `navigate --snapshot`):

```bash
playwright-cli-sessions snapshot https://github.com --session=gabriel-platforms
```

Options:
- `--session=<name>` — load a saved session's cookies (optional)
- `--headed` — open a visible browser window (default: headless)
- `--channel=<channel>` — browser channel: `chrome` (default), `msedge`, etc.
- `--wait-for=<selector>` — CSS selector to wait for after navigation
- `--wait-until=<event>` — Playwright `waitUntil`: `load` | `domcontentloaded` (default) | `networkidle` | `commit`

### `exec <script> [<url>]`

Run a custom automation script against a page. The script must export a
`run({ page, context, browser })` function and can return a value (printed to stdout):

```js
// /tmp/my-script.mjs
export async function run({ page, context, browser }) {
  await page.goto("https://github.com");
  // context and browser give access to the full Playwright API
  // — multi-tab flows, cookies, tracing, etc.
  return await page.title();
}
```

```bash
playwright-cli-sessions exec /tmp/my-script.mjs
# GitHub · Build software better, together. · GitHub

# Or pass a URL to navigate before calling run():
playwright-cli-sessions exec /tmp/my-script.mjs https://github.com --session=gabriel-platforms
```

Options:
- `--session=<name>` — load a saved session's cookies (optional)
- `--headed` — open a visible browser window (default: headless)
- `--channel=<channel>` — browser channel: `chrome` (default), `msedge`, etc.
- `--wait-for=<selector>` — CSS selector to wait for after navigation (only applies when `<url>` is given)
- `--wait-until=<event>` — Playwright `waitUntil`: `load` | `domcontentloaded` (default) | `networkidle` | `commit`
- Second positional argument `<url>` — navigate before calling `run()` (optional; script may navigate itself)

### `login <url>`

Open a real (non-headless) browser, let you log in interactively, then save
the session. This is the primary way to create new saved sessions:

```bash
playwright-cli-sessions login https://github.com --session=my-github
# Opens browser → you log in → press Enter → session saved
# ✓ Saved session as "my-github" to ~/.playwright-sessions/my-github.json
#   Detected: GitHub (yourname)
```

In non-TTY environments (Claude Code, CI, piped stdin), the command waits for
the browser window to be closed instead of waiting for Enter.

Options:
- `--session=<name>` — set the save name, and optionally pre-load an existing session as a base
- `--channel=<channel>` — browser channel: `chrome` (default), `msedge`, etc.

### `refresh <name>`

Re-open an existing saved session in a browser so you can re-authenticate
(e.g. after a session expires). Cookies are pre-loaded, and the updated state
is saved back to the same session file:

```bash
playwright-cli-sessions refresh donna --url=https://tinder.com
# Opens browser with donna's cookies → re-authenticate → close browser or press Enter
# ✓ Updated session "donna" in ~/.playwright-sessions/donna.json

# Omit --url to navigate to the session's last URL:
playwright-cli-sessions refresh donna
```

Unlike `login --session=<name>`, `refresh` requires the session to already
exist and errors if not found.

Options:
- `--url=<url>` — URL to navigate to (default: session's `lastUrl`)
- `--channel=<channel>` — browser channel: `chrome` (default), `msedge`, etc.

## Shell-native assertions (`expect`)

`expect` is a declarative assertion command: navigate to a URL, check one or
more page properties, exit 0 on pass or 1 on failure. Write shell-level tests
without a single `.mjs` file.

```bash
# Title contains substring
playwright-cli-sessions expect https://example.com --title="Example Domain"

# A selector is visible
playwright-cli-sessions expect https://github.com --selector="header nav" \
  --session=gabriel-platforms

# HTTP status
playwright-cli-sessions expect https://api.example.com/health --status=200

# Combined — every flag must pass
playwright-cli-sessions expect https://example.com \
  --title="Example Domain" --selector=h1 --status=200
```

Flags:
- `--title=<substr>` — `page.title()` must include the substring
- `--selector=<css>` — element must be visible within `--timeout`
- `--text=<substr>` — text must appear on the page within `--timeout`
- `--status=<code>` — navigation response HTTP status must equal the code
- `--timeout=<ms>` — cap on any single expectation wait (default 10000)
- `--retry=<N>` — retry the whole check N more times with linear backoff (default 0)
- `--screenshot-on-fail=<path>` — capture a full-page PNG when the check ultimately fails
- `--session=<name>`, `--channel=<channel>`, `--wait-for=<sel>`, `--wait-until=<event>`, `--headed` — same semantics as other browser commands

At least one of `--title`, `--selector`, `--text`, or `--status` is required.

## Feedback loop (`report` / `reports`)

This CLI is intended to be used by AI agents as well as humans. When an agent
hits unexpected behavior, the path of least resistance is often to silently
fall back to `curl` or a bare Playwright script — hiding the bug from the
user. The `report` command is the sanctioned alternative:

```bash
playwright-cli-sessions report "screenshot of gmail.com with session gabriel-platforms returned a 200x200 blank image — expected full-page"
```

Every report is a markdown file under `~/.playwright-sessions/.reports/`
stamped with the last ~10 CLI invocations (pulled from the append-only log at
`~/.playwright-sessions/.usage-log.jsonl`) so the context is never lost. Each
report also records whether it was filed by a human (`user`) or by an AI
agent (`claude-code`) — detected via the `CLAUDECODE=1` env var that Claude
Code sets in every shell it spawns.

**Proactive desktop notification (v0.3.1+).** When a Claude Code session
files a report, the CLI fires a non-blocking macOS notification so the
human finds out the moment it happens — no need to watch the terminal. The
`reports` listing prefixes Claude-filed entries with `[CC]` so they're
easy to triage.

- Per-call opt-out: `playwright-cli-sessions report "..." --no-notify`
- Per-environment opt-out: `PLAYWRIGHT_CLI_SESSIONS_NO_NOTIFY=1`
- No-op on non-darwin platforms.
- Human-filed reports never trigger a notification.

```bash
playwright-cli-sessions reports                    # list recent reports, [CC] marker on Claude-filed
playwright-cli-sessions reports --limit=5
playwright-cli-sessions reports --json             # machine-readable, includes invokedBy
playwright-cli-sessions report "msg" --context=20  # more log context
playwright-cli-sessions report "msg" --no-notify   # skip the macOS notification
```

Every invocation of the CLI — success or failure — is appended to
`.usage-log.jsonl`. Logging is best-effort and never blocks the primary
command. Set `PLAYWRIGHT_CLI_SESSIONS_NO_LOG=1` to disable.

The bundled Claude skill (`skills/playwright-cli-sessions/SKILL.md`) tells
agents: on unexpected behavior, run `report` — do NOT work around the tool.

## Auth-wall detection (v0.4.0+)

Browser commands (`screenshot`, `navigate`, `snapshot`, `exec`, `expect`) automatically detect when navigation lands on a login/auth page instead of the intended destination. When detected:

- **Exit code 77** (`PCS_AUTH_WALL`)
- A grep-friendly prefix line on stderr: `AUTH_WALL service=<name> session=<name> url=<url> suggest="playwright-cli-sessions login <name>"`
- A structured error line: `Error [PCS_AUTH_WALL]: auth wall detected at <url>`

```bash
playwright-cli-sessions navigate https://github.com/settings
# AUTH_WALL service=github session=(none) url=https://github.com/login?return_to=%2Fsettings suggest="playwright-cli-sessions login my-github"
# Error [PCS_AUTH_WALL]: auth wall detected at https://github.com/login?return_to=%2Fsettings
# exit 77
```

Detection heuristics: URL path matches `/login`, `/signin`, `/sign_in`, `/auth`, `/sso`; query-string contains `?next=`, `?redirect=`, `?returnTo=`; page title matches known auth patterns; Cloudflare challenge title; CAPTCHA iframes. Detection is skipped when the *input* URL itself is a login route (intentional navigation).

## Exit codes (v0.4.0+)

All errors emit a stable `Error [CODE]: message` line on stderr. AI agents should dispatch on exit code, not on prose-parsing of the message.

| Code | Exit | Meaning |
|------|------|---------|
| `PCS_AUTH_WALL` | 77 | Auth-wall detected (redirected to login page) |
| `PCS_AUTH_EXPIRED` | 77 | Session cookies detected as expired server-side |
| `PCS_SESSION_NOT_FOUND` | 3 | `--session=<name>` file does not exist |
| `PCS_INVALID_FLAG` | 2 | Unknown or invalid flag value |
| `PCS_MISSING_ARG` | 2 | Required positional argument missing |
| `PCS_INVALID_INPUT` | 2 | Script or input file is malformed |
| `PCS_SELECTOR_TIMEOUT` | 10 | `--wait-for=<selector>` timed out |
| `PCS_NAV_FAILED` | 11 | `page.goto()` threw (DNS, TCP, protocol error) |
| `PCS_NETWORK` | 12 | Network-level failure outside navigation |
| `PCS_BROWSER_CRASH` | 20 | Browser process crashed unexpectedly |
| `PCS_UNKNOWN` | 1 | Unexpected internal error |

Unknown flags produce a Levenshtein suggestion when the edit distance is ≤ 2:

```bash
playwright-cli-sessions screenshot https://example.com --waite-for=h1
# Error [PCS_INVALID_FLAG]: unknown flag 'waite-for'. Did you mean --wait-for?
# exit 2
```

## Upgrading from 0.3.x

**Default channel changed.** In 0.3.x, omitting `--channel` used bundled Chromium. In 0.4.0+, omitting `--channel` uses real Chrome (`--channel=chrome`). To restore the old behavior, set `PLAYWRIGHT_CLI_BUNDLED=1` or pass `--channel=chromium`.

**Error format changed.** Errors now emit `Error [CODE]: message` instead of `Error: message`. Update any grep/regex that matched the old format. Exit codes for missing-arg and invalid-flag errors changed from 1 to 2; session-not-found errors changed from 1 to 3. AI agent dispatch loops that previously checked `exit != 0` are unaffected; only loops that checked `exit == 1` specifically need updating.

**New exit 77 for auth-wall.** Add a handler in your shell loops for `exit 77` → prompt the user to run `playwright-cli-sessions login <name>`.

## Testing

The repo ships a scenario harness under `tests/` that exercises every command
end-to-end against the compiled CLI, with each scenario sandboxed to its own
temporary `PLAYWRIGHT_SESSIONS_DIR` (so tests never touch your real sessions).

```bash
npm test                      # run all scenarios
npm run test:scenarios         # same thing
bash tests/run.sh screenshot   # run a single scenario
VERBOSE=1 bash tests/run.sh    # stream each scenario's full output
```

Full suite runs ~7 scenarios in ~2–3 minutes (headless Chromium against
`https://example.com` for the browser commands). Scenarios live in
`tests/scenarios/*.sh` and share assertion helpers in `tests/lib/`.

Tests are designed to be both a safety net and documentation — each scenario's
header comment lists the cases it covers.

## Interoperability

Both `playwright-cli-sessions` and `playwright-sessions` MCP share `~/.playwright-sessions/`. Sessions saved by one tool are immediately visible to the other. The probe cache (`.probe-cache.json`) is also shared.

## Services with probe endpoints

Vercel, GitHub, Google, YouTube, Neon, Supabase, LinkedIn, Notion, Higgsfield AI, Instagram, X/Twitter, Microsoft, Tldv.

## License

Apache-2.0
