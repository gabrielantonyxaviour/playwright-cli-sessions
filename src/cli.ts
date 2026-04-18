#!/usr/bin/env node
/**
 * playwright-cli-sessions — session management layer for @playwright/cli
 *
 * Provides named saved logins, service probes, clone safety, and browser
 * automation on top of @playwright/cli. Reads/writes ~/.playwright-sessions/ —
 * fully interoperable with the playwright-sessions MCP.
 *
 * Usage:
 *   playwright-cli-sessions list [--probe=false] [--json]
 *   playwright-cli-sessions save <name>
 *   playwright-cli-sessions restore <name> [--out=<path>]
 *   playwright-cli-sessions clone <source> <newName>
 *   playwright-cli-sessions tag <name> <service> [identity]
 *   playwright-cli-sessions delete <name>
 *   playwright-cli-sessions probe <name> [--service=X]
 *   playwright-cli-sessions install --skills
 *   playwright-cli-sessions health
 *   playwright-cli-sessions screenshot <url> [--session=<name>] [--out=<path>] [--headed] [--channel=<channel>] [--wait-for=<selector>] [--wait-until=<event>] [--full-page]
 *   playwright-cli-sessions navigate <url> [--session=<name>] [--snapshot] [--headed] [--channel=<channel>] [--wait-for=<selector>] [--wait-until=<event>]
 *   playwright-cli-sessions snapshot <url> [--session=<name>] [--headed] [--channel=<channel>] [--wait-for=<selector>] [--wait-until=<event>]
 *   playwright-cli-sessions exec <script> [<url>] [--session=<name>] [--headed] [--channel=<channel>] [--wait-for=<selector>] [--wait-until=<event>]
 *   playwright-cli-sessions login <url> [--session=<name>] [--channel=<channel>]
 *   playwright-cli-sessions refresh <name> [--url=<url>] [--channel=<channel>]
 *   playwright-cli-sessions expect <url> [--title=<substr>] [--selector=<sel>] [--text=<substr>] [--status=<code>] [--session=<name>] [--timeout=<ms>] [--retry=<N>] [--screenshot-on-fail=<path>] [--headed] [--channel=<channel>] [--wait-for=<selector>] [--wait-until=<event>]
 *   playwright-cli-sessions report "<message>" [--context=<N>] [--no-notify]
 *   playwright-cli-sessions reports [--limit=<N>] [--json]
 */

import { logUsage } from "./usage-log.js";
import { cmdList } from "./commands/list.js";
import { cmdSave } from "./commands/save.js";
import { cmdRestore } from "./commands/restore.js";
import { cmdClone } from "./commands/clone.js";
import { cmdTag } from "./commands/tag.js";
import { cmdDelete } from "./commands/delete.js";
import { cmdProbe } from "./commands/probe.js";
import { cmdInstall } from "./commands/install.js";
import { cmdHealth } from "./commands/health.js";
import { cmdScreenshot } from "./commands/screenshot.js";
import { cmdNavigate } from "./commands/navigate.js";
import { cmdSnapshot } from "./commands/snapshot.js";
import { cmdExec } from "./commands/exec.js";
import { cmdLogin } from "./commands/login.js";
import { cmdRefresh } from "./commands/refresh.js";
import { cmdReport, cmdReports } from "./commands/report.js";
import { cmdExpect } from "./commands/expect.js";
import { PcsError, EXIT_CODE_MAP } from "./errors.js";
import { levenshtein } from "./levenshtein.js";

const args = process.argv.slice(2);

