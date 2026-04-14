# Workflow B — Auth-required testing (restore saved session)

Use this when a feature requires an authenticated user and you have a saved
session for that service.

## Steps

1. **Check available sessions** and their status:
   ```bash
   playwright-cli-sessions list
   ```
   Look for `[LIVE, probed Xm ago]` for the service you need.
   If you see `[DEAD, 401]` or `[DEAD, 302]`, that session is expired — go to Workflow C.

2. **Restore the session**:
   ```bash
   playwright-cli-sessions restore <name>
   ```
   This opens a browser pre-loaded with the saved auth state. The browser
   window stays open.

3. **Drive the browser** using playwright-cli:
   ```bash
   playwright-cli -s=<name> goto https://service.example.com/dashboard
   playwright-cli -s=<name> snapshot
   # ... other commands
   ```

4. **Do not save when done** — the session is a working copy. Only call
   `playwright-cli-sessions save <name>` if you explicitly want to update
   the saved auth (e.g., after re-logging in).

## Notes

- Restoring is non-destructive: the saved file is only read, never modified.
- The session name in playwright-cli (`-s=<name>`) should match the saved
  session name for clarity.
- For parallel agents: each agent restores into a differently-named session
  (clone the source first) so they don't conflict.

## Parallel agents

When multiple agents need the same auth:

```bash
# Agent 1 setup
playwright-cli-sessions clone gabriel-platforms test-agent-1
playwright-cli-sessions restore test-agent-1

# Agent 2 setup
playwright-cli-sessions clone gabriel-platforms test-agent-2
playwright-cli-sessions restore test-agent-2
```

Each agent works in its own session. Neither can accidentally overwrite the
source `gabriel-platforms` session (clone-safety guard prevents it).
