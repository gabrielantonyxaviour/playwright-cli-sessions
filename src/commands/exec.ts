/**
 * exec <script> [<url>] [--session=<name>]
 *
 * Run a custom script against a page. The script must export a `run` function:
 *   export async function run({ page, context, browser }) { ... return result; }
 *
 * Inline eval mode (no file needed):
 *   playwright-cli-sessions exec --eval='return await page.title()' https://example.com
 *
 * Stdin mode:
 *   echo 'return { u: page.url() }' | playwright-cli-sessions exec - https://example.com
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
import { applyWaits } from "../wait-orchestrator.js";
import { checkSessionFreshness } from "../session-use.js";

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
  waitForText?: string;
  waitForCount?: string;
  noProbe?: boolean;
  allowAuthWall?: boolean;
  timeout?: number;
  evalScript?: string;
}

interface ScriptModule {
  run?: (args: {
    page: Page;
    context: BrowserContext;
    browser: Browser;
  }) => Promise<unknown>;
}

type RunFn = (args: {
  page: Page;
  context: BrowserContext;
  browser: Browser;
}) => Promise<unknown>;

function makeEvalRunner(code: string): RunFn {
  const fn = new Function(
    "page",
    "context",
    "browser",
    `return (async function(){ ${code} })()`,
  );
  return (ctx) => fn(ctx.page, ctx.context, ctx.browser) as Promise<unknown>;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8")),
    );
    process.stdin.on("error", reject);
  });
}

export async function cmdExec(
  scriptPath: string,
  opts: ExecOptions = {},
): Promise<void> {
  let run: RunFn;

  if (opts.evalScript !== undefined) {
    run = makeEvalRunner(opts.evalScript);
  } else if (scriptPath === "-") {
    const code = await readStdin();
    run = makeEvalRunner(code);
  } else {
    const absPath = pathToFileURL(resolve(scriptPath)).href;
    const mod = (await import(absPath)) as ScriptModule;
    const runFn = mod.run;
    if (typeof runFn !== "function") {
      throw new PcsError(
        "PCS_INVALID_INPUT",
        `Script must export a "run" function:\n  export async function run({ page, context, browser }) { ... }`,
        { scriptPath },
      );
    }
    run = runFn;
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
        try {
          await page.goto(opts.url, {
            waitUntil: opts.waitUntil ?? "domcontentloaded",
            timeout: opts.timeout ?? 30000,
          });
        } catch (navErr) {
          throw new PcsError(
            "PCS_NAV_FAILED",
            (navErr as Error).message.split("\n")[0],
            { url: opts.url },
          );
        }
        await applyWaits(page, opts);
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
