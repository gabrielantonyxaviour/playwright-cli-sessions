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
  throw new Error(
    `Invalid --wait-until="${value}". Valid values: ${VALID_WAIT_UNTIL.join(", ")}`,
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
  playwright-cli-sessions report "<message>" [--context=<N>]
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
  report      File a structured issue report about unexpected CLI behavior
  reports     List recently filed reports

Options for screenshot:
  --session=<name>      Load a saved session's cookies (optional)
  --out=<path>          Output PNG path (default: /tmp/screenshot-<ts>.png; parent dir auto-created)
  --headed              Open a visible browser window (default: headless)
  --channel=<channel>   Browser channel: "chrome" (default), "msedge", etc.
  --wait-for=<selector> CSS selector to wait for after navigation (recommended to avoid blank captures)
  --wait-until=<event>  Playwright waitUntil: load | domcontentloaded (default) | networkidle | commit
  --full-page           Capture the full scrollable page (default: viewport only)

Options for navigate:
  --session=<name>      Load a saved session's cookies (optional)
  --snapshot            Also print the ARIA accessibility tree
  --headed              Open a visible browser window (default: headless)
  --channel=<channel>   Browser channel: "chrome" (default), "msedge", etc.
  --wait-for=<selector> CSS selector to wait for after navigation
  --wait-until=<event>  Playwright waitUntil: load | domcontentloaded (default) | networkidle | commit

Options for snapshot:
  --session=<name>      Load a saved session's cookies (optional)
  --headed              Open a visible browser window (default: headless)
  --channel=<channel>   Browser channel: "chrome" (default), "msedge", etc.
  --wait-for=<selector> CSS selector to wait for after navigation
  --wait-until=<event>  Playwright waitUntil: load | domcontentloaded (default) | networkidle | commit

Options for exec:
  --session=<name>      Load a saved session's cookies (optional)
  --headed              Open a visible browser window (default: headless)
  --channel=<channel>   Browser channel: "chrome" (default), "msedge", etc.
  --wait-for=<selector> CSS selector to wait for after navigation (only applies when <url> is given)
  --wait-until=<event>  Playwright waitUntil: load | domcontentloaded (default) | networkidle | commit
  Script must export: async function run({ page, context, browser }) { ... }
  The second positional argument <url> is optional — the script may navigate itself.

Options for login:
  --session=<name>    Pre-load an existing session or set the save name
  --channel=<channel> Browser channel: "chrome" (default), "msedge", etc.

Options for refresh:
  --url=<url>         URL to navigate to (default: session's lastUrl)
  --channel=<channel> Browser channel: "chrome" (default), "msedge", etc.

Options for report:
  --context=<N>       Number of recent usage-log entries to embed (default: 10)

Options for reports:
  --limit=<N>         Max number of reports to show (default: 20)
  --json              Emit a JSON array instead of human-readable output

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

/** Emit a usage error (wrong args) and exit 1 with the error captured in the log. */
function usageError(message: string): never {
  loggedError = message;
  console.error(`Error: ${message}`);
  process.exit(1);
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
          console.error(
            "Error: save requires a session name.\n  playwright-cli-sessions save <name>",
          );
          process.exit(1);
        }
        await cmdSave(name);
        break;
      }

      case "restore": {
        const name = rest[0];
        if (!name) {
          console.error(
            "Error: restore requires a session name.\n  playwright-cli-sessions restore <name> [--out=<path>]",
          );
          process.exit(1);
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
          console.error(
            "Error: clone requires source and destination names.\n  playwright-cli-sessions clone <source> <newName>",
          );
          process.exit(1);
        }
        await cmdClone(srcName, dstName, {
          overwriteSource: flags["overwrite-source"] === true,
        });
        break;
      }

      case "tag": {
        const [name, service, identity] = rest;
        if (!name || !service) {
          console.error(
            "Error: tag requires a session name and service.\n  playwright-cli-sessions tag <name> <service> [identity]",
          );
          process.exit(1);
        }
        cmdTag(name, service, identity);
        break;
      }

      case "delete": {
        const name = rest[0];
        if (!name) {
          console.error(
            "Error: delete requires a session name.\n  playwright-cli-sessions delete <name>",
          );
          process.exit(1);
        }
        cmdDelete(name);
        break;
      }

      case "probe": {
        const name = rest[0];
        if (!name) {
          console.error(
            "Error: probe requires a session name.\n  playwright-cli-sessions probe <name> [--service=X]",
          );
          process.exit(1);
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
          console.error(
            "Error: screenshot requires a URL.\n  playwright-cli-sessions screenshot <url> [--session=<name>] [--out=<path>]",
          );
          process.exit(1);
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
        });
        break;
      }

      case "navigate": {
        const url = rest[0];
        if (!url) {
          console.error(
            "Error: navigate requires a URL.\n  playwright-cli-sessions navigate <url> [--session=<name>] [--snapshot]",
          );
          process.exit(1);
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
        });
        break;
      }

      case "snapshot": {
        const url = rest[0];
        if (!url) {
          console.error(
            "Error: snapshot requires a URL.\n  playwright-cli-sessions snapshot <url> [--session=<name>]",
          );
          process.exit(1);
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
        });
        break;
      }

      case "exec": {
        const scriptPath = rest[0];
        if (!scriptPath) {
          console.error(
            "Error: exec requires a script path.\n  playwright-cli-sessions exec <script> [<url>] [--session=<name>]",
          );
          process.exit(1);
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
        });
        break;
      }

      case "login": {
        const url = rest[0];
        if (!url) {
          console.error(
            "Error: login requires a URL.\n  playwright-cli-sessions login <url> [--session=<name>] [--channel=<channel>]",
          );
          process.exit(1);
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
          console.error(
            "Error: refresh requires a session name.\n  playwright-cli-sessions refresh <name> [--url=<url>] [--channel=<channel>]",
          );
          process.exit(1);
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
        cmdReport(message, { context });
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

      default:
        console.error(`Unknown command: "${command}"\n`);
        usage();
        process.exit(1);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    loggedError = message;
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
