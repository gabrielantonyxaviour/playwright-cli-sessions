# Outreach drafts

Every public post is in this file as a ready-to-paste draft. Nothing has
been sent. Review, edit, then fire when you're ready.

URLs you'll paste in:

- npm: `https://www.npmjs.com/package/playwright-cli-sessions`
- GitHub: `https://github.com/gabrielantonyxaviour/playwright-cli-sessions`
- Examples: `https://github.com/gabrielantonyxaviour/playwright-cli-sessions/tree/main/examples`
- Skill: `https://github.com/gabrielantonyxaviour/playwright-cli-sessions/blob/main/skills/playwright-cli-sessions/SKILL.md`

---

## 1. microsoft/playwright-mcp issue comments

Tone rule: **be helpful, link relevant CLI doc/section, leave it.** Never
"check out my package" — that gets flagged as spam. Frame as "we hit the
same problem and ended up shipping X — happy if it helps." If the MS
maintainers want to fix the issue in their own repo, great; we just
contributed signal.

### 1.1 → microsoft/playwright-mcp#1588 — "CDP endpoint: auto-recover on remote browser disconnect"

```
We hit this exact pattern enough that we ended up classifying it as
its own error code in our (unrelated) Playwright CLI sibling project,
playwright-cli-sessions: `PCS_BROWSER_CONTROL_LOST` (exit 21) fires
when a Playwright operation surfaces any of "Target closed", "Frame was
detached", "Browser has been closed", "WebSocket is not open", etc.

Two things that helped us live with it:

1. Reclassifying these strings into one error code with a tailored
   "stop, restart browser once, retry once, then surface — don't loop"
   next-steps block. The string-match list lives in
   https://github.com/gabrielantonyxaviour/playwright-cli-sessions/blob/main/src/cli.ts
   if it's useful as a starting point for #1588.

2. Adding a stuck-loop detector that watches the usage log and prints
   a warning on the 3rd identical failure in 5 minutes — agents will
   loop on a control-lost error indefinitely otherwise.

Auto-recover would be the better long-term fix; in the meantime,
predictable failure semantics + a "give up after N" signal at least
stop the loop.
```

### 1.2 → microsoft/playwright-mcp#1382 — "Using MCP agent to observe Playwright debug browser session"

```
For anyone who wants the inverse pattern (agent attaches to a Chrome
that an existing Playwright run is using, observes / scripts on top of
it without owning the browser lifecycle), the CDP `connectOverCDP`
approach we use in playwright-cli-sessions might be a useful reference:
launch Chrome separately with --remote-debugging-port and let the agent
connect into it as a peer. Code:
https://github.com/gabrielantonyxaviour/playwright-cli-sessions/blob/main/src/attached-browser.ts

Not a direct answer to #1382 but covers the "observe without owning"
case if that's what people are reaching for.
```

### 1.3 → microsoft/playwright-mcp#1280 — "fill operation differs when using --save-session"

```
Tangentially related: we hit similar correctness questions around
storageState / cookie restoration vs. live profile state. Our take
(in playwright-cli-sessions) was to make `--session=<name>` always
create an isolated context (`browser.newContext({ storageState })`)
rather than touch the persistent profile, so saved-session behaviour
is deterministic per-call and doesn't drift. The persistent profile
is its own context, used only when no `--session` is passed. That
boundary made the divergent-fill class of bugs go away for us; might
be worth a similar split here.
```

### 1.4 → microsoft/playwright-mcp#1571 — "Bridge extension stays 'No MCP clients are currently connected'"

```
If anyone here is hitting this hard enough to need a workaround in the
meantime, we ship an alternative shape (playwright-cli-sessions) that
manages a single dedicated Chrome via plain `--remote-debugging-port`
+ CDP — no extension, no client connection state to lose. Same usage
shape (one persistent Chrome, many commands) without the bridge.
Repo: https://github.com/gabrielantonyxaviour/playwright-cli-sessions
Caveat: it's a CLI, not an MCP server, so it doesn't slot into the
same MCP-host workflow as @playwright/mcp.
```