function parseFlags(argv: string[]): {
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        flags[arg.slice(2)] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

// Per-command accepted flag names — used for unknown-flag rejection.
const COMMAND_FLAGS: Record<string, string[]> = {
  list: ["probe", "json"],
  save: [],
  restore: ["out"],
  clone: ["overwrite-source"],
  tag: [],
  delete: [],
  probe: ["service"],
  install: ["skills"],
  health: [],
  screenshot: [
    "session",
    "out",
    "headed",
    "channel",
    "wait-for",
    "wait-until",
    "full-page",
    "no-probe",
  ],
  navigate: [
    "session",
    "snapshot",
    "headed",
    "channel",
    "wait-for",
    "wait-until",
    "no-probe",
  ],
  snapshot: [
    "session",
    "headed",
    "channel",
    "wait-for",
    "wait-until",
    "no-probe",
  ],
  exec: [
    "session",
    "url",
    "headed",
    "channel",
    "wait-for",
    "wait-until",
    "no-probe",
  ],
  login: ["session", "channel"],
  refresh: ["url", "channel"],
  expect: [
    "title",
    "selector",
    "text",
    "status",
    "timeout",
    "retry",
    "session",
    "channel",
    "wait-for",
    "wait-until",
    "screenshot-on-fail",
    "headed",
    "no-probe",
  ],
  report: ["context", "no-notify"],
  reports: ["limit", "json"],
};

/** Return the closest known flag if within edit-distance 2, else undefined. */
function suggestFlag(unknown: string, known: string[]): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const k of known) {
    const d = levenshtein(unknown, k);
    if (d < bestDist) {
      bestDist = d;
      best = k;
    }
  }
  return bestDist <= 2 ? best : undefined;
}

/** Throw PcsError(PCS_INVALID_FLAG) for any flag not in the whitelist. */
function validateFlags(
  command: string,
  flags: Record<string, string | boolean>,
  whitelist: string[],
): void {
  for (const flag of Object.keys(flags)) {
    if (!whitelist.includes(flag)) {
      const suggestion = suggestFlag(flag, whitelist);
      const msg = suggestion
        ? `unknown flag '--${flag}'. Did you mean '--${suggestion}'?`
        : `unknown flag '--${flag}' for '${command}'. See --help.`;
      throw new PcsError("PCS_INVALID_FLAG", msg, { flag, command });
    }
  }
}

type WaitUntil = "load" | "domcontentloaded" | "networkidle" | "commit";
const VALID_WAIT_UNTIL: ReadonlyArray<WaitUntil> = [
  "load",
  "domcontentloaded",
  "networkidle",
  "commit",
];
function parseWaitUntil(
  value: string | boolean | undefined,
): WaitUntil | undefined {
  if (typeof value !== "string") return undefined;
  if ((VALID_WAIT_UNTIL as ReadonlyArray<string>).includes(value)) {
    return value as WaitUntil;
  }
  throw new PcsError(
    "PCS_INVALID_FLAG",
    `Invalid --wait-until="${value}". Valid values: ${VALID_WAIT_UNTIL.join(", ")}`,
    { flag: "wait-until", value },
  );
}

