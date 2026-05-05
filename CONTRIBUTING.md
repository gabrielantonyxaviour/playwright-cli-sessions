# Contributing to playwright-cli-sessions

Thanks for thinking about contributing. This file is the short version —
read it before opening a PR.

## What this project is (and isn't)

It's a stateless shell CLI on top of Playwright, built primarily for AI
agents (Claude Code, Codex, anything that runs `bash`). Every invocation
is its own process; persistence lives in `~/.playwright-sessions/` and in
the optional attached Chrome started by `browser start`.

It is **not** a general-purpose Playwright wrapper, an MCP server, or a
test runner. If your idea fits one of those shapes better, it probably
belongs in a different project.

## Local development

```bash
git clone https://github.com/gabrielantonyxaviour/playwright-cli-sessions
cd playwright-cli-sessions
npm install
npx playwright install chromium  # one-time, for the scenario harness
npm run build                    # tsc → dist/
npm test                         # runs the scenario harness in tests/scenarios/
```

The scenario harness uses `PLAYWRIGHT_CLI_HEADLESS=1` internally so no
Chrome windows pop during tests. Each scenario gets a sandboxed
`PLAYWRIGHT_SESSIONS_DIR`. To run a single scenario:

```bash
bash tests/run.sh stuck-detector              # one
bash tests/run.sh stuck-detector control-lost # several
VERBOSE=1 bash tests/run.sh screenshot        # full output
```

## Code layout

| Path | What's inside |
|---|---|
| `src/cli.ts` | CLI entry — flag parsing, dispatch, the single error funnel |
| `src/commands/*.ts` | One file per subcommand (`screenshot`, `navigate`, `exec`, `browser`, …) |
| `src/errors.ts` | `PcsError` + every error code's exit code + default `nextSteps` |
| `src/attached-browser*.ts` | Manages the persistent Chrome — local + remote-via-SSH-tunnel |
| `src/usage-log.ts` | Append-only `.usage-log.jsonl` of every invocation |
| `src/stuck-detector.ts` | Reads the log, warns on blind-retry loops |
| `skills/playwright-cli-sessions/` | The bundled skill consumed by Claude Code agents |
| `tests/scenarios/*.sh` | One bash file per scenario; uses `tests/lib/assert.sh` |

## What good PRs look like

- **Focused.** One change per PR. Mixing a refactor with a bug fix makes
  review hard.
- **A scenario test.** If you fix a bug or add a feature, write a scenario
  in `tests/scenarios/`. The existing files are good templates.
- **A useful error.** Every `throw new PcsError(...)` should have a
  message that says what failed AND, if the default isn't sufficient,
  a `nextSteps: string[]` array of concrete actions for the caller.
  Empty stderr on a failure is a CI bug.
- **No silent fallbacks.** If a path can't do what was requested,
  surface the failure — don't quietly downgrade.

## Filing issues

- **Bugs**: open a GitHub issue with the failing command and the full
  stderr block. If you have a `~/.playwright-sessions/.reports/` file
  from `playwright-cli-sessions report`, attaching it is gold.
- **Feature requests**: same place, label them `enhancement` if you can.
  We review monthly.
- **Questions**: GitHub Discussions, not Issues.

## Releasing (maintainers)

1. Bump `package.json` version.
2. `npm run build && npm test`.
3. Commit with `feat(<version>): <summary>`.
4. Tag `v<version>`, push tag.
5. `npm publish`.

The `prepublishOnly` script runs the build automatically; tests must be
green before tagging.

## Code of conduct

Be kind, be specific, be brief. We're all here to ship better tooling.
