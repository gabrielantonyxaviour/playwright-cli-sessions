# playwright-cli-sessions

Session management layer for `@playwright/cli`. Provides named saved logins,
live service probes, and clone safety. Reads/writes `~/.playwright-sessions/`
— fully interoperable with the `playwright-sessions` MCP.

## When to use this skill

Use `playwright-cli-sessions` when you need browser auth in CLI-driven workflows:
- Token-efficient agent tasks where MCP round-trips are expensive
- Parallel sub-agents each running their own auth-requiring browser session
- Workflows that need to inspect/manage saved sessions from the terminal

## Session workflows

There are three workflows. Pick the right one:

| Situation | Workflow |
|-----------|----------|
| No login needed | A — stateless |
| Need saved auth (existing session) | B — restore saved |
| First-time login setup | C — save new |

### Workflow A — Stateless (no login needed)

Just open playwright-cli normally. No session management needed.

```bash
playwright-cli open https://example.com
```

### Workflow B — Restore saved session (routine auth-required testing)

1. List available sessions and check status:
   ```bash
   playwright-cli-sessions list
   ```
2. Restore the session you need:
   ```bash
   playwright-cli-sessions restore gabriel-platforms
   ```
   This opens a browser window pre-loaded with the saved auth state.
3. Use `playwright-cli -s=gabriel-platforms <command>` to drive it.

**Check session status first.** If a session shows `[DEAD, 401]`, its server-side
auth has been revoked — you need to log in again (Workflow C).

### Workflow C — First-time login setup (saving a new session)

1. Open a browser:
   ```bash
   playwright-cli -s=my-session open https://github.com
   ```
2. Log in manually in the browser window.
3. Save the authenticated state:
   ```bash
   playwright-cli-sessions save my-session
   ```
4. Verify:
   ```bash
   playwright-cli-sessions list
   playwright-cli-sessions probe my-session
   ```

## Command reference

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

## Interoperability with playwright-sessions MCP

Both tools share `~/.playwright-sessions/`. Sessions saved by one tool are
visible to the other. The probe cache (`.probe-cache.json`) is also shared —
probes run by the CLI warm the cache for MCP calls and vice versa.

See `references/migrating-from-mcp.md` for the MCP tool → CLI command mapping.
