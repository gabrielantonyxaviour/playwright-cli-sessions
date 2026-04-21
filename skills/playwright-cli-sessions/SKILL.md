---
name: playwright-cli-sessions
description: Use this skill whenever the user needs browser automation from the shell, wants to script Playwright, or asks about saved-session auth — even if they don't mention the CLI by name. Covers stateless runs, parallel execution, session reuse, exec scripts, and the full auth workflow.
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
CLI invocations auto-embedded. **Proactive notification (v0.3.1+):** a macOS
desktop notification fires when a Claude Code session files a report.

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

**Expired logins:** if `list` shows `[DEAD, 302]`, ask the user to re-run
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

## v0.4.2 new flags

`--wait-for-text="<str>"` — wait for a text substring anywhere in the body.  
`--wait-for-count=<selector>:<N>` — wait for N elements matching a selector.  
`--wait-for-network=idle` — alias for `--wait-until=networkidle`.  
`--allow-http-error` — suppress `PCS_HTTP_ERROR` on 4xx/5xx responses.  
`exec --eval='<js>'` — run a JS expression inline without a script file.  
`exec -` — read the script from stdin.

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

## Session staleness check (v0.4.1+)

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

## Stealth (v0.3.2+, default since v0.4.0)

Defaults to real Chrome (`--channel=chrome`) and patches `HeadlessChrome` from
the User-Agent, spoofs `navigator.connection.rtt`, and sets `devicePixelRatio`
to match the host OS.

Opt-outs: `--channel=chromium`, `PLAYWRIGHT_CLI_NO_STEALTH_PATCH=1`,
`PLAYWRIGHT_CLI_BUNDLED=1`.

## Auth-wall detection (v0.4.0+)

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
| 11 | `PCS_HTTP_ERROR` | 4xx/5xx response on goto (v0.4.2+) |

See [`references/error-codes.md`](references/error-codes.md) for the full
`PCS_*` table including `PCS_AUTH_EXPIRED`, `PCS_NAV_FAILED`,
`PCS_SELECTOR_TIMEOUT`, `PCS_SESSION_NOT_FOUND`, `PCS_BROWSER_CRASH`,
`PCS_NETWORK`, `PCS_INVALID_FLAG`, `PCS_MISSING_ARG`, `PCS_UNKNOWN` — each
with exit code, trigger conditions, and recommended next action.

Unknown flags get a Levenshtein suggestion when edit-distance ≤ 2:
```bash
playwright-cli-sessions screenshot https://example.com --waite-for=h1
# Error [PCS_INVALID_FLAG]: unknown flag 'waite-for'. Did you mean --wait-for?
```

## Browser automation commands

All browser commands accept: `--session=<name>`, `--no-probe`, `--headed`,
`--channel=<chrome|msedge|...>`, `--wait-for=<selector>`, `--wait-until=<load|domcontentloaded|networkidle|commit>`.

### screenshot

```bash
playwright-cli-sessions screenshot <url> [--out=<path>] [--full-page]
```

`--out` defaults to `/tmp/screenshot-<ts>.png`. Always pair with
`--wait-for=<selector>` to avoid blank captures on JS-heavy pages.

**AI-safe dimensions (v0.4.3+):** captures are downscaled to fit within
2000×2000 by default — Anthropic's image API rejects anything larger in
many-image requests, and stealth DPR-2 captures on macOS hit that limit
without this guard. A stderr line (`ℹ Downscaled screenshot 1440×9940 →
289×2000 …`) prints when a resize happens. Override per-call with
`--no-downscale` (full resolution) or `--max-dimension=<N>` (custom cap).
Global: `PLAYWRIGHT_CLI_NO_DOWNSCALE=1`, `PLAYWRIGHT_CLI_MAX_DIMENSION=<N>`.

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

- **Never launch a browser just to test with auth** — pass `--session=<name>`
- **Always `list` first** to pick a session with live auth for the target service
- **`--wait-for=<selector>` on every screenshot/nav** — avoids blank captures
- **Prefer `exec` with a `.mjs` script** over chaining many `navigate` commands
- **On unexpected behavior: `report`, don't work around** — see top of this file
- **Default headless; never pass `--headed` unprompted**
- Saved sessions are read-only from CLI — safe for parallel use
- Expired logins: ask the user to `login` / `refresh`, don't automate creds
- **Before writing an exec script:** read `references/exec-patterns.md`

## Interoperability with playwright-sessions MCP

Both tools share `~/.playwright-sessions/`. Sessions saved by one are visible
to the other. The probe cache (`.probe-cache.json`) is also shared.

See `references/migrating-from-mcp.md` for the MCP tool → CLI command mapping.
