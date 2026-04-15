/**
 * Shared browser-launch helper for every CLI command that spawns Chromium.
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
 * This is Tier 1 stealth — it clears the most common detections. For services
 * that run Arkose/DataDome, a full stealth-plugin pass is still needed.
 *
 * Opt-out
 * -------
 * The `PLAYWRIGHT_CLI_BUNDLED=1` env var forces the legacy bundled-Chromium
 * behavior (no channel, no stealth args). Useful for CI, headless servers
 * without Chrome installed, or deliberate fingerprint testing.
 */

import { chromium } from "playwright";
import type { Browser, LaunchOptions } from "playwright";

export interface LaunchOpts {
  headless?: boolean;
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
    channel: "chrome",
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
