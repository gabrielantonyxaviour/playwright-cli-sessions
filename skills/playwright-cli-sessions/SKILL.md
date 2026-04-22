---
name: playwright-cli-sessions
description: Use this skill whenever the user needs browser automation from the shell, wants to script Playwright, asks about saved-session auth, or is testing/debugging a web app (Next.js, React SPA, dashboards) — even if they don't mention the CLI by name. Covers stateless runs, parallel execution, session reuse, exec scripts, shell-native assertions (`expect`), screenshot capture, and the full first-time-login workflow. Trigger on phrases like "test this flow", "screenshot the dashboard", "why does this page blank", "check if the login still works", "run this against prod", or any task where a real browser is the only way to answer the question.
---

# playwright-cli-sessions

A stateless shell CLI on top of Playwright. Each invocation launches a browser,
does its work, exits. No persistent server, no stdio — true parallelism via
shell `&`. Reads/writes `~/.playwright-sessions/`, interoperable with the
`playwright-sessions` MCP.

## THE CRITICAL RULE — Feedback Loop

**If this CLI misbehaves, file a report. DO NOT work around it.**

When you (an AI agent) hit unexpected behavior — blank screenshot, wrong exit
code, confusing error, missing flag, a flow that seems broken — the correct
response is:

```bash
playwright-cli-sessions report "<one-line: what you expected vs what happened>"
```

**Forbidden workarounds** when a `playwright-cli-sessions` command misbehaves:
- Falling back to `curl` / `fetch` to simulate browser behavior
- Spawning a bare `npx playwright` script that duplicates CLI functionality
- Silently swallowing the error and claiming success
- Fabricating screenshot paths or page output you never captured
- Switching to a different tool without telling the user

Filing a report takes seconds. Working around the tool hides the bug, wastes
more time, and produces unreliable output.

Every report lands in `~/.playwright-sessions/.reports/` with your last ~10
CLI invocations auto-embedded. A macOS desktop notification fires when a
Claude Code session files a report.

```bash
playwright-cli-sessions reports          # list recent reports
playwright-cli-sessions reports --json --limit=5
```

## The two command families

| Family | Commands | When |
|--------|----------|------|
| **Session management** | `list`, `save`, `restore`, `clone`, `tag`, `delete`, `probe`, `health` | Managing saved logins |
| **Browser automation** | `screenshot`, `navigate`, `snapshot`, `exec`, `login`, `refresh` | Driving a browser |
| **Shell assertions** | `expect` | Assert page properties; exits 0/1 |

## Quick reference — where to read next

| You want to… | Read |
|---|---|
| Write an `exec` / `.mjs` script, or hit a locator/overlay/wait-strategy issue | [`references/exec-patterns.md`](references/exec-patterns.md) |
| Decode a `PCS_*` error code / exit code | [`references/error-codes.md`](references/error-codes.md) |
| Understand probe, cookie-expiry, and session staleness | [`references/expiry-model.md`](references/expiry-model.md) |
| Map an MCP tool to its CLI equivalent | [`references/migrating-from-mcp.md`](references/migrating-from-mcp.md) |

## Session workflows

| Situation | Workflow |
|-----------|----------|
| No login needed | A — stateless |
| Need saved auth (existing session) | B — pass `--session=<name>` |
| First-time login setup | C — `login` command |

### Workflow A — Stateless (no login needed)

```bash
playwright-cli-sessions screenshot https://example.com --out=/tmp/x.png
playwright-cli-sessions snapshot https://example.com
playwright-cli-sessions navigate https://example.com
```

No session file is written. Browser dies when the command exits.

### Workflow B — Restore saved session

1. List sessions and check status:
   ```bash
   playwright-cli-sessions list
   ```
   Markers: `[LIVE]`, `[DEAD, 401]`, `[no-probe]`, `[cookie-valid 30d]`,
   `[cookie-expired]`. Trust the probe over cookie metadata for GitHub,
   Instagram, LinkedIn, Supabase, Vercel.

2. Pass `--session=<name>` to any browser-automation command:
   ```bash
   playwright-cli-sessions screenshot https://github.com/settings \
     --session=gabriel-platforms --out=/tmp/gh.png

   playwright-cli-sessions exec /tmp/my-script.mjs \
     --session=gabriel-platforms
   ```

Saved sessions are read-only from the CLI — safe for parallel use.

### Workflow C — First-time login setup

```bash
playwright-cli-sessions login <name> --url=https://service.com/login
# Headful Chrome opens → user logs in → press Enter → state saved.
```

**Expired logins:** if `list` shows `[DEAD, 302]`, ask the user to run
`login` or `refresh`. Do NOT automate password entry, 2FA, CAPTCHA, WebAuthn,
or OAuth popups — these always fail.

## Before you start scripting

**If you are about to write a `.mjs` script or use `exec --eval='<js>'`, read
[`references/exec-patterns.md`](references/exec-patterns.md) first.**

