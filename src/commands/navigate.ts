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
import {
  acquireAttachedContext,
  guardLocalLaunch,
} from "../attached-browser.js";

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
  channel?: string;
  headless?: boolean;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  waitFor?: string;
  waitForText?: string;
  waitForCount?: string;
  noProbe?: boolean;
  allowHttpError?: boolean;
  allowAuthWall?: boolean;
  timeout?: number;
}

export async function cmdNavigate(
  url: string,
  opts: NavigateOptions = {},
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
    await checkSessionFreshness(opts.session, saved, { noProbe: opts.noProbe });
    storageState = saved.storageState;
  }

  const attached = await acquireAttachedContext(
    storageState ? asPlaywrightSS(storageState) : undefined,
  );

  if (attached) {
    const page = await attached.context.newPage();
    try {
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
      const title = await page.title();
      console.log(`✓ Navigated to ${page.url()}`);
      console.log(`  Title: ${title}`);

      if (opts.snapshot) {
        const aria = await page.locator("html").ariaSnapshot();
        console.log(aria);
      }
    } finally {
      try {
        await page.close();
      } catch {
        // ignore
      }
      await attached.dispose();
    }
    return;
  }

  guardLocalLaunch();

  const browser = await launchStealthChrome({
    headless: opts.headless === true,
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
