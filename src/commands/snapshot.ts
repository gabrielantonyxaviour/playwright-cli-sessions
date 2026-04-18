/**
 * snapshot <url> [--session=<name>]
 *
 * Navigate to a URL and print the full ARIA accessibility tree.
 * Useful for inspecting page structure before writing automation.
 *
 * Usage:
 *   playwright-cli-sessions snapshot https://github.com --session=gabriel-platforms
 */

import type { BrowserContextOptions } from "playwright";
import {
  launchStealthChrome,
  createStealthContext,
} from "../browser-launch.js";
import { readSaved } from "../store.js";
import type { StorageState } from "../store.js";
import { PcsError } from "../errors.js";
import { checkAuthWall } from "../auth-wall.js";

// Our StorageState has `sameSite: string` but Playwright expects the union type.
// The data is wire-compatible; use this cast helper to bridge the gap.
type PlaywrightStorageState = NonNullable<
  BrowserContextOptions["storageState"]
>;
const asPlaywrightSS = (ss: StorageState): PlaywrightStorageState =>
  ss as unknown as PlaywrightStorageState;

export interface SnapshotOptions {
  session?: string;
  channel?: string;
  headed?: boolean;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  waitFor?: string;
}

export async function cmdSnapshot(
  url: string,
  opts: SnapshotOptions = {},
): Promise<void> {
  let storageState: StorageState | undefined;
  if (opts.session) {
    const saved = readSaved(opts.session);
    if (!saved) {
      throw new PcsError(
        "PCS_SESSION_NOT_FOUND",
        `No saved session: "${opts.session}". Run \`playwright-cli-sessions list\` to see available sessions.`,
        { session: opts.session },
      );
    }
    storageState = saved.storageState;
  }

  const browser = await launchStealthChrome({
    headless: !opts.headed,
    channel: opts.channel,
  });
  const bundled =
    process.env.PLAYWRIGHT_CLI_BUNDLED === "1" || opts.channel === "chromium";
  try {
    const context = await createStealthContext(
      browser,
      storageState ? { storageState: asPlaywrightSS(storageState) } : {},
      bundled,
    );
    try {
      const page = await context.newPage();
      try {
        await page.goto(url, {
          waitUntil: opts.waitUntil ?? "domcontentloaded",
          timeout: 30000,
        });
      } catch (navErr) {
        throw new PcsError(
          "PCS_NAV_FAILED",
          (navErr as Error).message.split("\n")[0],
          { url },
        );
      }
      if (opts.waitFor) {
        try {
          await page.waitForSelector(opts.waitFor, { timeout: 30000 });
        } catch (selErr) {
          throw new PcsError(
            "PCS_SELECTOR_TIMEOUT",
            (selErr as Error).message.split("\n")[0],
            { selector: opts.waitFor },
          );
        }
      }
      await checkAuthWall(page, url, { session: opts.session });
      const aria = await page.locator("html").ariaSnapshot();
      console.log(aria);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
