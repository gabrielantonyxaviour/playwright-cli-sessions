# Examples

Real-world recipes. Every example is a self-contained shell or `.mjs`
file you can run as-is once `playwright-cli-sessions` is installed.

| File | What it shows |
|---|---|
| [`01-stateless-screenshot.sh`](./01-stateless-screenshot.sh) | One-liner — screenshot a public page, no setup. |
| [`02-parallel-screenshots.sh`](./02-parallel-screenshots.sh) | Five URLs captured in parallel via shell `&`. Linear scaling, no MCP coordination. |
| [`03-attached-mode-tab-reuse.sh`](./03-attached-mode-tab-reuse.sh) | `browser start` once → many commands open tabs in the same Chrome. |
| [`04-exec-script-extract-data.mjs`](./04-exec-script-extract-data.mjs) | Full Playwright API in a script — navigate, locate, return JSON to stdout. |
| [`05-saved-session-flow.sh`](./05-saved-session-flow.sh) | First-time `login` → reuse session via `--session=<name>` for authed work. |
| [`06-expect-as-shell-assertion.sh`](./06-expect-as-shell-assertion.sh) | Use `expect` to assert page state in CI — exits non-zero with structured diagnostics on failure. |
| [`07-stuck-loop-recovery.mjs`](./07-stuck-loop-recovery.mjs) | When the CLI prints `STUCK LOOP DETECTED`, here's what an agent should actually do. |

## Running

Most examples assume the package is installed:

```bash
npm install -g playwright-cli-sessions
npx playwright install chromium    # one-time
```

For the attached-mode examples, you need a Chrome that the CLI can
attach to. The first command starts it:

```bash
playwright-cli-sessions browser start
```

When you're done for the day:

```bash
playwright-cli-sessions browser stop
```

That's the whole lifecycle.
