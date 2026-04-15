/**
 * login <url> [--session=<name>]
 *
 * Open a non-headless browser, let the user log in interactively, then save
 * the authenticated session to ~/.playwright-sessions/<name>.json.
 *
 * If --session names an existing saved session, its cookies are pre-loaded
 * as a starting point (useful for refreshing expired auth).
 *
 * Usage:
 *   playwright-cli-sessions login https://github.com --session=gabriel-platforms
 *   playwright-cli-sessions login https://github.com  # auto-names with timestamp
 */

import { chromium } from "playwright";
import type { BrowserContextOptions } from "playwright";
import * as readline from "node:readline";
import { readSaved, saveStorageState } from "../store.js";
import type { StorageState } from "../store.js";

// Our StorageState has `sameSite: string` but Playwright expects the union type.
// The data is wire-compatible; use this cast helper to bridge the gap.
type PlaywrightStorageState = NonNullable<
  BrowserContextOptions["storageState"]
>;
const asPlaywrightSS = (ss: StorageState): PlaywrightStorageState =>
  ss as unknown as PlaywrightStorageState;

export interface LoginOptions {
  session?: string;
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
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext(
      storageState ? { storageState: asPlaywrightSS(storageState) } : {},
    );
    const page = await context.newPage();
    await page.goto(url);

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

    const currentUrl = page.url();
    const state = (await context.storageState()) as unknown as StorageState;
    await context.close();

    const session = saveStorageState(sessionName, state, currentUrl);
    const serviceNames = (session.auth ?? []).map((a) =>
      a.identity ? `${a.service} (${a.identity})` : a.service,
    );

    console.log(
      `✓ Saved session as "${sessionName}" to ~/.playwright-sessions/${sessionName}.json`,
    );
    if (serviceNames.length > 0) {
      console.log(`  Detected: ${serviceNames.join(", ")}`);
    } else {
      console.log(`  No authenticated services detected.`);
    }
  } finally {
    await browser.close();
  }
}
