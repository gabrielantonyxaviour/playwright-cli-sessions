# playwright-cli-sessions — Open-Source Launch Plan

Target version: **v1.0.0**
Target launch window: ~1–2 weeks from today.

**Status as of 2026-05-05:** Phase 1 hygiene is largely DONE. Shipped
v0.10.0 to npm with the fail-loud-fail-useful work (next-steps blocks
on every error, `PCS_BROWSER_CONTROL_LOST`, stuck-loop detector). MIT
LICENSE, CONTRIBUTING.md, GitHub Actions CI, examples/ folder, and the
public-facing README rewrite are all in. What's left is the launch
event itself (Phase 2) — public posts and direct outreach. Those need
your sign-off because they're externally visible and account-bound.

---

## Phase 0 — Decisions (locked in 2026-05-05)

| # | Decision | Status |
|---|---|---|
| 0.1 | License | **MIT** — `LICENSE` file in repo. |
| 0.2 | One-line tagline | "Stateless Playwright CLI for AI agents — one persistent Chrome, zero focus theft." (in README + npm description) |
| 0.3 | Logo / icon | Skipped for v1.0. Text-only README. |
| 0.4 | Community channel | **GitHub Discussions.** Need to enable on the repo via Settings → Features. |
| 0.5 | Docs site | Deferred to v1.1. README + `/docs/` is enough. |
| 0.6 | MCP-fork email outreach | **Still blocked.** `marty` Google session is `[DEAD, 302]`. Run `playwright-cli-sessions refresh marty --url=https://mail.google.com` (one password type) to unblock me; I'll fetch + summarize threads then. |

---

## Phase 1 — Pre-launch hygiene (~3-4 days of focused work)

### 1.1 README rewrite (the most important thing)

Current README is internal-tone. Rewrite for outsiders. Structure:

```
# playwright-cli-sessions

[badge row: npm version, license, scenarios passing, weekly downloads]

[ONE SENTENCE]: A stateless Playwright CLI for AI agents. One persistent
Chrome, parallel-safe sessions, zero focus theft.

[60-SECOND DEMO GIF]: terminal showing `browser start` → 3 parallel
`screenshot` calls → tabs persist → `browser tabs close-all`

## Why?

Playwright MCP keeps Chrome alive but ties you to a long-running stdio
server that fights multi-session work. Vanilla `npx playwright` is
stateless but launches a new Chrome on every call (focus theft, no
session sharing). This CLI gives you both: stateless commands that
attach to ONE persistent Chrome via CDP.

## Quick start

# install
npm install -g playwright-cli-sessions

# launch one Chrome that all subsequent commands attach to
playwright-cli-sessions browser start

# every command opens a tab in that Chrome and leaves it open
playwright-cli-sessions screenshot https://example.com --out=/tmp/x.png
playwright-cli-sessions navigate https://github.com
playwright-cli-sessions exec /tmp/script.mjs

# tear down when you're done
playwright-cli-sessions browser stop

## Comparison

| | vanilla Playwright | @playwright/mcp | playwright-cli-sessions |
|--|--|--|--|
| Stateless commands | ✅ | ❌ | ✅ |
| One persistent Chrome | ❌ | ✅ | ✅ |
| Parallel-safe (`&`) | ✅ | ⚠️ stdio bottleneck | ✅ |
| Saved auth sessions | ❌ | ⚠️ | ✅ |
| Run on remote machine over SSH | ❌ | ❌ | ✅ |
| Built-in usage monitor | ❌ | ❌ | ✅ |

## Architecture

[diagram: single-Mac default + optional Tailscale-routed worker]

## Multi-machine setup (optional)

If you have a dedicated worker Mac (ours is M2 over Tailscale), set
`PLAYWRIGHT_CLI_REMOTE=<ssh-host>`. The CLI SSHes there, runs Chrome
on the remote, and tunnels the CDP port back. Every command transparently
drives the remote Chrome — no flag changes.

Default mode is local. Multi-machine is opt-in.

## Skills for AI agents

Drop the bundled skill into your `.claude/skills/` folder so agents
understand how to use it: `playwright-cli-sessions install --skills`.
```

**Effort: 2-3 hours.**

### 1.2 Single-system messaging (critical for adoption)

The current README de-emphasizes the most common use case (one machine,
local Chrome). Explicit fixes:

