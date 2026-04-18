/**
 * screenshot <url> [--session=<name>] [--out=<path>]
 *
 * Navigate to a URL (optionally with saved session auth) and save a screenshot.
 * Default output: /tmp/screenshot-<timestamp>.png
 *
 * Usage:
 *   playwright-cli-sessions screenshot https://github.com --session=gabriel-platforms --out=/tmp/gh.png
 */

import type { BrowserContextOptions } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
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

export interface ScreenshotOptions {
  session?: string;
  out?: string;
  channel?: string;
  headed?: boolean;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  waitFor?: string;
  fullPage?: boolean;
}

export async function cmdScreenshot(
  url: string,
  opts: ScreenshotOptions = {},
): Promise<void> {
  const outPath = opts.out
    ? resolve(opts.out)
    : resolve(tmpdir(), `screenshot-${Date.now()}.png`);

  // Ensure parent directory exists — Playwright's screenshot() will ENOENT otherwise
  mkdirSync(dirname(outPath), { recursive: true });

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

  const browser = await launchStealthChrome({
    headless: !opts.headed,
    channel: opts.channel,
  });
  try {
    const context = await browser.newContext(
      storageState ? { storageState: asPlaywrightSS(storageState) } : {},
    );
    await context.addInitScript(STEALTH_INIT_SCRIPT);
    try {
      const page = await context.newPage();
      await page.goto(url, {
        waitUntil: opts.waitUntil ?? "domcontentloaded",
        timeout: 30000,
      });
      if (opts.waitFor) {
        await page.waitForSelector(opts.waitFor, { timeout: 30000 });
      }
      await page.screenshot({
        path: outPath,
        fullPage: opts.fullPage === true,
      });
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