---

## 2. Hacker News — Show HN

**Title:** `Show HN: A Playwright CLI that watches for blind-retry loops in AI agent sessions`

**Body:**

```
Hi HN — I built playwright-cli-sessions because I was watching too many
Claude Code and Codex sessions waste 8-10 minutes stuck retrying the
same Playwright command with cosmetic flag tweaks, getting nowhere,
and not realizing it.

The shape: a stateless shell CLI in front of one optional persistent
Chrome that every command attaches to via CDP. Saved logins live in
~/.playwright-sessions/ as plain JSON files (read-only from the CLI's
perspective, so N parallel processes share them safely). Different
trade-offs from @playwright/mcp — see the comparison table in the README.

The part I haven't seen elsewhere: every error code carries a
`next steps:` block tailored to the failure, and the CLI watches its
own usage log and prints `⚠ STUCK LOOP DETECTED` when an agent has
fired the same failing command 3 times in 5 minutes. Tab/window-control
loss has its own error class with a "restart once, retry once, then
report — don't loop" doctrine. Empty stderr on a failure is treated as
a CLI bug.

GitHub: https://github.com/gabrielantonyxaviour/playwright-cli-sessions
npm: https://www.npmjs.com/package/playwright-cli-sessions

Happy to talk about the trade-offs vs MCP, why the stuck-loop detector
is advisory rather than blocking, the saved-session interop with the
playwright-sessions MCP, or the optional remote-routing over SSH for
people who run Chrome on a dedicated host. AMA.
```

Best window: Tuesday-Thursday 8-10am EST. Be online for the first 2
hours to answer questions.

---

## 3. X/Twitter announcement thread

(Same as docs/LAUNCH-PLAN.md §2.2 — the 6-tweet thread. Reproduced
here so it's all in one place for editing.)

```
1/ I built a Playwright CLI specifically for AI agents.
One persistent Chrome, stateless commands, zero focus theft.
Alternative shape to @playwrightweb MCP for shell-driven workflows.
github.com/gabrielantonyxaviour/playwright-cli-sessions

2/ Two problems with the alternatives:
• Vanilla `npx playwright` → fresh Chrome window per call. Focus theft.
  2-second cold start. Profile contamination across runs.
• MCP servers → fix the cold start, but stdio bottleneck breaks real
  shell parallelism, and you've got a process to babysit.

3/ The fix: stateless CLI in front of one optional persistent Chrome
that all commands attach to via CDP. Persistent profile (Google trusts
it). True shell `&` parallelism. Saved logins are read-only JSON files;
N parallel processes share them.

4/ The part I haven't seen elsewhere: the CLI knows about agent failure
modes. v0.10.0 watches the usage log and prints `⚠ STUCK LOOP DETECTED`
when the same command has failed 3x in 5 min — saves agents from burning
9 minutes on blind retry loops.

5/ Every error prints a `next steps:` block tailored to the failure.
Tab/window-control loss has its own class
(PCS_BROWSER_CONTROL_LOST, exit 21) with "restart once, retry once,
then report — don't loop" doctrine. Empty stderr = treated as a CLI bug.

6/ Bonus: optional remote routing. Set $PLAYWRIGHT_CLI_REMOTE to any SSH
alias and Chrome runs there, commands tunnel transparently — keep your
daily-driver clean. Try it:
`npx playwright-cli-sessions browser start`
```

Tags: `@playwrightweb @AnthropicAI @claudeai`. Best window: Tue-Thu
9-11am PT.

---

## 4. Reddit posts (six subs, one angle each)

Don't crosspost identical text. Spread over 3 days so a) you're not
spammy and b) you can answer comments on each.

### 4.1 r/MachineLearning — "Tooling for LLM agents to drive a real browser"