It covers the two most common silent failure modes:
- **Strict-mode locator errors** — `getByRole('button', { name: 'Sign In' })` matching a
  substring of a second element ("Sign in with Passkey") and throwing. Fix: `{ exact: true }`.
- **Modal overlays intercepting clicks** — a transparent overlay causes `page.click()`
  to time out with "subtree intercepts pointer events". The fix (Escape → dismiss by role →
  `evaluate + dispatchEvent`) is in that reference.

Also: wait-strategy decision table, login-flow recipe, and backgrounded-crash
stderr guarantee.

## Headed vs headless — the CLI decides, not you

| Command | Default | Rationale |
|---------|---------|-----------|
| `screenshot`, `navigate`, `snapshot`, `exec`, `expect` | headless | No human interaction needed. |
| `login`, `refresh` | **headful** (automatic) | The human signs in. |

**Decision rubric:**
- Stateless work → headless. Always.
- Saved-session work (`--session=<name>`) → headless. Cookies do the work.
- Login wall / CAPTCHA / 2FA unexpectedly → **stop, `report`, ask the user to
  run `login` or `refresh`**. `--headed` cannot solve a CAPTCHA.
- Only pass `--headed` when the human explicitly says "show me" or "let me watch".

## Session staleness check

Every `--session=<name>` command probes liveness before launching the browser
if the last probe is more than 6 hours old. This closes the silent-corruption
gap where sessions go dead overnight.

| Result | Action |
|--------|--------|
| Probe says **LIVE** | Browser launches; one-line stderr note |
| Probe says **DEAD** | Exit 77 (`PCS_STALE_SESSION`) + `"refresh <name>"` suggestion |
| No probe endpoint | Treated as LIVE |

```
Error [PCS_STALE_SESSION]: Session "<name>" probe failed (302). Last probed 8h ago.
  Run: playwright-cli-sessions refresh <name>
```

Opt-outs: `--no-probe` per call, `PLAYWRIGHT_CLI_NO_STALE_CHECK=1` globally.

## Stealth

Defaults to real Chrome (`--channel=chrome`) and patches `HeadlessChrome` from
the User-Agent, spoofs `navigator.connection.rtt`, and sets `devicePixelRatio`
to match the host OS.

