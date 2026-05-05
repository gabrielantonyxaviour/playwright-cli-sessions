---
title: "Building a CLI that pushes back when AI agents loop"
published: false
description: "How a 9-minute Codex retry loop led me to build agent-failure-mode awareness directly into a Playwright CLI — next-steps blocks on every error, dedicated browser-control-lost error class, and a stuck-loop detector that fires before the fourth blind retry."
tags: ai, playwright, cli, claudecode
canonical_url:
cover_image:
---

> *TL;DR — A real Codex session burned 9 minutes and 35 invocations stuck in a Playwright retry loop because the CLI's failures didn't tell it what to do next. I rebuilt the failure surface so the third identical error gets a "stop, here's what's actually wrong, here's what to try next" block — and the fourth one gets a `⚠ STUCK LOOP DETECTED` warning. The pattern generalises to any tool an agent drives.*

---

## The 9-minute loop

A few days ago I went back through a Codex CLI rollout log and counted, line by line, where the agent had been stuck. The task was straightforward: open the ETHGlobal Open Agents submission form, fill in some fields, save. The kind of thing a human does in 90 seconds.

Codex took **9 minutes and 35 invocations** of `playwright-cli-sessions navigate` and friends. Most of them were the same command, fired again and again, with cosmetic flag tweaks between each attempt — `--headed`, then without `--session`, then `--channel=chrome`, then `--allow-http-error`. None of those flags addressed the actual problem.

Looking at the JSONL events, here's what happened:

1. **14:21:35** — `browser status` returned exit 1.
2. **14:22:41** — `navigate` failed silently (exit 1, no stderr).
3. **14:25–14:29** — eight more `navigate` attempts, all exit 1, all empty stderr.
4. **14:29:39** — Codex finally noticed it had been on the wrong host the whole time, ran `browser stop && browser start` against the right one, and the very next command worked.

The agent didn't lack capability. It lacked **signal**. Every failure looked identical to every other failure: same exit code, same blank stderr. There was nothing in the CLI's response that distinguished "this is recoverable, try X" from "this is stuck, escape this loop." So Codex tried the only thing it could — slight variations of the same call.

It's not Codex's fault. It's the tool's fault.

---

## What "failure mode awareness" looks like

I'd been chewing on this pattern for a while. AI coding agents have a known failure mode where they spin on a recurring error and burn time. The fix that gets discussed most often is at the model layer — better reasoning, longer planning horizons, "agents should know when to ask for help." Those are real, but they're long-cycle.

What I wanted was the **tool-side** complement. The CLI sits at the failure boundary. If anything has perfect information about the recurring error, it's the CLI itself.

