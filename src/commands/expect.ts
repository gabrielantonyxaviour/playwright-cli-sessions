/**
 * expect <url> — assert page properties from the shell, without writing a script.
 *
 * Motivation:
 *   `navigate` and `snapshot` dump raw output; the caller has to parse it and
 *   decide pass/fail. `exec` works but requires a .mjs file for one-shot checks.
 *   `expect` closes the gap with a declarative, exit-code-driven assertion:
 *
 *     playwright-cli-sessions expect https://example.com --title="Example Domain"
 *     playwright-cli-sessions expect https://gh.com --session=x --selector="main"
 *
 *   Exits 0 on success, 1 on assertion failure. Infrastructure errors (bad
 *   session, auth wall, nav failure) propagate as PcsErrors (exit 77/11/3/etc).
 *
 * Expectations (any combination):
 *   --title=<substr>      page.title() must contain <substr>
 *   --selector=<sel>      element matching <sel> must be visible
 *   --text=<substr>       text <substr> must appear somewhere on the page
 *   --status=<code>       navigation response status must equal <code>
 *
 * Controls:
 *   --timeout=<ms>        max ms to wait for any single expectation (default 10000)
 *   --retry=<N>           times to retry the whole check on failure (default 0)
 *   --screenshot-on-fail=<path>
 *                         save a full-page screenshot when the check ultimately fails
 */

import type { BrowserContextOptions, Response } from "playwright";
import {
  launchStealthChrome,
  createStealthContext,
} from "../browser-launch.js";
import { readSaved } from "../store.js";
import type { StorageState } from "../store.js";
import { PcsError } from "../errors.js";
import { checkAuthWall } from "../auth-wall.js";
import { checkHttpError } from "../http-guard.js";
import { checkSessionFreshness } from "../session-use.js";
import { dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

type PlaywrightStorageState = NonNullable<
  BrowserContextOptions["storageState"]
>;
const asPlaywrightSS = (ss: StorageState): PlaywrightStorageState =>
  ss as unknown as PlaywrightStorageState;

export interface ExpectOptions {
  title?: string;
  selector?: string;
  text?: string;
  status?: number;
  timeout?: number;
  retry?: number;
  session?: string;
  channel?: string;
  waitFor?: string;
  waitForText?: string;
  waitForCount?: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  headed?: boolean;
  screenshotOnFail?: string;
  noProbe?: boolean;
  allowHttpError?: boolean;
}

/**
 * Run all assertions against a freshly loaded page. Returns the list of
 * failure messages (empty on success). PcsErrors (auth wall, nav failure, etc.)
 * propagate out — they are not treated as assertion failures.
 */
async function runOnce(
  url: string,
  opts: ExpectOptions,
  storageState: StorageState | undefined,
): Promise<{ failures: string[]; screenshotBytes?: Buffer }> {
  const timeout = opts.timeout ?? 10000;
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
    const page = await context.newPage();

    let response: Response | null;
    try {
      response = await page.goto(url, {
        waitUntil: opts.waitUntil ?? "domcontentloaded",
        timeout,
      });
    } catch (e) {
      return {
        failures: [`navigation: ${(e as Error).message.split("\n")[0]}`],
      };
    }

    if (opts.waitFor) {
      try {
        await page.waitForSelector(opts.waitFor, { timeout });
      } catch {
        return {
          failures: [
            `wait-for: "${opts.waitFor}" not found within ${timeout}ms`,
          ],
        };
      }
    }

    if (opts.waitForText !== undefined) {
      const text = opts.waitForText;
      try {
        await page.waitForFunction(
          (t: string) => (document.body?.innerText ?? "").includes(t),
          text,
          { timeout },
        );
      } catch {
        return {
          failures: [`wait-for-text: "${text}" not found within ${timeout}ms`],
        };
      }
    }

    if (opts.waitForCount !== undefined) {
      const raw = opts.waitForCount;
      const colon = raw.lastIndexOf(":");
      if (colon === -1 || !raw.slice(0, colon)) {
        return {
          failures: [
            `wait-for-count: invalid format "${raw}", expected "selector:N"`,
          ],
        };
      }
      const selector = raw.slice(0, colon);
      const count = parseInt(raw.slice(colon + 1), 10);
      try {
        await page.waitForFunction(
          ({ sel, n }: { sel: string; n: number }) =>
            document.querySelectorAll(sel).length >= n,
          { sel: selector, n: count },
          { timeout },
        );
      } catch {
        return {
          failures: [
            `wait-for-count: "${selector}" count never reached ${count} within ${timeout}ms`,
          ],
        };
      }
    }

    // Auth wall check — throws PcsError(PCS_AUTH_WALL) if detected, propagates up
    await checkAuthWall(page, url, { session: opts.session });
    // HTTP-error guard — skip when user is asserting on a specific status code
    await checkHttpError(response, url, {
      allowHttpError: opts.allowHttpError || opts.status !== undefined,
    });

    const failures: string[] = [];

    if (opts.status !== undefined) {
      const actual = response?.status();
      if (actual !== opts.status) {
        failures.push(
          `status: expected ${opts.status}, got ${actual ?? "<no response>"}`,
        );
      }
    }

    if (opts.title !== undefined) {
      const title = await page.title();
      if (!title.includes(opts.title)) {
        failures.push(
          `title: expected to contain "${opts.title}", got "${title}"`,
        );
      }
    }

    if (opts.selector !== undefined) {
      try {
        await page
          .locator(opts.selector)
          .first()
          .waitFor({ state: "visible", timeout });
      } catch {
        failures.push(
          `selector: "${opts.selector}" not visible within ${timeout}ms`,
        );
      }
    }

    if (opts.text !== undefined) {
      try {
        await page
          .getByText(opts.text, { exact: false })
          .first()
          .waitFor({ state: "visible", timeout });
      } catch {
        failures.push(`text: "${opts.text}" not found within ${timeout}ms`);
      }
    }

    let screenshotBytes: Buffer | undefined;
    if (failures.length > 0 && opts.screenshotOnFail) {
      try {
        screenshotBytes = await page.screenshot({ fullPage: true });
      } catch {
        // Best-effort — don't mask the assertion failure with a screenshot error.
      }
    }

    return { failures, ...(screenshotBytes ? { screenshotBytes } : {}) };
  } finally {
    await browser.close();
  }
}

