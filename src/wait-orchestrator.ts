import type { Page } from "playwright";
import { PcsError } from "./errors.js";

export interface WaitOpts {
  waitFor?: string;
  waitForText?: string;
  waitForCount?: string;
}

/**
 * Apply all wait primitives after page.goto() returns.
 * All specified waits must pass (AND semantics).
 * --wait-for-network=idle is promoted to waitUntil=networkidle at goto time, not here.
 */
export async function applyWaits(page: Page, opts: WaitOpts): Promise<void> {
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

  if (opts.waitForText !== undefined) {
    const text = opts.waitForText;
    try {
      await page.waitForFunction(
        (t: string) => (document.body?.innerText ?? "").includes(t),
        text,
        { timeout: 30000 },
      );
    } catch {
      throw new PcsError(
        "PCS_SELECTOR_TIMEOUT",
        `Text "${text}" not found within 30000ms`,
        { text },
      );
    }
  }

  if (opts.waitForCount !== undefined) {
    const raw = opts.waitForCount;
    const colon = raw.lastIndexOf(":");
    if (colon === -1) {
      throw new PcsError(
        "PCS_INVALID_FLAG",
        `--wait-for-count must be "selector:N", got "${raw}"`,
        { value: raw },
      );
    }
    const selector = raw.slice(0, colon);
    const count = parseInt(raw.slice(colon + 1), 10);
    if (!selector || isNaN(count)) {
      throw new PcsError(
        "PCS_INVALID_FLAG",
        `--wait-for-count must be "selector:N", got "${raw}"`,
        { value: raw },
      );
    }
    try {
      await page.waitForFunction(
        ({ sel, n }: { sel: string; n: number }) =>
          document.querySelectorAll(sel).length >= n,
        { sel: selector, n: count },
        { timeout: 30000 },
      );
    } catch {
      throw new PcsError(
        "PCS_SELECTOR_TIMEOUT",
        `"${selector}" count never reached ${count} within 30000ms`,
        { selector, count },
      );
    }
  }
}
