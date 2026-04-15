/**
 * snapshot <url> [--session=<name>]
 *
 * Navigate to a URL and print the full ARIA accessibility tree.
 * Useful for inspecting page structure before writing automation.
 *
 * Usage:
 *   playwright-cli-sessions snapshot https://github.com --session=gabriel-platforms
 */

import { chromium } from "playwright";
import type { BrowserContextOptions } from "playwright";
import { readSaved } from "../store.js";
import type { StorageState } from "../store.js";

// Our StorageState has `sameSite: string` but Playwright expects the union type.
// The data is wire-compatible; use this cast helper to bridge the gap.
type PlaywrightStorageState = NonNullable<
  BrowserContextOptions["storageState"]
>;
const asPlaywrightSS = (ss: StorageState): PlaywrightStorageState =>
  ss as unknown as PlaywrightStorageState;

export interface SnapshotOptions {
  session?: string;
}

export async function cmdSnapshot(
  url: string,
  opts: SnapshotOptions = {},
): Promise<void> {
  let storageState: StorageState | undefined;
  if (opts.session) {
    const saved = readSaved(opts.session);
    if (!saved) {
      throw new Error(
        `No saved session: "${opts.session}". Run \`playwright-cli-sessions list\` to see available sessions.`,
      );
    }
    storageState = saved.storageState;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(
      storageState ? { storageState: asPlaywrightSS(storageState) } : {},
    );
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const aria = await page.locator("html").ariaSnapshot();
      console.log(aria);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
