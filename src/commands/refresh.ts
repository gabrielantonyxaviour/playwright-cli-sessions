/**
 * refresh <name> [--url=<url>] [--channel=<channel>]
 *
 * Re-open an existing saved session in a browser so the user can
 * re-authenticate (e.g. after a session expires). Cookies from the existing
 * session are pre-loaded, the user does whatever is needed, and the updated
 * state is saved back to the SAME session file.
 *
 * Unlike `login --session=<name>`, refresh REQUIRES the session to already
 * exist (errors if not found). If --url is omitted, navigates to the
 * session's lastUrl.
 *
 * In TTY environments, waits for Enter. In non-TTY (Claude Code, CI), waits
 * for the browser window to be closed.
 *
 * Usage:
 *   playwright-cli-sessions refresh donna --url=https://tinder.com
 *   playwright-cli-sessions refresh donna          # uses session's lastUrl
 */

import type { BrowserContextOptions } from "playwright";
import * as readline from "node:readline";
import {
  launchStealthChrome,
  createStealthContext,
} from "../browser-launch.js";
import { readSaved, saveStorageState } from "../store.js";
import type { StorageState } from "../store.js";

type PlaywrightStorageState = NonNullable<
  BrowserContextOptions["storageState"]
>;
const asPlaywrightSS = (ss: StorageState): PlaywrightStorageState =>
  ss as unknown as PlaywrightStorageState;

export interface RefreshOptions {
  url?: string;
  channel?: string;
}

export async function cmdRefresh(
  name: string,
  opts: RefreshOptions = {},
): Promise<void> {
  const existing = readSaved(name);
  if (!existing) {
    throw new Error(
      `No saved session: "${name}". Use \`login\` to create a new session, or \`list\` to see existing ones.`,
    );
  }

  const url = opts.url ?? existing.lastUrl;
  if (!url) {
    throw new Error(
      `Session "${name}" has no lastUrl. Provide --url=<url> to specify where to navigate.`,
    );
  }

  console.log(`Refreshing session "${name}" at ${url}...`);
  const browser = await launchStealthChrome({
    headless: false,
    channel: opts.channel,
  });
  try {
    const context = await createStealthContext(browser, {
      storageState: asPlaywrightSS(existing.storageState),
    });
    const page = await context.newPage();
    await page.goto(url);

    let captured = false;
    const captureAndSave = async () => {
      if (captured) return;
      captured = true;
      try {
        const currentUrl = page.url();
        const state = (await context.storageState()) as unknown as StorageState;
        const session = saveStorageState(name, state, currentUrl);
        const serviceNames = (session.auth ?? []).map((a) =>
          a.identity ? `${a.service} (${a.identity})` : a.service,
        );
        console.log(
          `\n✓ Updated session "${name}" in ~/.playwright-sessions/${name}.json`,
        );
        if (serviceNames.length > 0) {
          console.log(`  Detected: ${serviceNames.join(", ")}`);
        } else {
          console.log(`  No authenticated services detected.`);
        }
      } catch {
        console.error(
          "Warning: could not capture storageState before browser closed.",
        );
      }
    };

    if (process.stdin.isTTY) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      await new Promise<void>((resolve) => {
        rl.question(
          "Re-authenticate if needed, then press Enter to save... ",
          () => {
            rl.close();
            resolve();
          },
        );
      });
      await captureAndSave();
    } else {
      console.log("Non-TTY detected. Close the browser window when done.");
      page.on("close", async () => {
        await captureAndSave();
      });
      await new Promise<void>((resolve) => {
        browser.on("disconnected", () => resolve());
      });
      await captureAndSave();
    }

    await context.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }
}