```
Built a stateless Playwright CLI specifically with LLM agent workflows
in mind. The angle most agent-tooling skips: failure semantics. Every
error prints a `next steps:` block; the CLI watches its own usage log
and warns on blind-retry loops; tab-control loss has its own error
class with a "don't loop" doctrine. Curious whether folks here have
seen this kind of agent-aware tooling elsewhere — feels like an
underexplored space.

GitHub: https://github.com/gabrielantonyxaviour/playwright-cli-sessions
```

### 4.2 r/LocalLLaMA — "Playwright integration for self-hosted Claude Code workflows"

```
For folks running Claude Code (or Codex, or anything that drives bash)
locally and wanting browser automation: playwright-cli-sessions is a
shell-first CLI on top of Playwright. One persistent Chrome via CDP,
saved-session JSON in ~/.playwright-sessions/ that survives between
runs, optional remote-routing over SSH if you've got a separate Mac
mini for it. Bundled Claude Code skill that teaches the agent the
operating posture (don't punt browser tasks back to the user, follow
the diagnostic ladder when stuck).

Repo: https://github.com/gabrielantonyxaviour/playwright-cli-sessions
npm: https://www.npmjs.com/package/playwright-cli-sessions
```

### 4.3 r/SideProject — "6 months of dogfooding led to v1.0"

```
Quietly built playwright-cli-sessions over the last 6 months while
using it daily to drive ~900 Playwright invocations/week. Just hit
the polish I'm comfortable putting in front of strangers. The thing
I'm proudest of (built last week): the CLI watches its own usage log
and warns when an agent session is stuck in a blind-retry loop. Came
from watching myself / my AI agent waste 9 minutes on the exact
problem.

If you're building agent tooling, this is the only "feature" I built
that's never showed up in any framework review. Curious whether anyone
else has gone after agent-aware error semantics like this.

https://github.com/gabrielantonyxaviour/playwright-cli-sessions
```

### 4.4 r/ClaudeAI — "Drop-in skill that lets Claude Code use real browsers safely"

```
Skill bundle for Claude Code that's been my daily-driver browser path
for 6 months. Three things it does that the default Playwright MCP
doesn't:

1. Stateless per-command (no long-running server to babysit; agents
   can fire 5 in parallel via shell `&`).
2. One persistent Chrome they all attach to (no window pops, profile
   persists, Google trusts it).
3. Built-in stuck-loop detector — when the agent has fired the same
   failing command 3 times, the CLI prints a warning before the next
   blind retry. Solves the "Claude wasted 8 minutes in a loop" failure
   mode I was hitting weekly.

`npm install -g playwright-cli-sessions && playwright-cli-sessions install --skills`

https://github.com/gabrielantonyxaviour/playwright-cli-sessions
```

### 4.5 r/typescript — "TypeScript CLI that wraps Playwright with stateful auth + CDP"

```
Posting because the design might be interesting to other CLI authors:
playwright-cli-sessions is fully TypeScript, ships as a single npm
package, and the architecture is "stateless commands in front of an
optional persistent process." Type-safe error codes (every PcsError has
a code + exit code + nextSteps tuple), Levenshtein flag-suggestion when
you typo a flag, scenario-based test harness in bash that exercises
every command end-to-end against the compiled CLI.

If you're curious about the trade-offs of "shared filesystem state for
parallel-safe command sharing" — that's the load-bearing pattern.

Repo: https://github.com/gabrielantonyxaviour/playwright-cli-sessions
```

### 4.6 r/webscraping — "Playwright for scraping with shared persistent profiles"

```
Built playwright-cli-sessions partly because vanilla Playwright +
storageState replay is brittle once you have 10+ services with
different auth lifetimes. This CLI gives you `list` (live HTTP probe
of every saved session), `refresh` (re-login one), `clone` (so you
don't burn the canonical session experimenting), and an attached
persistent Chrome so cookies that depend on a long-lived profile
(Google, anything with bot-fingerprinting) actually work. CDP-attached
mode means scrape commands open tabs in one Chrome instead of cold-
starting 50 of them.

Fair-use only — code's MIT, but use it on services whose ToS you've
read.

Repo: https://github.com/gabrielantonyxaviour/playwright-cli-sessions
```

