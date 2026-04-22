# Migrating from playwright-sessions MCP → CLI

Both tools share `~/.playwright-sessions/` (sessions + probe cache) and are
fully interoperable. You don't need to migrate all at once — use either tool
per task.

## Tool mapping

| MCP tool | CLI command | Notes |
|----------|-------------|-------|
| `session_list_saved` | `playwright-cli-sessions list` | Same probe logic, shared cache |
| `session_save` | `playwright-cli-sessions save <name>` | Persist current auth state |
| `session_clone` | `playwright-cli-sessions clone <src> <dst>` | Same clone-safety model |
| `session_delete_saved` | `playwright-cli-sessions delete <name>` | Direct file delete |
| `session_tag` | `playwright-cli-sessions tag <name> <service> [id]` | Manual service labelling |
| `session_create { restoreFrom }` | Pass `--session=<name>` to any browser command | No separate "restore" step |
| `session_new` + `browser_goto` + `browser_screenshot` | `playwright-cli-sessions screenshot <url> --session=<name>` | One-shot, stateless |
| `session_new` + multi-step browser calls | `playwright-cli-sessions exec <script.mjs> --session=<name>` | Full Playwright API in a `.mjs` file |
| `session_close` | _(no equivalent needed)_ | Each CLI invocation closes on exit |
| _(no direct equiv)_ | `playwright-cli-sessions probe <name>` | Force a fresh probe + cache update |
| _(no direct equiv)_ | `playwright-cli-sessions login <name> --url=<url>` | Headful first-time auth setup |
| _(no direct equiv)_ | `playwright-cli-sessions refresh <name>` | Re-auth an expired session |
| _(no direct equiv)_ | `playwright-cli-sessions expect <url> --title=...` | Shell-native assertions, exits 0/1 |
| _(no direct equiv)_ | `playwright-cli-sessions report "<msg>"` | File a bug report when the CLI misbehaves |

## Key behavioral differences

**MCP sessions are in-memory; CLI sessions are file-based and stateless.**
- MCP holds a browser context alive between tool calls. Each CLI invocation
  launches a fresh browser, does its work, and exits. No server, no stdio.
- For multi-step work in the CLI, put the steps in a `.mjs` script and run it
  with `exec` — the browser stays alive for the duration of that script.

**CLI automation commands accept `--session=<name>` directly.**
- There is no "restore then drive" two-step. Every `screenshot`, `navigate`,
  `snapshot`, `exec`, and `expect` command takes `--session=<name>` and
  hydrates cookies automatically on launch.

**Clone safety is identical.**
- Both tools set `cloneOf` in metadata and throw on save attempts.
- `session_save { overwriteSource: true }` in MCP ≡
  `playwright-cli-sessions save <name> --overwrite-source=<source>` in CLI.

**Probe cache is shared.**
- `~/.playwright-sessions/.probe-cache.json` is read/written by both tools.
- A probe run from MCP updates the cache that the CLI's `list` sees, and
  vice versa.

## When to use which

| Prefer CLI | Prefer MCP |
|------------|-----------|
| Scripted workflows, shell pipelines, CI | Multi-turn browser reasoning inside one chat |
| Parallel runs (each invocation is isolated) | Sessions that must stay open across tool calls |
| Inspecting/managing sessions from terminal | Ad-hoc "click this, read that, click again" |
| Token-efficient automation (CLI returns minimal output) | Rich introspection (MCP returns ARIA trees / screenshots inline) |