Three things I built into [`playwright-cli-sessions`](https://github.com/gabrielantonyxaviour/playwright-cli-sessions) v0.10.0 to close this loop:

### 1. Every error gets a `next steps:` block

The biggest single fix was killing **empty stderr on failure**. Every error path now prints not just "what went wrong" but "what to try next, in priority order." The error code is the floor; per-call overrides win when there's session-specific context.

```
Error [PCS_AUTH_WALL]: Auth wall detected (login_redirect) at https://...
  details: {"finalUrl":"https://github.com/login","session":"gabriel-platforms",...}
  next steps:
    - The saved session "gabriel-platforms" looks logged out. Run `playwright-cli-sessions refresh gabriel-platforms`.
    - After refreshing, re-run the original command with `--session=gabriel-platforms`.
    - Don't loop: a second identical attempt will fail the same way.
```

Compare to the older form:

```
Error: Navigation timed out (30s)
```

Same information density on the cause. **Wildly** different signal density on what to do.

The implementation is one extra field on the structured error type and one helper at the top-level catch:

```ts
export class PcsError extends Error {
  constructor(
    public readonly code: PcsErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly nextSteps: string[] = [],
  ) {
    super(message);
  }
}

function printNextSteps(code: PcsErrorCode, override: string[]): void {
  const steps = override.length > 0 ? override : DEFAULT_NEXT_STEPS[code];
  if (steps.length === 0) return;
  console.error("  next steps:");
  for (const step of steps) console.error(`    - ${step}`);
}
```

Plus a default-per-code lookup table so even un-overridden throws have a useful next-steps block.

### 2. Tab/window-control loss has its own error class

When the browser disconnects mid-action — Chrome dies, the tab closes, the CDP WebSocket drops — Playwright surfaces this as a regular `Error` with one of a handful of well-known message fragments: `Target page, context or browser has been closed`, `Frame was detached`, `WebSocket is not open`, etc.

The right response to **all** of these is the same: stop, restart the browser once, retry once, then surface the failure to the human. Looping won't fix it.

So I added one more error code, `PCS_BROWSER_CONTROL_LOST` (exit 21), and a string-match step in the top-level catch handler that reclassifies any non-structured error matching a disconnect fragment:

```ts
const BROWSER_CONTROL_LOST_FRAGMENTS = [
  "Target page, context or browser has been closed",
  "Target closed",
  "Browser has been closed",
  "WebSocket is not open",
  "Frame was detached",
  "Protocol error (Page.navigate): Session closed",
  // ...
] as const;

function looksLikeBrowserControlLost(msg: string): boolean {
  return BROWSER_CONTROL_LOST_FRAGMENTS.some((f) => msg.includes(f));
}
```

The next-steps block for this code is explicit:

```
1. Run `browser status` to see the live state.
2. If state is DEAD or missing, run `browser stop` then `browser start`.
3. Retry the original command ONCE.
4. If it fails again, run `report "<what you tried>"` — do not loop.
```

The "ONCE" and "do not loop" are doing real work. They don't *force* the agent to obey, but they remove ambiguity about what the right move is.

### 3. The stuck-loop detector

The above two close the loop on individual errors. But the original 9-minute incident had a deeper problem: even with perfect per-error guidance, the agent might still ignore the advice and retry the same way. So I built one more piece — the CLI itself watches for blind retries.

`playwright-cli-sessions` already maintains an append-only `~/.playwright-sessions/.usage-log.jsonl` of every invocation (cmd, args, exit code, duration, error, who-invoked). The detector just reads the tail:

```ts
export function detectStuckLoop(cmd: string): StuckResult | null {
  if (detectInvocationSource() !== "claude-code") return null;

  const recent = readRecentByCmd(cmd, STUCK_WINDOW_MS, "claude-code");
  if (recent.length < STUCK_THRESHOLD) return null;

  const failures = recent.filter((e) => e.exitCode !== 0);
  // ...group by exitCode, emit warning if any single code dominates...
}
```

When an agent has fired the same command three or more times in five minutes and they've all failed with the same exit code, the next invocation prints this **before** running:

```
⚠ STUCK LOOP DETECTED
  You have run `navigate` 4 times in the last 3 min, all exiting [11].
  Last error: "Navigation timed out (30s) — page never reached load."

  Stop and diagnose before another retry:
    1. playwright-cli-sessions browser status
    2. playwright-cli-sessions browser tabs list
    3. screenshot the URL with --allow-http-error to see what loaded
    4. If still stuck, file `report "<what you tried>"`

  This warning is informational — the command will still run. But if
  you're about to retry the same way again, please don't.
```

Two design choices worth justifying:

- **Advisory, not blocking.** Forcing the agent to stop is the wrong move — sometimes the third retry is exactly right (transient network blip, pending DNS propagation). The warning makes the loop visible without taking the decision away.
- **Agent-only by default.** The detector only fires when invoked by an AI agent (`CLAUDECODE=1` in the environment, in this case). Human users at the terminal don't need to be lectured about their own keystrokes.

The whole detector is around 100 lines, including the formatter. Most of the work was deciding the policy, not implementing it.

---

## Why a CLI, not an MCP server

A reasonable question: *why is this in a CLI rather than @playwright/mcp?* I have a comparison table in the [README](https://github.com/gabrielantonyxaviour/playwright-cli-sessions#comparison) but the short version is that for shell-driven agent workflows, stateless commands in front of one optional persistent Chrome give you trade-offs MCP can't:

| | `@playwright/mcp` | this CLI |
|---|---|---|
| Process model | Long-lived MCP server | Stateless per-command |
| Concurrency | Serialized through stdio | Real shell `&` parallelism |
| Saved auth | In-process | `~/.playwright-sessions/` JSON |
| Multi-session use | One client at a time | N parallel processes share read-only state |
| Best for | Single-agent inside one MCP host | Multi-agent orchestration, CI, anything outside |

They're complementary. The point isn't that one wins; it's that the failure-mode awareness work is independent of which shape you pick.

---

## What this generalises to

I built this for one specific tool, but the pattern is shape-portable to any CLI an agent drives:

1. **Treat empty stderr on failure as a bug, not a fact of life.** Every non-zero exit should say *what* and *what next*.
2. **Reserve a dedicated error class for "I lost control of the thing I'm operating on."** It's distinct from "the operation failed" and the right response is different.
3. **Maintain a usage log.** Not for analytics — for stuck-loop detection. The CLI is the only thing in the system that has a complete view of all recent invocations across a session.
4. **Make the warning advisory.** Block-the-retry is too strong; surface-the-pattern is exactly right.

If you're building tooling that AI agents drive — and at this point, a lot of us are — I'd push you to prototype these. The failure-surface design is at least as load-bearing as the happy-path API. Probably more.

---

`playwright-cli-sessions` is MIT licensed. Repo: [gabrielantonyxaviour/playwright-cli-sessions](https://github.com/gabrielantonyxaviour/playwright-cli-sessions). Issues + Discussions are open. If you spot an empty-stderr failure path I missed, that's worth a `playwright-cli-sessions report "<what happened>"` — it lands in `.reports/` with the last 10 invocations auto-attached as context.