---

## 5. dev.to / Hashnode article

**Title:** `Building a CLI that pushes back when AI agents loop`

**Outline (1500-2000 words):**

1. **The 9-minute loop.** Real story: a Codex session on 2026-05-03
   burned 9 minutes / 35 invocations stuck retrying the same Playwright
   command. Show the actual log analysis. Make it concrete.
2. **Why agents loop.** Empty stderr = no diagnostic signal. Same
   command + same error = retry with cosmetic tweak. No "you've been
   here before" feedback. This is a design-of-tools problem, not a
   model problem.
3. **The fix in three pieces:**
   - `next steps:` block on every error (no silent failures)
   - `PCS_BROWSER_CONTROL_LOST` for tab/window-control loss specifically
   - Stuck-loop detector that watches the usage log and warns on
     the 3rd identical failure in 5 minutes.
4. **Implementation: stuck-loop detection in <100 lines.** Show the
   actual `src/stuck-detector.ts`. Discuss why it's advisory, not
   blocking.
5. **Why CLI not MCP.** Trade-offs section. Stateless commands +
   persistent Chrome via CDP gives shell-level parallelism MCP can't
   match.
6. **6 months of dogfooding numbers.** ~900 invocations/week, error
   rates, what fraction are intentional verify-throws vs. real bugs.
7. **v1.0.0 — try it.** Quick start + CTA.

Cross-post to Medium too. Submit to /r/programming (different angle
again — "show me your tool design" rather than "show me your repo").

---

## 6. awesome-list PRs

Three PRs to file (one per repo). Each is a single-line addition.

### 6.1 → mxschmitt/awesome-playwright

Add under "Tools" section:

```markdown
- [playwright-cli-sessions](https://github.com/gabrielantonyxaviour/playwright-cli-sessions) — Stateless Playwright CLI for AI agents. One persistent Chrome via CDP, saved logins, agent-aware failure semantics (next-steps blocks on every error, stuck-loop detector).
```

PR description:

```
playwright-cli-sessions is a shell-first wrapper on top of Playwright,
designed for the way AI agents work — stateless per-command, one
optional persistent Chrome they all attach to via CDP. v0.10.0 ships
with agent-aware failure semantics that I think are genuinely novel
in this space (every error has a `next steps:` block; the CLI watches
its own usage log and warns on blind-retry loops). Six months of
internal use, MIT licensed, full scenario test suite. Happy to refine
the description if it doesn't fit your style guide.
```

### 6.2 → awesome-llm-tools (find the most active fork; example: awesome-claude-code)

Same blurb, scoped to LLM tooling angle:

```markdown
- [playwright-cli-sessions](https://github.com/gabrielantonyxaviour/playwright-cli-sessions) — Browser automation CLI for LLM agents. Built-in stuck-loop detection, tailored next-steps on every error, drop-in Claude Code skill. Alternative shape to Playwright MCP for shell-driven workflows.
```

### 6.3 → awesome-claude-code (or hesreallyhim/awesome-claude-code if it exists)

Even more focused:

```markdown
- [playwright-cli-sessions](https://github.com/gabrielantonyxaviour/playwright-cli-sessions) — Bundled skill that teaches Claude Code to drive a real browser via a shell CLI: persistent Chrome, saved logins, optional SSH-tunnel routing to a worker host, time-budget doctrine baked into the skill itself.
```

---

## 7. Direct outreach to MCP-fork email senders (BLOCKED)

`marty` Google session is `[DEAD, 302]`. To unblock:

```bash
playwright-cli-sessions browser start
playwright-cli-sessions refresh marty --url=https://mail.google.com
# (Type Google password once when the window opens.)
```

After that I can:
1. Search threads for "playwright" / "MCP" / "fork" / specific senders.
2. Summarize who reached out, what they said, what they wanted.
3. Draft per-sender replies pointing them at v0.10.0 with personalised
   framing ("you mentioned X — here's how that's handled in v0.10.0").

Until the session is live, this section is parked.
