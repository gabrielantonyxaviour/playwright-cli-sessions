/**
 * Shared browser-launch helper for every CLI command that spawns Chromium.
 *
 * ⚠️  ARCHITECTURAL CONSTRAINT — DO NOT POLL BROWSER APIs
 * ────────────────────────────────────────────────────────
 * NEVER call storageState(), page.evaluate(), or any Playwright browser API
 * on a recurring timer (setInterval / setTimeout loop). On macOS, each call
 * activates the browser window and steals OS-level focus, making the machine
 * unusable. The only safe pattern is a single capture triggered by a user
 * action (Enter key press or browser window close).
 *
 * What this solves
 * ----------------
 * Playwright's default "bundled Chromium" is actually **Chrome for Testing** —
 * a distinct build identified by its patch version (`147.0.7727.15` vs a real
 * Chrome's `147.0.7727.56`), empty plugin array, and `navigator.webdriver === true`.
 * Sites with commodity bot detection (Tinder, Bumble, Instagram, Cloudflare-gated
 * endpoints) flag it on first contact and shadowban / block the account.
 *
 * To avoid that we:
 *   1. Launch the real system Chrome via `channel: "chrome"` (not the bundled
 *      Chrome for Testing).
 *   2. Remove the `--enable-automation` switch so the browser doesn't advertise
 *      itself as automated.
 *   3. Add `--disable-blink-features=AutomationControlled` which flips
 *      `navigator.webdriver` from `true` to `false`.
 *
 * Stealth patch (v0.3.2+, enabled by default when using --channel=chrome)
 * -----------------------------------------------------------------------
 * Even with the above, Playwright's --headless=new mode still emits
 * `HeadlessChrome/<ver>` in both the HTTP User-Agent header and navigator.userAgent.
 * CDN-level bot filters (Cloudflare, Akamai, DataDome, PerimeterX) check the
 * UA header at the edge before any JavaScript runs. The stealth patch rewrites
 * it to `Chrome/<ver>` and also spoofs navigator.connection.rtt (reported as 0
 * in headless) and devicePixelRatio (always 1 in headless, should be 2 on Mac).
 *
 * This is handled by createStealthContext() — use it instead of browser.newContext()
 * directly. The patch is applied automatically when not in bundled mode and
 * PLAYWRIGHT_CLI_NO_STEALTH_PATCH is unset.
 *
 * Provenance: surfaced by a real Tinder signup field test against v0.3.1 on
 * 2026-04-18 which confirmed HeadlessChrome appeared in UA despite --channel=chrome.
 *
 * Opt-outs
 * --------
 * - `PLAYWRIGHT_CLI_BUNDLED=1` — use legacy bundled Chromium (no channel, no stealth).
 *   Useful for CI / headless servers without real Chrome installed.
 * - `PLAYWRIGHT_CLI_NO_STEALTH_PATCH=1` — keep --channel=chrome launch args but skip
 *   the UA rewrite, RTT spoof, and DPR patch. Useful if you want to test your own
 *   site's bot-detection pipeline against a headless UA.
 */

import { chromium } from "playwright";
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  LaunchOptions,
} from "playwright";

export interface LaunchOpts {
  headless?: boolean;
  /** Browser channel — "chrome" (default), "msedge", or omit for bundled Chromium. */
  channel?: string;
  /** Extra launch args appended to the stealth defaults. */
  args?: string[];
  /** Extra ignoreDefaultArgs entries appended to the stealth defaults. */
  ignoreDefaultArgs?: string[];
  /** Extra generic LaunchOptions forwarded to `chromium.launch`. */
  extra?: Omit<
    LaunchOptions,
    "headless" | "args" | "channel" | "ignoreDefaultArgs"
  >;
}

const STEALTH_ARGS = ["--disable-blink-features=AutomationControlled"];

const STEALTH_IGNORE = ["--enable-automation"];

export async function launchStealthChrome(
  opts: LaunchOpts = {},
): Promise<Browser> {
  const headless = opts.headless ?? true;
  const bundled = process.env.PLAYWRIGHT_CLI_BUNDLED === "1";

  if (bundled) {
    return chromium.launch({
      headless,
      args: opts.args,
      ...opts.extra,
    });
  }

  return chromium.launch({
    channel: opts.channel ?? "chrome",
    headless,
    args: [...STEALTH_ARGS, ...(opts.args ?? [])],
    ignoreDefaultArgs: [...STEALTH_IGNORE, ...(opts.ignoreDefaultArgs ?? [])],
    ...opts.extra,
  });
}

/**
 * Apply stealth init scripts to a BrowserContext. These are belt-and-suspenders
 * on top of the launch flags — even if some future Chrome release reverts
 * behavior around `--disable-blink-features`, these scripts keep
 * `navigator.webdriver` undefined and `window.chrome.runtime` present.
 */
export const STEALTH_INIT_SCRIPT = `
(() => {
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });
  } catch (e) {}
  try {
    if (window.chrome && !window.chrome.runtime) {
      window.chrome.runtime = {};
    }
  } catch (e) {}
})();
`;

/**
 * v0.3.2 fingerprint patches applied on top of the baseline init script.
 * Skipped when PLAYWRIGHT_CLI_NO_STEALTH_PATCH=1.
 */
export const STEALTH_PATCH_SCRIPT = `
(() => {
  try {
    if (navigator.connection) {
      Object.defineProperty(navigator.connection, 'rtt', {
        get: () => 50 + Math.floor(Math.random() * 50),
        configurable: true,
      });
    }
  } catch (e) {}
})();
`;

/** Build a headful-looking User-Agent string from a raw Chrome version number. */
function buildStealthUA(version: string): string {
  const platform = process.platform;
  if (platform === "win32") {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
  } else if (platform === "darwin") {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
  } else {
    return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
  }
}

/**
 * Create a BrowserContext with stealth settings applied.
 *
 * When the stealth patch is active (default: non-bundled + PLAYWRIGHT_CLI_NO_STEALTH_PATCH unset):
 *   - Rewrites the User-Agent to remove "HeadlessChrome" (fixes CDN-level UA detection)
 *   - Sets deviceScaleFactor to match the host OS (2 on macOS, 1 elsewhere)
 *   - Sets viewport to a realistic desktop size
 *   - Spoofs navigator.connection.rtt to a non-zero value
 *
 * Always applies the baseline init script (navigator.webdriver removal, chrome.runtime).
 */
export async function createStealthContext(
  browser: Browser,
  baseOpts: BrowserContextOptions = {},
): Promise<BrowserContext> {
  const bundled = process.env.PLAYWRIGHT_CLI_BUNDLED === "1";
  const noPatch = process.env.PLAYWRIGHT_CLI_NO_STEALTH_PATCH === "1";
  const shouldPatch = !bundled && !noPatch;

  const contextOpts: BrowserContextOptions = { ...baseOpts };

  if (shouldPatch) {
    const version = browser.version();
    const isMac = process.platform === "darwin";
    contextOpts.userAgent = buildStealthUA(version);
    contextOpts.deviceScaleFactor = isMac ? 2 : 1;
    contextOpts.viewport = isMac
      ? { width: 1440, height: 900 }
      : { width: 1920, height: 1080 };
  }

  const context = await browser.newContext(contextOpts);
  await context.addInitScript(STEALTH_INIT_SCRIPT);
  if (shouldPatch) {
    await context.addInitScript(STEALTH_PATCH_SCRIPT);
  }
  return context;
}
