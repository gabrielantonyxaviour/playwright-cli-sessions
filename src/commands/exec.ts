/**
 * exec <script> [<url>] [--session=<name>]
 *
 * Run a custom script against a page. The script must export a `run` function:
 *   export async function run({ page, context, browser }) { ... return result; }
 *
 * Usage:
 *   playwright-cli-sessions exec /tmp/my-script.mjs https://github.com --session=gabriel-platforms
 *   playwright-cli-sessions exec /tmp/my-script.mjs  # script navigates itself
 *
 * The return value of run() is printed to stdout (string as-is, objects as JSON).
 */

import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
} from "playwright";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  launchStealthChrome,
  createStealthContext,
} from "../browser-launch.js";
import { readSaved } from "../store.js";
import type { StorageState } from "../store.js";
import { PcsError } from "../errors.js";

// Our StorageState has `sameSite: string` but Playwright expects the union type.
// The data is wire-compatible; use this cast helper to bridge the gap.
type PlaywrightStorageState = NonNullable<
  BrowserContextOptions["storageState"]
>;
const asPlaywrightSS = (ss: StorageState): PlaywrightStorageState =>
  ss as unknown as PlaywrightStorageState;

export interface ExecOptions {
  session?: string;
  url?: string;
  channel?: string;
  headed?: boolean;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  waitFor?: string;
}

interface ScriptModule {
  run?: (args: {
    page: Page;
    context: BrowserContext;
    browser: Browser;
  }) => Promise<unknown>;
}

export async function cmdExec(
  scriptPath: string,
  opts: ExecOptions = {},
): Promise<void> {
  // Load and validate the script before launching the browser
  const absPath = pathToFileURL(resolve(scriptPath)).href;
  const mod = (await import(absPath)) as ScriptModule;
  const run = mod.run;

  if (typeof run !== "function") {
    throw new PcsError(
      "PCS_INVALID_INPUT",
      `Script must export a "run" function:\n  export async function run({ page, context, browser }) { ... }`,
      { scriptPath },
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

      if (opts.url) {
        await page.goto(opts.url, {
          waitUntil: opts.waitUntil ?? "domcontentloaded",
          timeout: 30000,
        });
        if (opts.waitFor) {
          await page.waitForSelector(opts.waitFor, { timeout: 30000 });
        }
      }

      const result = await run({ page, context, browser });

      if (result !== undefined) {
        if (typeof result === "string") {
          console.log(result);
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      }
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
