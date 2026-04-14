/**
 * restore <name> — launch a playwright-cli session pre-loaded with saved auth state.
 *
 * Steps:
 *   1. Read storageState from ~/.playwright-sessions/<name>.json
 *   2. Write it to a tmp file
 *   3. Spawn `playwright-cli -s=<name> open` in the background (non-blocking)
 *   4. Poll until the session appears in `playwright-cli list`
 *   5. Load state: `playwright-cli -s=<name> state-load <tmp>`
 *   6. Delete tmp
 *
 * The browser window stays open after this command exits.
 */

import { execFileSync, spawn } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSaved } from "../store.js";

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 15_000;

async function waitForSession(name: string): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const output = execFileSync("playwright-cli", ["list"], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (output.includes(name)) return;
    } catch {
      // list command may fail if no sessions yet — keep waiting
    }
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
  }
  throw new Error(
    `Timed out waiting for playwright-cli session "${name}" to become available.`,
  );
}

export async function cmdRestore(name: string): Promise<void> {
  const saved = readSaved(name);
  if (!saved) {
    throw new Error(
      `No saved session found for "${name}". Run \`playwright-cli-sessions list\` to see available sessions.`,
    );
  }

  const tmp = join(tmpdir(), `pwcli-restore-${name}-${Date.now()}.json`);

  try {
    // Write storageState to tmp
    writeFileSync(tmp, JSON.stringify(saved.storageState, null, 2));

    // Spawn playwright-cli open in the background (non-blocking)
    console.log(`Opening browser session "${name}"...`);
    const child = spawn(
      "playwright-cli",
      [`-s=${name}`, "open", ...(saved.lastUrl ? [saved.lastUrl] : [])],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    child.unref();

    // Wait for the session to appear
    console.log(`Waiting for session to start...`);
    await waitForSession(name);

    // Load the saved state into the running session
    console.log(`Loading saved auth state...`);
    execFileSync("playwright-cli", [`-s=${name}`, "state-load", tmp], {
      stdio: "inherit",
    });

    const serviceNames = (saved.auth ?? []).map((a) =>
      a.identity ? `${a.service} (${a.identity})` : a.service,
    );

    console.log(`✓ Restored "${name}" — browser is open with saved auth.`);
    if (serviceNames.length > 0) {
      console.log(`  Services: ${serviceNames.join(", ")}`);
    }
  } finally {
    if (existsSync(tmp)) {
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}
