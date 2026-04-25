/**
 * login <url> [--session=<name>] [--channel=<channel>]
 *
 * Open a non-headless browser, let the user log in interactively, then save
 * the authenticated session to ~/.playwright-sessions/<name>.json.
 *
 * If --session names an existing saved session, its cookies are pre-loaded
 * as a starting point (useful for refreshing expired auth).
 *
 * In TTY environments, waits for Enter. In non-TTY (Claude Code, CI), waits
 * for the browser window to be closed.
 *
 * Usage:
 *   playwright-cli-sessions login https://github.com --session=gabriel-platforms
 *   playwright-cli-sessions login https://github.com --channel=chrome
 *   playwright-cli-sessions login https://github.com  # auto-names with timestamp
 */

import type { BrowserContextOptions } from "playwright";
import * as readline from "node:readline";
import {
  launchStealthChrome,
  createStealthContext,
} from "../browser-launch.js";
import { readSaved, saveStorageState } from "../store.js";
import type { StorageState } from "../store.js";
import { guardLocalLaunch } from "../attached-browser.js";

// Our StorageState has `sameSite: string` but Playwright expects the union type.
// The data is wire-compatible; use this cast helper to bridge the gap.
type PlaywrightStorageState = NonNullable<
  BrowserContextOptions["storageState"]
>;
const asPlaywrightSS = (ss: StorageState): PlaywrightStorageState =>
  ss as unknown as PlaywrightStorageState;

export interface LoginOptions {
  session?: string;
  channel?: string;
}

export async function cmdLogin(
  url: string,
  opts: LoginOptions = {},
): Promise<void> {
  const sessionName = opts.session ?? `session-${Date.now()}`;

  let storageState: StorageState | undefined;
  if (opts.session) {
    const existing = readSaved(opts.session);
    if (existing) {
      storageState = existing.storageState;
      console.log(`Loading existing session "${opts.session}" as base...`);
    }
  }

  console.log(`Opening browser at ${url}...`);
  // login is inherently a local-Mac operation (user types credentials in
  // a window on whichever Mac is in front of them). If PLAYWRIGHT_CLI_REMOTE
  // is set, that window would pop on the wrong Mac — refuse and ask.
  guardLocalLaunch();
  const browser = await launchStealthChrome({
    headless: false,
    channel: opts.channel,
  });
  try {
    const context = await createStealthContext(
      browser,
      storageState ? { storageState: asPlaywrightSS(storageState) } : {},
    );
    const page = await context.newPage();
    await page.goto(url);

    // Capture storageState and save — shared between TTY and non-TTY paths.
    let captured = false;
    const captureAndSave = async () => {
      if (captured) return;
      captured = true;
      try {
        const currentUrl = page.url();
        const state = (await context.storageState()) as unknown as StorageState;
        const session = saveStorageState(sessionName, state, currentUrl);
        const serviceNames = (session.auth ?? []).map((a) =>
          a.identity ? `${a.service} (${a.identity})` : a.service,
        );
        console.log(
          `\n✓ Saved session as "${sessionName}" to ~/.playwright-sessions/${sessionName}.json`,
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
      // Interactive terminal: wait for Enter
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      await new Promise<void>((resolve) => {
        rl.question(
          "Log in in the browser, then press Enter here to save the session... ",
          () => {
            rl.close();
            resolve();
          },
        );
      });
      await captureAndSave();
    } else {
      // Non-TTY (Claude Code, CI, piped stdin): wait for browser close
      console.log(
        "Non-TTY detected. Close the browser window when done logging in.",
      );
      // Capture storageState when the page closes — context is still alive at this
      // point so storageState() works. By the time context.on('close') or
      // browser.on('disconnected') fires, the context is already torn down.
      page.on("close", async () => {
        await captureAndSave();
      });
      // Wait for the browser process to fully disconnect
      await new Promise<void>((resolve) => {
        browser.on("disconnected", () => resolve());
      });
      // Belt-and-suspenders: try again in case page.on('close') didn't fire
      await captureAndSave();
    }

    await context.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }
}
