# playwright-cli-sessions

Session management layer for `@playwright/cli` — named saved logins, live service probes, and clone safety. Reads/writes `~/.playwright-sessions/`, making it fully interoperable with the [`playwright-sessions`](https://www.npmjs.com/package/playwright-sessions) MCP.

## Install

```bash
npm install -g playwright-cli-sessions
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

## Interoperability

Both `playwright-cli-sessions` and `playwright-sessions` MCP share `~/.playwright-sessions/`. Sessions saved by one tool are immediately visible to the other. The probe cache (`.probe-cache.json`) is also shared.

## Services with probe endpoints

Vercel, GitHub, Google, YouTube, Neon, Supabase, LinkedIn, Notion, Higgsfield AI, Instagram, X/Twitter, Microsoft, Tldv.

## License

Apache-2.0