function usage(): void {
  console.log(
    `
playwright-cli-sessions — session management layer for @playwright/cli

Usage:
  playwright-cli-sessions list [--probe=false] [--json]
  playwright-cli-sessions save <name>
  playwright-cli-sessions restore <name> [--out=<path>]
  playwright-cli-sessions clone <source> <newName>
  playwright-cli-sessions tag <name> <service> [identity]
  playwright-cli-sessions delete <name>
  playwright-cli-sessions probe <name> [--service=X]
  playwright-cli-sessions install --skills
  playwright-cli-sessions health
  playwright-cli-sessions screenshot <url> [--session=<name>] [--out=<path>] [--headed] [--channel=<channel>] [--wait-for=<selector>] [--wait-until=<event>] [--full-page]
  playwright-cli-sessions navigate <url> [--session=<name>] [--snapshot] [--headed] [--channel=<channel>] [--wait-for=<selector>] [--wait-until=<event>]
  playwright-cli-sessions snapshot <url> [--session=<name>] [--headed] [--channel=<channel>] [--wait-for=<selector>] [--wait-until=<event>]
  playwright-cli-sessions exec <script> [<url>] [--session=<name>] [--headed] [--channel=<channel>] [--wait-for=<selector>] [--wait-until=<event>]
  playwright-cli-sessions login <url> [--session=<name>] [--channel=<channel>]
  playwright-cli-sessions refresh <name> [--url=<url>] [--channel=<channel>]
  playwright-cli-sessions expect <url> [--title=<substr>] [--selector=<sel>] [--text=<substr>] [--status=<code>] [--session=<name>] [--timeout=<ms>] [--retry=<N>] [--screenshot-on-fail=<path>] [--headed] [--channel=<channel>] [--wait-for=<selector>] [--wait-until=<event>]
  playwright-cli-sessions report "<message>" [--context=<N>] [--no-notify]
  playwright-cli-sessions reports [--limit=<N>] [--json]

Commands:
  list        List saved sessions with live probe status (cached 1h)
  save        Capture auth state from a running playwright-cli session
  restore     Open a browser session pre-loaded with saved auth state, or write storageState to --out=<path>
  clone       Copy a session under a new name (clone-safety guard applies)
  tag         Manually label a service/identity in a saved session
  delete      Remove a saved session
  probe       Run live HTTP probes for a session's services
  install     Install skill files into <cwd>/.claude/skills/
  health      Probe all sessions, notify on dead transitions (for LaunchAgent)
  screenshot  Navigate to a URL and save a PNG screenshot (headless by default)
  navigate    Navigate to a URL and print page info (headless by default)
  snapshot    Navigate to a URL and print the ARIA accessibility tree (headless by default)
  exec        Run a custom script (exports run({ page, context, browser })) against a page (headless by default)
  login       Open a visible browser for interactive login and save the session
  refresh     Re-open an existing session to re-authenticate and update it
  expect      Assert page properties (title/selector/text/status) from the shell — exits 0/1
  report      File a structured issue report about unexpected CLI behavior
  reports     List recently filed reports

Options for screenshot:
  --session=<name>      Load a saved session's cookies (optional)
  --out=<path>          Output PNG path (default: /tmp/screenshot-<ts>.png; parent dir auto-created)
  --headed              Open a visible browser window (default: headless)
  --channel=<channel>   Browser channel: "chrome" (default), "chromium" (bundled), "msedge", etc.
  --wait-for=<selector> CSS selector to wait for after navigation (recommended to avoid blank captures)
  --wait-until=<event>  Playwright waitUntil: load | domcontentloaded (default) | networkidle | commit
  --full-page           Capture the full scrollable page (default: viewport only)

Options for navigate:
  --session=<name>      Load a saved session's cookies (optional)
  --snapshot            Also print the ARIA accessibility tree
  --headed              Open a visible browser window (default: headless)
  --channel=<channel>   Browser channel: "chrome" (default), "chromium" (bundled), "msedge", etc.
  --wait-for=<selector> CSS selector to wait for after navigation
  --wait-until=<event>  Playwright waitUntil: load | domcontentloaded (default) | networkidle | commit

Options for snapshot:
  --session=<name>      Load a saved session's cookies (optional)
  --headed              Open a visible browser window (default: headless)
  --channel=<channel>   Browser channel: "chrome" (default), "chromium" (bundled), "msedge", etc.
  --wait-for=<selector> CSS selector to wait for after navigation
  --wait-until=<event>  Playwright waitUntil: load | domcontentloaded (default) | networkidle | commit

Options for exec:
  --session=<name>      Load a saved session's cookies (optional)
  --headed              Open a visible browser window (default: headless)
  --channel=<channel>   Browser channel: "chrome" (default), "chromium" (bundled), "msedge", etc.
  --wait-for=<selector> CSS selector to wait for after navigation (only applies when <url> is given)
  --wait-until=<event>  Playwright waitUntil: load | domcontentloaded (default) | networkidle | commit
  Script must export: async function run({ page, context, browser }) { ... }
  The second positional argument <url> is optional — the script may navigate itself.

Options for login:
  --session=<name>    Pre-load an existing session or set the save name
  --channel=<channel> Browser channel: "chrome" (default), "chromium" (bundled), "msedge", etc.

Options for refresh:
  --url=<url>         URL to navigate to (default: session's lastUrl)
  --channel=<channel> Browser channel: "chrome" (default), "chromium" (bundled), "msedge", etc.

Options for expect:
  --title=<substr>       page.title() must contain <substr>
  --selector=<sel>       element matching CSS <sel> must be visible within --timeout
  --text=<substr>        text <substr> must appear somewhere on the page
  --status=<code>        navigation response HTTP status must equal <code>
  --timeout=<ms>         max ms to wait for any single expectation (default 10000)
  --retry=<N>            retry the whole check N more times on failure (default 0)
  --session=<name>       Load a saved session's cookies
  --channel=<channel>    Browser channel: "chrome" (default), "chromium" (bundled), "msedge", etc.
  --wait-for=<selector>  CSS selector to wait for after navigation (pre-check)
  --wait-until=<event>   Playwright waitUntil: load | domcontentloaded | networkidle | commit
  --screenshot-on-fail=<path>  Save a full-page screenshot if the check ultimately fails
  Exits 0 on pass, 1 on failed expectation. At least one expectation flag is required.

Options for report:
  --context=<N>       Number of recent usage-log entries to embed (default: 10)
  --no-notify         Skip the macOS desktop notification when a Claude Code
                      session files a report (env: PLAYWRIGHT_CLI_SESSIONS_NO_NOTIFY=1)

Options for reports:
  --limit=<N>         Max number of reports to show (default: 20)
  --json              Emit a JSON array instead of human-readable output

Error codes:
  PCS_AUTH_WALL (77)        — landed on login page / CAPTCHA / Cloudflare challenge
  PCS_AUTH_EXPIRED (77)     — saved session probe returned 401/302
  PCS_SELECTOR_TIMEOUT (10) — --wait-for selector never appeared
  PCS_NAV_FAILED (11)       — page.goto failed (DNS, net::ERR_*)
  PCS_NETWORK (12)          — probe/network op failed transiently
  PCS_INVALID_FLAG (2)      — unknown flag or bad enum value
  PCS_MISSING_ARG (2)       — required positional missing
  PCS_INVALID_INPUT (2)     — malformed URL / file / JSON
  PCS_SESSION_NOT_FOUND (3) — no saved session by that name
  PCS_BROWSER_CRASH (20)    — browser process died unexpectedly
  PCS_UNKNOWN (1)           — anything unclassified

  All errors emit: Error [CODE]: message
  Auth-wall errors additionally emit: AUTH_WALL service=... session=... url=... suggest="..."

Feedback loop:
  If the CLI does something unexpected, run
    playwright-cli-sessions report "<what happened>"
  instead of working around it. Reports are stored under ~/.playwright-sessions/.reports/
  and include recent CLI invocations (from ~/.playwright-sessions/.usage-log.jsonl) for context.

Sessions are stored in ~/.playwright-sessions/ — interoperable with playwright-sessions MCP.
Note: Browser commands require Chromium. Run \`npx playwright install chromium\` if not installed.
`.trim(),
  );
}