export async function cmdExpect(
  url: string,
  opts: ExpectOptions = {},
): Promise<void> {
  if (
    opts.title === undefined &&
    opts.selector === undefined &&
    opts.text === undefined &&
    opts.status === undefined
  ) {
    throw new PcsError(
      "PCS_MISSING_ARG",
      "expect requires at least one of --title, --selector, --text, or --status.",
    );
  }

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

  const retry = Math.max(0, opts.retry ?? 0);
  let lastFailures: string[] = [];
  let lastScreenshot: Buffer | undefined;

  for (let attempt = 0; attempt <= retry; attempt++) {
    const { failures, screenshotBytes } = await runOnce(
      url,
      opts,
      storageState,
    );
    if (failures.length === 0) {
      console.log(`✓ ${url} — all expectations passed`);
      return;
    }
    lastFailures = failures;
    lastScreenshot = screenshotBytes;
    if (attempt < retry) {
      const wait = 1000 * (attempt + 1);
      console.error(
        `  attempt ${attempt + 1}/${retry + 1} failed, retrying in ${wait}ms...`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  console.error(`✗ ${url} — ${lastFailures.length} expectation(s) failed:`);
  for (const f of lastFailures) console.error(`  - ${f}`);

  if (opts.screenshotOnFail && lastScreenshot) {
    const fs = await import("node:fs");
    const dir = dirname(opts.screenshotOnFail);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    fs.writeFileSync(opts.screenshotOnFail, lastScreenshot);
    console.error(`  screenshot saved: ${opts.screenshotOnFail}`);
  }

  process.exit(1);
}
