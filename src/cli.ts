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
 *   playwright-cli-sessions screenshot <url> [--session=<name>] [--out=<path>]
 *   playwright-cli-sessions navigate <url> [--session=<name>] [--snapshot]
 *   playwright-cli-sessions snapshot <url> [--session=<name>]
 *   playwright-cli-sessions exec <script> [<url>] [--session=<name>]
 *   playwright-cli-sessions login <url> [--session=<name>]
 */

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
  playwright-cli-sessions screenshot <url> [--session=<name>] [--out=<path>]
  playwright-cli-sessions navigate <url> [--session=<name>] [--snapshot]
  playwright-cli-sessions snapshot <url> [--session=<name>]
  playwright-cli-sessions exec <script> [<url>] [--session=<name>]
  playwright-cli-sessions login <url> [--session=<name>]

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
  screenshot  Navigate to a URL and save a PNG screenshot
  navigate    Navigate to a URL and print page info (optionally with ARIA tree)
  snapshot    Navigate to a URL and print the ARIA accessibility tree
  exec        Run a custom script (exports run({ page })) against a page
  login       Open a browser for interactive login and save the session

Options for list:
  --probe=false   Skip network calls, use cookie-expiry metadata only
  --json          Output JSON instead of human-readable text

Options for probe:
  --service=X     Probe only the named service

Options for install:
  --skills        Copy skill files into .claude/skills/playwright-cli-sessions/

Options for screenshot:
  --session=<name>  Load a saved session's cookies (optional)
  --out=<path>      Output PNG path (default: /tmp/screenshot-<ts>.png)

Options for navigate:
  --session=<name>  Load a saved session's cookies (optional)
  --snapshot        Also print the ARIA accessibility tree

Options for snapshot:
  --session=<name>  Load a saved session's cookies (optional)

Options for exec:
  --session=<name>  Load a saved session's cookies (optional)
  The second positional argument <url> is optional — the script may navigate itself.

Options for login:
  --session=<name>  Pre-load an existing session or set the save name

Sessions are stored in ~/.playwright-sessions/ — interoperable with playwright-sessions MCP.
Note: Browser commands require Chromium. Run \`npx playwright install chromium\` if not installed.
`.trim(),
  );
}

async function main(): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const [command, ...rest] = positional;

  if (
    !command ||
    command === "--help" ||
    command === "-h" ||
    command === "help"
  ) {
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
        await cmdScreenshot(url, {
          session: typeof session === "string" ? session : undefined,
          out: typeof out === "string" ? out : undefined,
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
        await cmdNavigate(url, {
          session: typeof session === "string" ? session : undefined,
          snapshot: flags["snapshot"] === true,
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
        await cmdSnapshot(url, {
          session: typeof session === "string" ? session : undefined,
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
        await cmdExec(scriptPath, {
          session: typeof session === "string" ? session : undefined,
          url: url ?? undefined,
        });
        break;
      }

      case "login": {
        const url = rest[0];
        if (!url) {
          console.error(
            "Error: login requires a URL.\n  playwright-cli-sessions login <url> [--session=<name>]",
          );
          process.exit(1);
        }
        const session = flags["session"];
        await cmdLogin(url, {
          session: typeof session === "string" ? session : undefined,
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
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