**When stealth matters — don't opt out without reason:**
- **Agentic auth flows** (logging into a real service on the user's behalf) — keep
  stealth on. Cloudflare, PerimeterX, and DataDome fingerprint headless Chromium.
- **Sites behind anti-bot WAFs** (banking, e-commerce, social) — stealth is what
  makes `screenshot` / `navigate` return a real page instead of a challenge.
- **Any `--session=<name>` use** — the saved cookies were obtained in a real browser;
  replaying them through headless Chromium can trip heuristics that weren't triggered
  at login time.

**When stealth is neutral (but no harm in keeping it on):**
- Testing your own Next.js / SPA app in CI or against localhost.
- Hitting internal dashboards or docs sites with no bot-detection.
- Scraping public content that doesn't gate on fingerprint.

Opt-outs (use only if you have a reason): `--channel=chromium`,
`PLAYWRIGHT_CLI_NO_STEALTH_PATCH=1`, `PLAYWRIGHT_CLI_BUNDLED=1`.

## Auth-wall detection

On landing at a login/CAPTCHA/Cloudflare page instead of the destination:
**exit 77** + a grep-friendly prefix on stderr:

```
AUTH_WALL service=github session=(none) url=https://github.com/login?... suggest="..."
Error [PCS_AUTH_WALL]: auth wall detected at https://github.com/login?...
```

Handle exit 77 by prompting the user to `login <name>`. Do NOT retry the same
command — the session is missing or expired.

## Exit codes — most common

| Exit | Code | Meaning |
|------|------|---------|
| 77 | `PCS_AUTH_WALL` | Redirected to login — session missing or expired |
| 77 | `PCS_STALE_SESSION` | Pre-launch probe says session is dead |
| 11 | `PCS_HTTP_ERROR` | 4xx/5xx response on goto |
| 10 | `PCS_SELECTOR_TIMEOUT` | A `--wait-for*` flag did not resolve |

See [`references/error-codes.md`](references/error-codes.md) for the full
`PCS_*` table including `PCS_AUTH_EXPIRED`, `PCS_NAV_FAILED`,
`PCS_SESSION_NOT_FOUND`, `PCS_BROWSER_CRASH`, `PCS_NETWORK`,
`PCS_INVALID_FLAG`, `PCS_MISSING_ARG`, `PCS_UNKNOWN` — each with exit code,
trigger conditions, and recommended next action.

Unknown flags get a Levenshtein suggestion when edit-distance ≤ 2:
```bash
playwright-cli-sessions screenshot https://example.com --waite-for=h1
# Error [PCS_INVALID_FLAG]: unknown flag 'waite-for'. Did you mean --wait-for?
```

## Browser automation commands

All browser commands accept: `--session=<name>`, `--no-probe`, `--headed`,
`--channel=<chrome|msedge|chromium|...>`, `--wait-for=<selector>`,
`--wait-for-text="<str>"`, `--wait-for-count=<selector>:<N>`,
`--wait-until=<load|domcontentloaded|networkidle|commit>` (or
`--wait-for-network=idle` as an alias), `--allow-http-error` (suppresses
`PCS_HTTP_ERROR` on 4xx/5xx — use when testing error pages intentionally).

### screenshot

```bash
playwright-cli-sessions screenshot <url> [--out=<path>] [--full-page]
```

`--out` defaults to `/tmp/screenshot-<ts>.png`. Always pair with
`--wait-for=<selector>` to avoid blank captures on JS-heavy pages.

**AI-safe dimensions (default):** captures are downscaled to fit within
2000×2000 — Anthropic's image API rejects anything larger in many-image
requests, and stealth DPR-2 captures on macOS hit that limit without this
guard. A stderr line (`ℹ Downscaled screenshot 1440×9940 → 289×2000 …`)
prints when a resize happens. Override with `--no-downscale` (full
resolution) or `--max-dimension=<N>` (custom cap). Global env overrides:
`PLAYWRIGHT_CLI_NO_DOWNSCALE=1`, `PLAYWRIGHT_CLI_MAX_DIMENSION=<N>`.

### navigate

```bash
playwright-cli-sessions navigate <url> [--snapshot]
```

Prints page info (title, URL). With `--snapshot`, also prints the ARIA tree.

### snapshot

```bash
playwright-cli-sessions snapshot <url>
```

Prints the ARIA accessibility tree. More reliable than DOM snapshots for
discovering locators before writing exec scripts.

### exec — full Playwright API

```javascript
// /tmp/script.mjs
export async function run({ page, context, browser }) {
  await page.goto('https://github.com');
  const title = await page.title();
  return { title, url: page.url() };
}
```

```bash
playwright-cli-sessions exec /tmp/script.mjs --session=gabriel-platforms
# Prints JSON of the return value. Throw to exit non-zero.
```

**Inline and stdin variants:**

```bash
# One-liner without a file
playwright-cli-sessions exec --eval='await page.goto("https://example.com"); return await page.title();'

# Read the script from stdin
cat script.mjs | playwright-cli-sessions exec -
```

Scripts can `import` anything, use any Playwright API. For tactical patterns
(strict-mode locators, modal overlays, wait strategies), see
[`references/exec-patterns.md`](references/exec-patterns.md).

**Dynamic-page selectors:** prefer `getByRole`/`getByText`/`getByLabel` with
`{ exact: true }`. When those can't uniquely match, fall back to `page.evaluate`
+ vanilla DOM. Details in `references/exec-patterns.md` sections 1 and 6.

### expect — shell-native assertions

```bash
playwright-cli-sessions expect https://example.com --title="Example Domain"
playwright-cli-sessions expect https://gh.com/settings --session=x --selector="header"
playwright-cli-sessions expect https://api.example.com/health --status=200
```

Exits 0 (pass) / 1 (failed expectations) / 2 (bad args). Supports `--retry=<N>`,
`--timeout=<ms>`, `--screenshot-on-fail=<path>`.

### login / refresh

```bash
playwright-cli-sessions login <name> --url=<login-url>    # first-time
playwright-cli-sessions refresh <name> [--url=<url>]      # re-auth existing
```

Both open a headful browser. On Enter (or close), state saved to
`~/.playwright-sessions/<name>.json`.

## Session management commands

```bash
playwright-cli-sessions list [--probe=false] [--json]
playwright-cli-sessions save <name>
playwright-cli-sessions restore <name> [--out=<path>]
playwright-cli-sessions clone <src> <dst>
playwright-cli-sessions tag <name> <service> [identity]
playwright-cli-sessions delete <name>
playwright-cli-sessions probe <name> [--service=X]
playwright-cli-sessions health
```

## Parallel execution

Each invocation is an isolated process. Use shell `&`:

```bash
URLS=(https://a.com https://b.com https://c.com https://d.com)
for i in "${!URLS[@]}"; do
  playwright-cli-sessions screenshot "${URLS[$i]}" --out=/tmp/p-$i.png &
done
wait
```

## Rules recap

- **Never launch a browser just to test with auth** — pass `--session=<name>`.
- **On unexpected behavior: `report`, don't work around.** See top of file.
- **Default headless; never pass `--headed` unprompted.**
- **Always pair screenshots/navs with `--wait-for=<selector>`** to avoid blank captures.
- **Expired logins are the user's problem to solve** — ask for `login` / `refresh`;
  never automate credentials, 2FA, or CAPTCHA.

## Interoperability with playwright-sessions MCP

Both tools share `~/.playwright-sessions/`. Sessions saved by one are visible
to the other. The probe cache (`.probe-cache.json`) is also shared.

See [`references/migrating-from-mcp.md`](references/migrating-from-mcp.md) for
the MCP tool → CLI command mapping.
