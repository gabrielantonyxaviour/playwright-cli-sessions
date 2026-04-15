/**
 * screenshot <url> [--session=<name>] [--out=<path>]
 *
 * Navigate to a URL (optionally with saved session auth) and save a screenshot.
 * Default output: /tmp/screenshot-<timestamp>.png
 *
 * Usage:
 *   playwright-cli-sessions screenshot https://github.com --session=gabriel-platforms --out=/tmp/gh.png
 */

import { chromium } from "playwright";
import type { BrowserContextOptions } from "playwright";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { readSaved } from "../store.js";
import type { StorageState } from "../store.js";

// Our StorageState has `sameSite: string` but Playwright expects the union type.
// The data is wire-compatible; use this cast helper to bridge the gap.
type PlaywrightStorageState = NonNullable<
  BrowserContextOptions["storageState"]
>;
const asPlaywrightSS = (ss: StorageState): PlaywrightStorageState =>
  ss as unknown as PlaywrightStorageState;

export interface ScreenshotOptions {
  session?: string;
  out?: string;
}

export async function cmdScreenshot(
  url: string,
  opts: ScreenshotOptions = {},
): Promise<void> {
  const outPath = opts.out
    ? resolve(opts.out)
    : resolve(tmpdir(), `screenshot-${Date.now()}.png`);

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
      await page.screenshot({ path: outPath, fullPage: false });
      const title = await page.title();
      console.log(`✓ Screenshot saved to ${outPath}`);
      console.log(`  Page: ${title} — ${page.url()}`);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
