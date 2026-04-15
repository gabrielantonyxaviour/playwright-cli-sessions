/**
 * navigate <url> [--session=<name>] [--snapshot]
 *
 * Navigate to a URL (optionally with saved session auth) and print page info.
 * With --snapshot, also prints the ARIA accessibility tree.
 *
 * Usage:
 *   playwright-cli-sessions navigate https://github.com --session=gabriel-platforms --snapshot
 */

import type { BrowserContextOptions } from "playwright";
import { launchStealthChrome, STEALTH_INIT_SCRIPT } from "../browser-launch.js";
import { readSaved } from "../store.js";
import type { StorageState } from "../store.js";

// Our StorageState has `sameSite: string` but Playwright expects the union type.
// The data is wire-compatible; use this cast helper to bridge the gap.
type PlaywrightStorageState = NonNullable<
  BrowserContextOptions["storageState"]
>;
const asPlaywrightSS = (ss: StorageState): PlaywrightStorageState =>
  ss as unknown as PlaywrightStorageState;

export interface NavigateOptions {
  session?: string;
  snapshot?: boolean;
}

export async function cmdNavigate(
  url: string,
  opts: NavigateOptions = {},
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

  const browser = await launchStealthChrome({ headless: true });
  try {
    const context = await browser.newContext(
      storageState ? { storageState: asPlaywrightSS(storageState) } : {},
    );
    await context.addInitScript(STEALTH_INIT_SCRIPT);
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const title = await page.title();
      console.log(`✓ Navigated to ${page.url()}`);
      console.log(`  Title: ${title}`);

      if (opts.snapshot) {
        const aria = await page.locator("html").ariaSnapshot();
        console.log(aria);
      }
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