// Captured for the 'exit' listener. Updated in main() as we parse the command
// and again if we catch an error before process.exit fires.
let loggedCommand = "unknown";
let loggedError: string | undefined;
const startTime = Date.now();

// Best-effort usage logging on every exit path (normal, process.exit, thrown
// uncaught). 'exit' listeners are synchronous — appendFileSync inside logUsage
// is fine. Opt-out via PLAYWRIGHT_CLI_SESSIONS_NO_LOG=1 for callers that need
// a silent CLI (e.g. recursive `report` writing its own log entry).
process.on("exit", (code) => {
  if (process.env.PLAYWRIGHT_CLI_SESSIONS_NO_LOG === "1") return;
  logUsage({
    cmd: loggedCommand,
    args,
    exitCode: code,
    durationMs: Date.now() - startTime,
    ...(loggedError ? { error: loggedError } : {}),
  });
});

/** Emit a usage error (wrong args) and exit with PCS_MISSING_ARG (exit 2). */
function usageError(message: string): never {
  throw new PcsError("PCS_MISSING_ARG", message);
}

async function main(): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const [command, ...rest] = positional;
  if (command) loggedCommand = command;

  if (
    !command ||
    command === "--help" ||
    command === "-h" ||
    command === "help"
  ) {
    loggedCommand = "help";
    usage();
    process.exit(0);
  }

  try {
    // Validate flags against the per-command whitelist before dispatching
    const knownFlags = COMMAND_FLAGS[command];
    if (knownFlags) {
      validateFlags(command, flags, knownFlags);
    }

    switch (command) {
      case "list": {
        const probeFlag = flags["probe"];
        await cmdList({
          probe: probeFlag === undefined ? true : probeFlag !== "false",
          json: flags["json"] === true,
        });
        break;
      }

      case "save": {
        const name = rest[0];
        if (!name) {
          throw new PcsError(
            "PCS_MISSING_ARG",
            "save requires a session name.\n  playwright-cli-sessions save <name>",
          );
        }
        await cmdSave(name);
        break;
      }

      case "restore": {
        const name = rest[0];
        if (!name) {
          throw new PcsError(
            "PCS_MISSING_ARG",
            "restore requires a session name.\n  playwright-cli-sessions restore <name> [--out=<path>]",
          );
        }
        const outFlag = flags["out"];
        await cmdRestore(name, {
          out: typeof outFlag === "string" ? outFlag : undefined,
        });
        break;
      }

      case "clone": {
        const [srcName, dstName] = rest;
        if (!srcName || !dstName) {
          throw new PcsError(
            "PCS_MISSING_ARG",
            "clone requires source and destination names.\n  playwright-cli-sessions clone <source> <newName>",
          );
        }
        await cmdClone(srcName, dstName, {
          overwriteSource: flags["overwrite-source"] === true,
        });
        break;
      }

      case "tag": {
        const [name, service, identity] = rest;
        if (!name || !service) {
          throw new PcsError(
            "PCS_MISSING_ARG",
            "tag requires a session name and service.\n  playwright-cli-sessions tag <name> <service> [identity]",
          );
        }
        cmdTag(name, service, identity);
        break;
      }

      case "delete": {
        const name = rest[0];
        if (!name) {
          throw new PcsError(
            "PCS_MISSING_ARG",
            "delete requires a session name.\n  playwright-cli-sessions delete <name>",
          );
        }
        cmdDelete(name);
        break;
      }

      case "probe": {
        const name = rest[0];
        if (!name) {
          throw new PcsError(
            "PCS_MISSING_ARG",
            "probe requires a session name.\n  playwright-cli-sessions probe <name> [--service=X]",
          );
        }
        const service = flags["service"];
        await cmdProbe(name, {
          service: typeof service === "string" ? service : undefined,
        });
        break;
      }

      case "install": {
        cmdInstall({ skills: flags["skills"] === true });
        break;
      }

      case "health": {
        await cmdHealth();
        break;
      }

      case "screenshot": {
        const url = rest[0];
        if (!url) {
          throw new PcsError(
            "PCS_MISSING_ARG",
            "screenshot requires a URL.\n  playwright-cli-sessions screenshot <url> [--session=<name>] [--out=<path>]",
          );
        }
        const session = flags["session"];
        const out = flags["out"];
        const channel = flags["channel"];
        const waitFor = flags["wait-for"];
        await cmdScreenshot(url, {
          session: typeof session === "string" ? session : undefined,
          out: typeof out === "string" ? out : undefined,
          channel: typeof channel === "string" ? channel : undefined,
          headed: flags["headed"] === true,
          waitUntil: parseWaitUntil(flags["wait-until"]),
          waitFor: typeof waitFor === "string" ? waitFor : undefined,
          fullPage: flags["full-page"] === true,
          noProbe: flags["no-probe"] === true,
        });
        break;
      }

      case "navigate": {
        const url = rest[0];
        if (!url) {
          throw new PcsError(
            "PCS_MISSING_ARG",
            "navigate requires a URL.\n  playwright-cli-sessions navigate <url> [--session=<name>] [--snapshot]",
          );
        }
        const session = flags["session"];
        const channel = flags["channel"];
        const waitFor = flags["wait-for"];
        await cmdNavigate(url, {
          session: typeof session === "string" ? session : undefined,
          snapshot: flags["snapshot"] === true,
          channel: typeof channel === "string" ? channel : undefined,
          headed: flags["headed"] === true,
          waitUntil: parseWaitUntil(flags["wait-until"]),
          waitFor: typeof waitFor === "string" ? waitFor : undefined,
          noProbe: flags["no-probe"] === true,
        });
        break;
      }

      case "snapshot": {
        const url = rest[0];
        if (!url) {
          throw new PcsError(
            "PCS_MISSING_ARG",
            "snapshot requires a URL.\n  playwright-cli-sessions snapshot <url> [--session=<name>]",
          );
        }
        const session = flags["session"];
        const channel = flags["channel"];
        const waitFor = flags["wait-for"];
        await cmdSnapshot(url, {
          session: typeof session === "string" ? session : undefined,
          channel: typeof channel === "string" ? channel : undefined,
          headed: flags["headed"] === true,
          waitUntil: parseWaitUntil(flags["wait-until"]),
          waitFor: typeof waitFor === "string" ? waitFor : undefined,
          noProbe: flags["no-probe"] === true,
        });
        break;
      }

      case "exec": {
        const scriptPath = rest[0];
        if (!scriptPath) {
          throw new PcsError(
            "PCS_MISSING_ARG",
            "exec requires a script path.\n  playwright-cli-sessions exec <script> [<url>] [--session=<name>]",
          );
        }
        const url = rest[1];
        const session = flags["session"];
        const channel = flags["channel"];
        const waitFor = flags["wait-for"];
        await cmdExec(scriptPath, {
          session: typeof session === "string" ? session : undefined,
          url: url ?? undefined,
          channel: typeof channel === "string" ? channel : undefined,
          headed: flags["headed"] === true,
          waitUntil: parseWaitUntil(flags["wait-until"]),
          waitFor: typeof waitFor === "string" ? waitFor : undefined,
          noProbe: flags["no-probe"] === true,
        });
        break;
      }

      case "login": {
        const url = rest[0];
        if (!url) {
          throw new PcsError(
            "PCS_MISSING_ARG",
            "login requires a URL.\n  playwright-cli-sessions login <url> [--session=<name>] [--channel=<channel>]",
          );
        }
        const session = flags["session"];
        const channel = flags["channel"];
        await cmdLogin(url, {
          session: typeof session === "string" ? session : undefined,
          channel: typeof channel === "string" ? channel : undefined,
        });
        break;
      }

      case "refresh": {
        const name = rest[0];
        if (!name) {
          throw new PcsError(
            "PCS_MISSING_ARG",
            "refresh requires a session name.\n  playwright-cli-sessions refresh <name> [--url=<url>] [--channel=<channel>]",
          );
        }
        const url = flags["url"];
        const channel = flags["channel"];
        await cmdRefresh(name, {
          url: typeof url === "string" ? url : undefined,
          channel: typeof channel === "string" ? channel : undefined,
        });
        break;
      }

      case "report": {
        const message = rest.join(" ").trim();
        if (!message) {
          usageError(
            `report requires a message.\n  playwright-cli-sessions report "<what went wrong>"`,
          );
        }
        const contextFlag = flags["context"];
        const context =
          typeof contextFlag === "string"
            ? parseInt(contextFlag, 10)
            : undefined;
        const noNotify = flags["no-notify"] === true;
        cmdReport(message, { context, notify: !noNotify });
        break;
      }

      case "reports": {
        const limitFlag = flags["limit"];
        cmdReports({
          limit:
            typeof limitFlag === "string" ? parseInt(limitFlag, 10) : undefined,
          json: flags["json"] === true,
        });
        break;
      }

      case "expect": {
        const url = rest[0];
        if (!url) {
          usageError(
            `expect requires a URL.\n  playwright-cli-sessions expect <url> [--title=<substr>] [--selector=<sel>] [--text=<substr>] [--status=<code>] [--timeout=<ms>] [--retry=<N>]`,
          );
        }
        const titleFlag = flags["title"];
        const selectorFlag = flags["selector"];
        const textFlag = flags["text"];
        const statusFlag = flags["status"];
        const timeoutFlag = flags["timeout"];
        const retryFlag = flags["retry"];
        const sessionFlag = flags["session"];
        const channelFlag = flags["channel"];
        const waitForFlag = flags["wait-for"];
        const waitUntilFlag = flags["wait-until"];
        const screenshotOnFailFlag = flags["screenshot-on-fail"];
        await cmdExpect(url, {
          ...(typeof titleFlag === "string" ? { title: titleFlag } : {}),
          ...(typeof selectorFlag === "string"
            ? { selector: selectorFlag }
            : {}),
          ...(typeof textFlag === "string" ? { text: textFlag } : {}),
          ...(typeof statusFlag === "string"
            ? { status: parseInt(statusFlag, 10) }
            : {}),
          ...(typeof timeoutFlag === "string"
            ? { timeout: parseInt(timeoutFlag, 10) }
            : {}),
          ...(typeof retryFlag === "string"
            ? { retry: parseInt(retryFlag, 10) }
            : {}),
          ...(typeof sessionFlag === "string" ? { session: sessionFlag } : {}),
          ...(typeof channelFlag === "string" ? { channel: channelFlag } : {}),
          ...(typeof waitForFlag === "string" ? { waitFor: waitForFlag } : {}),
          ...(typeof waitUntilFlag === "string"
            ? { waitUntil: parseWaitUntil(waitUntilFlag) }
            : {}),
          ...(typeof screenshotOnFailFlag === "string"
            ? { screenshotOnFail: screenshotOnFailFlag }
            : {}),
          headed: flags["headed"] === true,
          noProbe: flags["no-probe"] === true,
        });
        break;
      }

      default:
        console.error(`Unknown command: "${command}"\n`);
        usage();
        process.exit(1);
    }
  } catch (err: unknown) {
    if (err instanceof PcsError) {
      loggedError = err.message;
      // Auth-wall gets a grep-friendly one-liner before the structured error line
      if (err.code === "PCS_AUTH_WALL") {
        const d = err.details;
        const service = d["service"] ?? "unknown";
        const sessionName = d["session"] ?? "none";
        const url = d["finalUrl"] ?? "unknown";
        const suggest =
          typeof sessionName === "string" && sessionName !== "none"
            ? `playwright-cli-sessions refresh ${sessionName}`
            : "playwright-cli-sessions login <session>";
        console.error(
          `AUTH_WALL service=${service} session=${sessionName} url=${url} suggest="${suggest}"`,
        );
      }
      console.error(`Error [${err.code}]: ${err.message}`);
      if (Object.keys(err.details).length > 0) {
        console.error(`  details: ${JSON.stringify(err.details)}`);
      }
      process.exit(EXIT_CODE_MAP[err.code]);
    } else {
      const message = err instanceof Error ? err.message : String(err);
      loggedError = message;
      console.error(`Error [PCS_UNKNOWN]: ${message}`);
      process.exit(1);
    }
  }
}

main();