- README's **Quick Start** uses zero env vars, zero remote setup.
- The Tailscale/m2worker architecture goes under "Multi-machine setup
  (optional)" — clearly opt-in.
- Add a "Why two Macs?" FAQ entry explaining when to bother.

**Action: rewrite README with single-machine as the primary path.**

### 1.3 Repository hygiene checklist

```
[ ] LICENSE              — MIT (just `npx license-cli init mit "Gabriel Antony Xaviour"`)
[ ] CONTRIBUTING.md      — how to run scenarios, file issues
[ ] CODE_OF_CONDUCT.md   — Contributor Covenant 2.1 (standard)
[ ] CHANGELOG.md         — auto-generate from `git log --tags`
[ ] .github/ISSUE_TEMPLATE/bug.md
[ ] .github/ISSUE_TEMPLATE/feature.md
[ ] .github/PULL_REQUEST_TEMPLATE.md
[ ] .github/workflows/ci.yml — runs `npm run build` + `tests/run.sh`
[ ] Repo description on GitHub (the one-line tagline)
[ ] Repo topics: playwright, cli, ai-agents, claude-code, browser-automation, mcp
[ ] Pin v1.0.0 release on the repo homepage
[ ] Hide the .claude/ directory from cloned repos via .gitignore (already done)
[ ] AGENTS.md → split into AGENTS.md (this repo's dev) and a new docs/AGENTS-FOR-USERS.md (consumer-facing)
```

**Effort: 1 day.**

### 1.4 Examples folder

Create `/examples` with 5-7 self-contained scripts that show off the CLI:

```
examples/
├── 01-quick-screenshot.sh                  — minimal screenshot of public page
├── 02-extract-data-with-exec.mjs           — Playwright API + return JSON
├── 03-otp-autofill-via-gmail.mjs           — Gmail-aware login (with disclaimer)
├── 04-parallel-scraping.sh                 — 5 sites in parallel via &
├── 05-saved-session-replay.sh              — login once, reuse cookies forever
├── 06-multi-machine-tailscale.md           — the worker-Mac setup
└── 07-claude-code-skill-integration.md     — drop the skill in, agents auto-use
```

Each script: 30-50 lines, copy-pasteable, tested.

**Effort: 1 day.**

### 1.5 CI auto-publish

`.github/workflows/release.yml`: on push of a `v*` tag, runs `npm run build`,
runs the scenario suite, publishes to npm. Currently this is manual — error-prone.

Use `JSR_NPM_TOKEN` GitHub Actions secret for auth. Token already exists in the
vault.

**Effort: 1 hour.**

### 1.6 Demo gif / screen recording

A 30-60 second gif showing `browser start` → parallel screenshots →
`browser tabs list` → `monitor report`. Hosted in repo `docs/demo.gif`,
embedded in README.

Tools: `screen` + `gifski` (mac) OR Loom export. Aim for <2MB gif.

**Effort: 30 min.**

---

## Phase 2 — Launch (the public moment)

### 2.1 Tag v1.0.0 on GitHub

Release notes structure (auto-from-CHANGELOG):

```
## v1.0.0 — Stable, opensource-ready

playwright-cli-sessions is a stateless Playwright CLI built for AI agents.
v1.0.0 marks 6 months of internal use across 933+ daily invocations and
is now ready for public adoption.

### What's new since you last looked
- Attached-browser mode (one persistent Chrome, many commands)
- Optional remote routing via Tailscale (any SSH host works)
- Strict no-fallback (refuses local Chrome silently when remote-routed)
- Headful-by-default in attached mode (Google trusts it)
- Tab cap with LRU eviction (5 tabs default)
- Auto-downscale screenshots to 1500px (Anthropic many-image safe)
- Usage monitor (audit bad-usage patterns across all sessions)

### Install
npm install -g playwright-cli-sessions

### Quick start
playwright-cli-sessions browser start
playwright-cli-sessions screenshot https://example.com

### Resources
- README: <link>
- Examples: /examples
- Skill for Claude Code: bundled
```

### 2.2 X/Twitter announcement thread

Updated 6-tweet thread (folds in the v0.10.0 angle — agent-aware
failure semantics, which is the genuinely novel pitch):

