# DevTools Parity — extension proposal

Goal: make `playwright-cli-sessions` a strict superset of what Chrome DevTools MCP provides, so we never need to install a DevTools MCP server. Keep the CLI-first philosophy: every new capability is a subcommand you invoke once, no persistent server.

## Gap analysis

What Chrome DevTools MCP does that the CLI currently doesn't have as a one-shot:

| MCP tool | Current CLI status | Proposed command |
|---|---|---|
| `list_console_messages` | doable via `exec` script | `console <url>` |
| `list_network_requests` | doable via `exec` script | `network <url>` |
| `run_performance_audit` (Lighthouse) | not available | `lighthouse <url>` |
| `performance_*` (trace, sample) | not available | `trace <url>` |
| `emulate_cpu` / `emulate_network` | partial (Playwright supports) | `--cpu-throttle`, `--network` flags on nav/screenshot |
| `evaluate_script` | doable via `exec` | `eval <url> <js>` |
| `take_screenshot` | ✅ exists | — |
| `take_snapshot` (ARIA) | ✅ exists (`snapshot`) | — |
| `list_pages` / tabs | not applicable (single browser) | — |
| `click`, `fill`, `hover`, `drag` | doable via `exec` | low priority — use `exec` |
| Form input, dialog handling | doable via `exec` | low priority |
| `wait_for` | partial (`--wait-for` flag exists) | — |

## Proposed new commands

### 1. `console <url>` — dump console messages
```
npx playwright-cli-sessions console https://example.com \
  --wait-for="#app" \
  --duration=5 \
  [--session=<name>]
```
Output: JSON array of `{level, text, url, line, timestamp}`. Navigates, waits, captures `page.on('console')` for `duration` seconds, exits.

### 2. `network <url>` — dump network requests
```
npx playwright-cli-sessions network https://example.com \
  --filter="api|graphql" \
  --har=/tmp/capture.har \
  [--session=<name>]
```
Output: JSON array of `{method, url, status, duration, resourceType, size}`. Optional HAR export via `--har`.

### 3. `lighthouse <url>` — Core Web Vitals + performance audit
```
npx playwright-cli-sessions lighthouse https://example.com \
  --categories=performance,accessibility,best-practices,seo \
  --form-factor=mobile|desktop \
  [--session=<name>]
```
Output: JSON with category scores + key metrics (LCP, CLS, INP, TTFB, Speed Index). Uses `lighthouse` npm package under the hood.

### 4. `trace <url>` — performance trace
```
npx playwright-cli-sessions trace https://example.com \
  --output=/tmp/trace.json \
  --duration=10 \
  [--session=<name>]
```
Output: Chrome tracing format JSON (loadable into `chrome://tracing` or Perfetto). Uses Playwright's `context.tracing.start` + export.

### 5. `eval <url> <expression>` — evaluate JS in page context
```
npx playwright-cli-sessions eval https://example.com \
  "document.querySelectorAll('.card').length" \
  [--session=<name>]
```
Output: JSON of the evaluation result. Shorter than writing a full `exec` script for one-liners.

### 6. `axe <url>` — accessibility audit
```
npx playwright-cli-sessions axe https://example.com \
  --tags=wcag2a,wcag2aa \
  [--session=<name>]
```
Output: JSON violations from `axe-core`. Uses `@axe-core/playwright`.

### 7. Flags to add to existing commands
- `--cpu-throttle <n>` — CPU slowdown factor (4× = old mobile)
- `--network <profile>` — `3g`, `4g`, `offline`, or custom `{down,up,latency}`
- `--user-agent <string>` — override UA
- `--viewport <WxH>` — set viewport

Apply to: `screenshot`, `snapshot`, `navigate`, `console`, `network`, `lighthouse`.

## Implementation notes

- All commands follow the existing command file pattern in `src/commands/`.
- Shared orchestration (launch browser → nav → wait → capture → exit) factors into a `browser-run.ts` helper — currently `browser-launch.ts` handles launch; extend.
- Reuse `session-use.ts` for `--session` hydration.
- `lighthouse`, `axe` add new peer dependencies — gate behind `optionalDependencies` so they only install when used, keeps core lean.
- JSON output on stdout, logs on stderr. Consistent with existing commands.

## Dependencies to add
- `lighthouse` (MIT) — ~40 MB, move to optionalDependencies
- `@axe-core/playwright` (MPL-2.0) — lightweight

## Out of scope
- Persistent DevTools protocol session (no MCP server). Every command is one-shot.
- DOM manipulation beyond `eval` (use `exec` scripts for complex flows).
- Multi-tab / multi-page orchestration (single page per run).

## Priority order (if implementing incrementally)
1. `lighthouse` — biggest gap, most common use case
2. `console` — cheap and universally useful for debugging
3. `network` + HAR export
4. `eval` — convenience for one-liners
5. `axe` — ship before every user-facing release
6. `trace` — rarely needed but high value when needed
7. throttle / emulation flags

## Non-goals
- Competing with headless CDP clients for deep protocol access — Playwright's API is the ceiling.
- Becoming a general-purpose web-scraping tool.

---

Once implemented, delete this file and update the main `README.md` command reference.
