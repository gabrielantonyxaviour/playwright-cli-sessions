/**
 * save <name> — capture the current auth state of a running playwright-cli session.
 *
 * Shells out to `playwright-cli -s=<name> state-save <tmp>`, reads the resulting
 * storageState, runs service detection, and writes to ~/.playwright-sessions/<name>.json.
 *
 * The named session must already be running (playwright-cli -s=<name> open).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveStorageState } from "../store.js";
import type { StorageState } from "../store.js";

export async function cmdSave(name: string): Promise<void> {
  const tmp = join(tmpdir(), `pwcli-save-${name}-${Date.now()}.json`);

  try {
    // Shell out to playwright-cli to capture the live session state
    console.log(`Saving session "${name}" from playwright-cli...`);
    execFileSync("playwright-cli", [`-s=${name}`, "state-save", tmp], {
      stdio: "inherit",
    });

    if (!existsSync(tmp)) {
      throw new Error(
        `playwright-cli state-save did not produce a file at ${tmp}. ` +
          `Is the session "${name}" currently open?`,
      );
    }

    const storageState = JSON.parse(readFileSync(tmp, "utf-8")) as StorageState;

    const session = saveStorageState(name, storageState);
    const serviceNames = (session.auth ?? []).map((a) =>
      a.identity ? `${a.service} (${a.identity})` : a.service,
    );

    console.log(`✓ Saved "${name}" to ~/.playwright-sessions/${name}.json`);
    if (serviceNames.length > 0) {
      console.log(`  Detected: ${serviceNames.join(", ")}`);
    } else {
      console.log(`  No authenticated services detected.`);
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
