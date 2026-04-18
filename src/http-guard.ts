import type { Response } from "playwright";
import { PcsError } from "./errors.js";

export interface HttpGuardOptions {
  allowHttpError?: boolean;
}

/**
 * After page.goto() returns, check the HTTP response status.
 * Throws PcsError(PCS_HTTP_ERROR) on 4xx/5xx unless opted out.
 * Call AFTER checkAuthWall — auth walls take priority.
 */
export async function checkHttpError(
  response: Response | null,
  url: string,
  opts: HttpGuardOptions = {},
): Promise<void> {
  if (
    opts.allowHttpError ||
    process.env.PLAYWRIGHT_CLI_ALLOW_HTTP_ERROR === "1"
  ) {
    return;
  }
  if (!response) return;
  const status = response.status();
  if (status >= 400) {
    const finalUrl = response.url();
    throw new PcsError("PCS_HTTP_ERROR", `HTTP ${status} on ${finalUrl}`, {
      status,
      url,
      finalUrl,
    });
  }
}