```
1/ I built a Playwright CLI specifically for AI agents.
   One persistent Chrome, stateless commands, zero focus theft.
   Alternative shape to @playwrightweb MCP for shell-driven workflows.
   [demo gif]
   github.com/gabrielantonyxaviour/playwright-cli-sessions

2/ Two problems with the alternatives:
   • Vanilla `npx playwright` → fresh Chrome window per call. Focus theft.
     2-second cold start. Profile contamination across runs.
   • MCP servers → fix the cold start, but stdio bottleneck breaks
     real shell parallelism, and you've got a process to babysit.

3/ The fix: stateless CLI in front of one optional persistent Chrome
   that all commands attach to via CDP. Persistent profile (Google
   trusts it). True shell `&` parallelism — invocations don't coordinate.
   Saved logins are read-only JSON files; N parallel processes share them.

4/ The part I haven't seen elsewhere: the CLI knows about agent
   failure modes. v0.10.0 watches `~/.playwright-sessions/.usage-log.jsonl`
   and prints `⚠ STUCK LOOP DETECTED` to stderr when the same command
   has failed 3x in 5 min. Saves you from agents burning 9 minutes on
   blind retry loops (real story behind why I built this).

5/ Every error prints a `next steps:` block tailored to the failure
   code. Tab/window-control loss has its own class
   (PCS_BROWSER_CONTROL_LOST, exit 21) with a "restart once, retry once,
   then report — don't loop" doctrine. Empty stderr is treated as
   a CLI bug, not something you tolerate.

6/ Bonus: optional remote routing. Set $PLAYWRIGHT_CLI_REMOTE to any SSH
   alias and Chrome runs there, commands tunnel transparently — keep
   your daily-driver Mac clean. Try it:
   `npx playwright-cli-sessions browser start`
```

Tag: `@playwrightweb @AnthropicAI @claudeai`. Best window: Tuesday-Thursday
9-11am PT.

### 2.3 Hacker News (Show HN)

**Updated title (the v0.10.0 angle is genuinely fresh):**
`Show HN: A Playwright CLI that watches for blind-retry loops in AI agent sessions`

Alternative title (broader): `Show HN: Stateless Playwright CLI for AI agents (alternative to MCP)`

First comment from you (full draft in `docs/outreach-drafts.md`):

> Hi HN — author here. Built this after watching enough Codex / Claude Code
> sessions burn 8-10 minutes stuck retrying the same Playwright command
> with cosmetic flag tweaks. The CLI itself now watches the usage log and
> prints a STUCK LOOP DETECTED warning before the fourth blind retry —
> hopefully the first of many tools that build agent-failure-mode
> awareness in directly. Happy to talk about the design tradeoffs vs
> Playwright MCP. AMA.

Best window: Tuesday-Thursday 8-10am EST. Be online for first 2 hours
to answer questions.

### 2.4 Reddit posts (different angle each)

| Sub | Angle |
|---|---|
| r/MachineLearning | "Tooling for LLM agents to drive a real browser" |
| r/LocalLLaMA | "Playwright integration for self-hosted Claude Code workflows" |
| r/SideProject | "6 months of dogfooding led to v1.0" |
| r/ClaudeAI | "Drop-in skill that lets Claude Code use real browsers safely" |
| r/typescript | "TypeScript CLI that wraps Playwright with stateful auth + CDP" |
| r/webscraping | "Playwright for scraping with shared persistent profiles" |

Don't crosspost — write each one for the sub. Spread across 3 days.

### 2.5 Dev.to / Hashnode article

Title: **"Why I Built a Playwright CLI Instead of Using MCP"**

