#!/usr/bin/env node
/**
 * playwright-cli-sessions — session management layer for @playwright/cli
 *
 * Provides named saved logins, service probes, and clone safety on top of
 * @playwright/cli. Reads/writes ~/.playwright-sessions/ — fully interoperable
 * with the playwright-sessions MCP.
 *
 * Usage:
 *   playwright-cli-sessions list [--probe=false] [--json]
 *   playwright-cli-sessions save <name>
 *   playwright-cli-sessions restore <name>
 *   playwright-cli-sessions clone <source> <newName>
 *   playwright-cli-sessions tag <name> <service> [identity]
 *   playwright-cli-sessions delete <name>
 *   playwright-cli-sessions probe <name> [--service=X]
 *   playwright-cli-sessions install --skills
 */

import { cmdList } from "./commands/list.js";
import { cmdSave } from "./commands/save.js";
import { cmdRestore } from "./commands/restore.js";
import { cmdClone } from "./commands/clone.js";
import { cmdTag } from "./commands/tag.js";
import { cmdDelete } from "./commands/delete.js";
import { cmdProbe } from "./commands/probe.js";
import { cmdInstall } from "./commands/install.js";

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
  playwright-cli-sessions restore <name>
  playwright-cli-sessions clone <source> <newName>
  playwright-cli-sessions tag <name> <service> [identity]
  playwright-cli-sessions delete <name>
  playwright-cli-sessions probe <name> [--service=X]
  playwright-cli-sessions install --skills

Commands:
  list        List saved sessions with live probe status (cached 1h)
  save        Capture auth state from a running playwright-cli session
  restore     Open a browser session pre-loaded with saved auth state
  clone       Copy a session under a new name (clone-safety guard applies)
  tag         Manually label a service/identity in a saved session
  delete      Remove a saved session
  probe       Run live HTTP probes for a session's services
  install     Install skill files into <cwd>/.claude/skills/

Options for list:
  --probe=false   Skip network calls, use cookie-expiry metadata only
  --json          Output JSON instead of human-readable text

Options for probe:
  --service=X     Probe only the named service

Options for install:
  --skills        Copy skill files into .claude/skills/playwright-cli-sessions/

Sessions are stored in ~/.playwright-sessions/ — interoperable with playwright-sessions MCP.
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
            "Error: restore requires a session name.\n  playwright-cli-sessions restore <name>",
          );
          process.exit(1);
        }
        await cmdRestore(name);
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
