import type { Page } from "playwright";
import { PcsError } from "./errors.js";

const LOGIN_PATH_RE = /\/(login|signin|sign_in|auth|sso)(\/|$|\?)/;
const AUTH_QUERY_RE = /[?&](next|redirect|returnTo)=/;
const AUTH_TITLE_RE =
  /sign[ -]?in|log[ -]?in|login|authentication required|authorization required/i;
const CF_TITLE_RE = /just a moment|attention required/i;

const CAPTCHA_SELECTORS = [
  'iframe[src*="captcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="recaptcha"]',
];

const HOSTNAME_TO_SERVICE: Record<string, string> = {
  "github.com": "github",
  "accounts.google.com": "google",
  "login.microsoftonline.com": "microsoft",
  "vercel.com": "vercel",
  "supabase.com": "supabase",
  "linkedin.com": "linkedin",
  "instagram.com": "instagram",
  "twitter.com": "twitter",
  "x.com": "x",
  "notion.so": "notion",
  "neon.tech": "neon",
};

function serviceFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return HOSTNAME_TO_SERVICE[hostname] ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Returns true if the input URL itself is a login route — skip detection. */
export function isLoginUrl(url: string): boolean {
  try {
    return LOGIN_PATH_RE.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * Inspect a page after navigation. Throws PcsError(PCS_AUTH_WALL) if the page
 * looks like a login wall, Cloudflare challenge, or CAPTCHA.
 *
 * Skip when the input URL is itself a login route (intentional navigation).
 */
export async function checkAuthWall(
  page: Page,
  inputUrl: string,
  opts: { session?: string; service?: string } = {},
): Promise<void> {
  if (isLoginUrl(inputUrl)) return;

  const finalUrl = page.url();
  let signal: "url" | "title" | "challenge" | "captcha" | undefined;

  // 1. URL heuristic
  try {
    const parsed = new URL(finalUrl);
    if (
      LOGIN_PATH_RE.test(parsed.pathname) ||
      AUTH_QUERY_RE.test(parsed.search)
    ) {
      signal = "url";
    }
  } catch {
    // ignore malformed URL
  }

  const title = await page.title();

  // 2. Title heuristic
  if (!signal) {
    if (CF_TITLE_RE.test(title)) {
      signal = "challenge";
    } else if (AUTH_TITLE_RE.test(title)) {
      signal = "title";
    }
  }

  // 3. CAPTCHA heuristic
  if (!signal) {
    for (const sel of CAPTCHA_SELECTORS) {
      if ((await page.locator(sel).count()) > 0) {
        signal = "captcha";
        break;
      }
    }
    if (!signal) {
      const bodyText = await page.evaluate(() =>
        (document.body?.innerText ?? "").toLowerCase(),
      );
      if (bodyText.includes("verify you are human")) {
        signal = "captcha";
      }
    }
  }

  if (signal) {
    const service = opts.service ?? serviceFromUrl(finalUrl);
    const sessionName = opts.session ?? "none";
    throw new PcsError(
      "PCS_AUTH_WALL",
      `Auth wall detected (${signal}) at ${finalUrl}`,
      { finalUrl, title, signal, session: sessionName, service },
    );
  }
}