Outline:
1. The setup: Claude Code agents drive browsers. We tried Playwright MCP.
2. Two problems we hit: stdio bottleneck, profile contamination across sessions.
3. The realization: stateless CLI + persistent attached Chrome = best of both.
4. Implementation highlights: CDP attach, SSH-tunnel remote routing, tab cap.
5. 6 months of dogfooding numbers (933 invocations / week, 17% error rate
   that's mostly intentional verify-throws).
6. v1.0.0 — try it today.

1500-2000 words. Cross-post to Medium too.

### 2.6 Awesome lists (PRs)

Submit PRs to add `playwright-cli-sessions` to:
- awesome-playwright (`https://github.com/mxschmitt/awesome-playwright`)
- awesome-llm-tools (search GitHub for the most active)
- awesome-claude-code (if it exists; create one if not — be the first)

### 2.7 Direct outreach

People who emailed about the MCP fork:
- Step 1: Re-auth Gabriel's Gmail (`refresh marty --url=https://mail.google.com`)
- Step 2: I'll fetch the threads, list senders + topics
- Step 3: For each thread, draft a reply: "We tried that route, here's what
  we ended up with — [link to v1.0]. Curious if it covers your case."

---

## Phase 3 — Post-launch (week 1-4)

### 3.1 Issue triage SLA
- **Bugs**: respond within 48h
- **Feature requests**: monthly review, label as `consideration`
- **Questions**: GitHub Discussions, not Issues

### 3.2 Release cadence
- **Patches**: as needed (security, regressions)
- **Minors**: monthly
- **Majors**: require RFC issue + 2-week comment window

### 3.3 Documentation site (deferred to v1.1)
If issues volume warrants it:
- Astro Starlight or Mintlify
- Pages: Quick Start / API Reference / Skills / Examples / Architecture
- Hosted at `playwright-cli-sessions.dev` (~$10/yr) or `gabrielantonyxaviour.github.io/playwright-cli-sessions`

### 3.4 Community feedback loop
- Auto-post weekly digest of monitor output (anonymized) to a public
  GitHub Discussions thread → community spots emergent patterns we missed.

---

## Single-system vs Multi-system clarity (must be loud in v1.0)

The current architecture defaults to **single-system mode** but the
docs/skill currently lean heavily on the M2-worker setup we built. For v1.0:

**Default (no setup required):**
```
npm install -g playwright-cli-sessions
playwright-cli-sessions browser start    # opens Chrome locally
playwright-cli-sessions screenshot ...   # uses that Chrome
```

**Optional advanced (multi-machine via Tailscale or any SSH host):**
```
# on dev machine:
export PLAYWRIGHT_CLI_REMOTE=worker-host  # SSH alias to your worker
playwright-cli-sessions browser start    # routes to worker over SSH tunnel
playwright-cli-sessions screenshot ...   # transparently driven on worker
```

README must lead with the single-machine path. The Tailscale variant
becomes "advanced" / "optional". Otherwise readers will look at the docs,
think they need a separate Mac, and bounce.

---

## Risk register (things that could go wrong)

| Risk | Mitigation |
|---|---|
| Microsoft / Playwright team feels stepped-on | Open with "alternative for X use case", not "replacement" |
| HN front page → traffic → broken installs | Make sure CI publish works end-to-end before posting |
| Bug reports flood from new users | Issue templates + 48h SLA + GitHub Discussions for non-bugs |
| Someone clones it and rebrands | MIT license already permits this. Don't worry about it. |
| Anthropic asks why we built this for Claude specifically | Answer: skill bundling integration. The CLI works for any tool that runs shell commands. |

---

## My recommended prioritization

If you only have time for the absolute minimum before going public:

1. **README rewrite** (Phase 1.1) — must
2. **LICENSE + CONTRIBUTING** (Phase 1.3 essentials) — must
3. **CI** (Phase 1.5) — must
4. **Demo gif** (Phase 1.6) — strongly recommended
5. **Examples folder** (Phase 1.4) — strongly recommended
6. **Tag v1.0.0** (Phase 2.1) — must
7. **Hacker News + X thread** (Phase 2.2 + 2.3) — high impact, do same day
8. **Reddit + dev.to** (Phase 2.4 + 2.5) — over the following week
9. **Awesome lists** (Phase 2.6) — passive long-tail
10. **Direct outreach to MCP-fork email senders** (Phase 2.7) — needs Gmail re-auth

Skip for v1.0, ship later: docs site, Discord, contributor program, sponsors.

---

## Total time estimate

**Phase 1 (pre-launch hygiene)**: 3-4 focused days (10-15 hours total).
**Phase 2 (launch day)**: 1 day all hands.
**Phase 3 (post-launch)**: 5-10 hours/week ongoing.

Comfortable launch window: **2 weeks from today**. Aggressive: **1 week**.

---

## Things I need from you to proceed

1. Confirm license = **MIT**? (default recommendation)
2. Re-auth Gabriel's Google account in the attached Chrome so I can read the MCP-fork emails:
   ```
   playwright-cli-sessions refresh marty --url=https://mail.google.com
   ```
3. Confirm tagline: **"Stateless Playwright CLI for AI agents — one persistent Chrome, zero focus theft."** or send a different one.
4. Pick a target launch date.

Once those are confirmed, I'll execute Phase 1 (README rewrite, LICENSE,
CI, examples) directly without further check-ins, then ping you for
Phase 2 sign-off.
