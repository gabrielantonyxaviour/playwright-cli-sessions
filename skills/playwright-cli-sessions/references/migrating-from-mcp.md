# Migrating from playwright-sessions MCP → CLI

Both tools share `~/.playwright-sessions/` and are fully interoperable.
You don't need to migrate all at once — use either tool per task.

## Tool mapping

| MCP tool | CLI command | Notes |
|----------|-------------|-------|
| `session_list_saved` | `playwright-cli-sessions list` | Same probe logic, shared cache |
| `session_save` | `playwright-cli-sessions save <name>` | Shells out to playwright-cli |
| `session_create { restoreFrom }` | `playwright-cli-sessions restore <name>` | Opens browser with saved state |
| `session_clone` | `playwright-cli-sessions clone <src> <dst>` | Same clone-safety model |
| `session_close` | `playwright-cli close` (via playwright-cli) | CLI has no "close" wrapper |
| `session_delete_saved` | `playwright-cli-sessions delete <name>` | Direct file delete |
| `session_tag` | `playwright-cli-sessions tag <name> <service> [id]` | Manual service labelling |
| _(no direct equiv)_ | `playwright-cli-sessions probe <name>` | Explicit probe + cache update |
| _(no direct equiv)_ | `playwright-cli-sessions install --skills` | Install skill files |

## Key behavioral differences

**MCP sessions are in-memory; CLI sessions are file-based.**
- MCP `session_create` creates a browser context object in the MCP server process.
- CLI `restore` opens a real browser window you interact with via playwright-cli commands.

**MCP `session_close` never auto-saves (v0.2.0+).**
- You must call `session_save` explicitly.
- Same for CLI: `playwright-cli close` doesn't save anything. Call `playwright-cli-sessions save <name>` first.

**Clone safety is identical.**
- Both tools set `cloneOf` in metadata and throw on save attempts.
- `session_save { overwriteSource: true }` in MCP = `playwright-cli-sessions save <name> --overwrite-source=<source>` in CLI.

## When to use which

| Prefer CLI | Prefer MCP |
|------------|-----------|
| Scripted workflows, shell pipelines | Multi-step browser reasoning tasks |
| Token-efficient agent tasks | Rich introspection (read DOM, take screenshots) |
| Parallel agents with isolated sessions | Sessions that need to stay open across tool calls |
| Inspecting/managing sessions from terminal | Anything needing `browser_snapshot`, `browser_click`, etc. |
