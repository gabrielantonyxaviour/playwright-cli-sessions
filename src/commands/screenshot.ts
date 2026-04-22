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
import {
  launchStealthChrome,
  createStealthContext,
} from "../browser-launch.js";
import { readSaved } from "../store.js";
import type { StorageState } from "../store.js";
import { PcsError } from "../errors.js";
import { checkAuthWall } from "../auth-wall.js";
import { checkHttpError } from "../http-guard.js";
import { applyWaits } from "../wait-orchestrator.js";
import { checkSessionFreshness } from "../session-use.js";
import { captureScreenshot } from "../screenshot-guard.js";

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
  waitForText?: string;
  waitForCount?: string;
  fullPage?: boolean;
  noProbe?: boolean;
  allowHttpError?: boolean;
  allowAuthWall?: boolean;
  timeout?: number;
  maxDimension?: number;
  noDownscale?: boolean;
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
      throw new PcsError(
        "PCS_SESSION_NOT_FOUND",
        `No saved session: "${opts.session}". Run \`playwright-cli-sessions list\` to see available sessions.`,
        { session: opts.session },
      );
    }
    await checkSessionFreshness(opts.session, saved, { noProbe: opts.noProbe });
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
      let response: import("playwright").Response | null = null;
      try {
        response = await page.goto(url, {
          waitUntil: opts.waitUntil ?? "domcontentloaded",
          timeout: opts.timeout ?? 30000,
        });
      } catch (navErr) {
        throw new PcsError(
          "PCS_NAV_FAILED",
          (navErr as Error).message.split("\n")[0],
          { url },
        );
      }
      if (!opts.allowAuthWall) {
        await checkAuthWall(page, url, { session: opts.session });
      }
      await checkHttpError(response, url, {
        allowHttpError: opts.allowHttpError,
      });
      await applyWaits(page, opts);
      await captureScreenshot(page, {
        path: outPath,
        fullPage: opts.fullPage === true,
        maxDimension: opts.maxDimension,
        noDownscale: opts.noDownscale,
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
