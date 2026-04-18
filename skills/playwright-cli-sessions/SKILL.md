---
name: playwright-cli-sessions
description: Stateless browser automation CLI with saved-session auth, live probes, and a built-in feedback loop. Use when you need Playwright from the shell — single-shot commands, parallel-safe, reads/writes ~/.playwright-sessions/.
---

# playwright-cli-sessions

A stateless shell CLI on top of Playwright. Each invocation launches a browser,
does its work, exits. No persistent server, no stdio — true parallelism via
shell `&`. Reads/writes `~/.playwright-sessions/`, interoperable with the
`playwright-sessions` MCP.

## THE CRITICAL RULE — Feedback Loop

**If this CLI misbehaves, file a report. DO NOT work around it.**

When you (an AI agent) hit unexpected behavior — a blank screenshot, wrong exit
code, confusing error, missing flag, a flow that seems broken — the correct
response is:

```bash
playwright-cli-sessions report "<one-line what you expected vs what happened>"
```

**Forbidden workarounds** when a `playwright-cli-sessions` command misbehaves:

- Falling back to `curl` / `fetch` to simulate browser behavior
- Spawning a bare `npx playwright` script that duplicates CLI functionality
- Silently swallowing the error and claiming success
- Fabricating screenshot paths or page output you never captured
- Switching to a different tool without telling the user

Filing a report takes seconds. Working around the tool:
1. Hides the bug from the user
2. Wastes more time than reporting ever would
3. Produces unreliable output

Every report is a markdown file under `~/.playwright-sessions/.reports/` with
your last ~10 CLI invocations (from `.usage-log.jsonl`) auto-embedded for
context. The user reviews them and fixes the gap. You never have to work
around the same bug twice.

```bash
# List recent reports
playwright-cli-sessions reports
playwright-cli-sessions reports --json --limit=5
```

## When to use this skill

- Browser auth in CLI-driven workflows (token-efficient vs MCP)
- Parallel sub-agents each running their own browser (each invocation is isolated)
- Testing / scraping / form flows that need full Playwright API
- Any shell-side browser automation

## The two command families

| Family | Commands | When |
|--------|----------|------|
| **Session management** | `list`, `save`, `restore`, `clone`, `tag`, `delete`, `probe`, `health` | Managing saved logins |
| **Browser automation** | `screenshot`, `navigate`, `snapshot`, `exec`, `login`, `refresh` | Actually driving a browser |

## Session workflows

Pick based on whether auth is needed:

| Situation | Workflow |
|-----------|----------|
| No login needed | A — stateless |
| Need saved auth (existing session) | B — pass `--session=<name>` |
| First-time login setup | C — `login` command |

### Workflow A — Stateless (no login needed)

Run any browser-automation command without `--session`:

```bash
playwright-cli-sessions screenshot https://example.com --out=/tmp/x.png
playwright-cli-sessions snapshot https://example.com
playwright-cli-sessions navigate https://example.com
```

No session file is written. Browser dies when the command exits.

### Workflow B — Restore saved session (routine auth-required work)

1. List available sessions and check status:
   ```bash
   playwright-cli-sessions list
   ```
   Output markers: `[LIVE]`, `[DEAD, 401]`, `[no-probe]`, `[cookie-valid 30d]`,
   `[cookie-expired]`. Trust the probe over cookie metadata for GitHub,
   Instagram, LinkedIn, Supabase, Vercel.

2. Pass `--session=<name>` to any browser-automation command:
   ```bash
   playwright-cli-sessions screenshot https://github.com/settings \
     --session=gabriel-platforms --out=/tmp/gh.png

   playwright-cli-sessions exec /tmp/my-script.mjs \
     --session=gabriel-platforms
   ```

Saved sessions are read-only from the CLI's perspective — commands never write
back. Safe for parallel use.

### Workflow C — First-time login setup

Only when establishing a new saved login:

```bash
playwright-cli-sessions login <name> --url=https://service.com/login
# Headful Chrome opens → user logs in → press Enter → state saved.
```

After this, the session is usable via Workflow B.

**Expired logins:** if `list` shows `[DEAD, 302]` on the service you need, ask
the user to re-run `login` or `refresh`. Do NOT try to automate password entry,
2FA, CAPTCHA, WebAuthn, or OAuth popups — these always fail.

## Browser automation commands

All browser commands accept: `--session=<name>`, `--headed`, `--channel=<chrome|msedge|...>`, `--wait-for=<selector>`, `--wait-until=<load|domcontentloaded|networkidle|commit>`.

### screenshot

```bash
playwright-cli-sessions screenshot <url> [--out=<path>] [--full-page] [...]
```

- `--out=<path>` — defaults to `/tmp/screenshot-<ts>.png` (parent dir auto-created)
- `--full-page` — capture the whole scrollable page
- **Always pair with `--wait-for=<selector>`** to avoid blank captures.

### navigate

```bash
playwright-cli-sessions navigate <url> [--snapshot] [...]
```

Prints page info (title, URL). With `--snapshot`, also prints ARIA tree.

### snapshot

```bash
playwright-cli-sessions snapshot <url> [...]
```

Prints the ARIA accessibility tree. More reliable than DOM snapshots for
locator discovery.

### exec — full Playwright API

For anything beyond one-shot commands, write a `.mjs` file exporting `run`:

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

Scripts can `import` anything, reference helper files, use any Playwright API.

### login / refresh

```bash
playwright-cli-sessions login <name> --url=<login-url>    # first-time
playwright-cli-sessions refresh <name> [--url=<url>]      # re-auth existing
```

Both open a headful browser so the user can sign in. On Enter (or close), state
is saved under `~/.playwright-sessions/<name>.json`.

## Session management commands

```bash
playwright-cli-sessions list [--probe=false] [--json]
playwright-cli-sessions save <name>           # capture from running playwright-cli session
playwright-cli-sessions restore <name> [--out=<path>]
playwright-cli-sessions clone <src> <dst>
playwright-cli-sessions tag <name> <service> [identity]
playwright-cli-sessions delete <name>
playwright-cli-sessions probe <name> [--service=X]
playwright-cli-sessions health                # probe all, notify on dead
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

Five concurrent headless browsers, no coordination needed.

## Dynamic-page selectors inside `exec`

Prefer resilient Playwright locators (`page.getByRole`, `page.getByText`) over
index-style refs. When role/text don't match cleanly, fall back to
`page.evaluate`:

```javascript
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')]
    .find(b => b.textContent?.includes('Continue'));
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});
```

## Interoperability with playwright-sessions MCP

Both tools share `~/.playwright-sessions/`. Sessions saved by one are visible
to the other. The probe cache (`.probe-cache.json`) is also shared.

See `references/migrating-from-mcp.md` for the MCP tool → CLI command mapping.

## Rules recap

- **Never launch a browser just to test with auth** — pass `--session=<name>`
- **Always `list` first** to pick a session with live auth for the target service
- **Use `--wait-for=<selector>`** on any screenshot/nav to avoid blank captures
- **Prefer `exec` with a `.mjs` script** over chaining many `navigate` commands
- **On unexpected behavior: `report`, don't work around** — see top of this file
- Saved sessions are read-only from CLI — safe for parallel use
- Expired logins: ask the user to `login` / `refresh`, don't automate creds
