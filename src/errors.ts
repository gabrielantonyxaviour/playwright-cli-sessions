export type PcsErrorCode =
  | "PCS_AUTH_WALL"
  | "PCS_CHALLENGE_WALL"
  | "PCS_AUTH_EXPIRED"
  | "PCS_STALE_SESSION"
  | "PCS_SELECTOR_TIMEOUT"
  | "PCS_HTTP_ERROR"
  | "PCS_NAV_FAILED"
  | "PCS_NETWORK"
  | "PCS_INVALID_FLAG"
  | "PCS_MISSING_ARG"
  | "PCS_INVALID_INPUT"
  | "PCS_SESSION_NOT_FOUND"
  | "PCS_BROWSER_CRASH"
  | "PCS_BROWSER_CONTROL_LOST"
  | "PCS_REMOTE_UNREACHABLE"
  | "PCS_UNKNOWN";

export class PcsError extends Error {
  constructor(
    public readonly code: PcsErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
    /**
     * Concrete actions the caller (usually an AI agent) should take next.
     * If empty/omitted, the CLI's catch handler falls back to
     * DEFAULT_NEXT_STEPS[code]. Per-call overrides win — promote
     * service-specific advice (e.g. "run `refresh gabriel-vercel`") here.
     *
     * The whole point of this field: every failure must answer
     * "what do I do next" so agents stop blind-retrying. Empty stderr
     * is the load-bearing bug we're killing.
     */
    public readonly nextSteps: string[] = [],
  ) {
    super(message);
    this.name = "PcsError";
  }
}

export const EXIT_CODE_MAP: Record<PcsErrorCode, number> = {
  PCS_AUTH_WALL: 77,
  PCS_CHALLENGE_WALL: 78,
  PCS_AUTH_EXPIRED: 77,
  PCS_STALE_SESSION: 77,
  PCS_SELECTOR_TIMEOUT: 10,
  PCS_HTTP_ERROR: 11,
  PCS_NAV_FAILED: 11,
  PCS_NETWORK: 12,
  PCS_INVALID_FLAG: 2,
  PCS_MISSING_ARG: 2,
  PCS_INVALID_INPUT: 2,
  PCS_SESSION_NOT_FOUND: 3,
  PCS_BROWSER_CRASH: 20,
  PCS_BROWSER_CONTROL_LOST: 21,
  PCS_REMOTE_UNREACHABLE: 79,
  PCS_UNKNOWN: 1,
};

/**
 * Floor-level next-step advice per error code. Per-throw `nextSteps`
 * overrides this when the call site has more context. Keep entries short
 * and actionable — agents read these literally.
 */
export const DEFAULT_NEXT_STEPS: Record<PcsErrorCode, string[]> = {
  PCS_AUTH_WALL: [
    "If a session was provided, run `playwright-cli-sessions refresh <name>` to re-login.",
    "If no session was provided, this page needs auth — pass `--session=<name>` or run `login <name>` first.",
    "Don't loop: a second identical attempt will fail the same way.",
  ],
  PCS_CHALLENGE_WALL: [
    "A CAPTCHA / Cloudflare / Turnstile challenge is blocking this page.",
    "Run the suggested `login <name> --url=<url>` so the challenge can be solved in a real Chrome window.",
    "Once solved, the session cookie carries past the wall — re-run with `--session=<name>`.",
    "Don't try to script past it; it will not work.",
  ],
  PCS_AUTH_EXPIRED: [
    "The saved session is past its lifetime — run `playwright-cli-sessions refresh <name>`.",
    "After refreshing, re-run the original command with `--session=<name>`.",
  ],
  PCS_STALE_SESSION: [
    "The session probe says the cookies are no longer valid server-side.",
    "Run `playwright-cli-sessions refresh <name>` to re-establish them.",
  ],
  PCS_SELECTOR_TIMEOUT: [
    "The selector you waited on never appeared. Don't tweak the selector and retry yet — first SEE the page.",
    "Run `screenshot <url> --allow-http-error --out=/tmp/x.png` and look at it.",
    "If the page rendered something unexpected (auth wall, error, different layout), fix the root cause.",
    "If the selector is genuinely wrong, prefer `getByRole` / `getByText` over CSS — they survive layout changes.",
  ],
  PCS_HTTP_ERROR: [
    "The page returned a non-2xx status. Run with `--allow-http-error` to capture the page anyway, or check the URL.",
    "If you expected this status (e.g. 401 auth wall), pass `--allow-http-error` and continue.",
  ],
  PCS_NAV_FAILED: [
    "Navigation didn't reach load. First check the browser is alive: `playwright-cli-sessions browser status`.",
    "If the attached Chrome is dead, run `browser stop` then `browser start` and retry once.",
    "Try `--wait-until=domcontentloaded` (looser) to see if the page partially loaded.",
    'If still failing after one retry, file `report "<what you tried>"` instead of looping.',
  ],
  PCS_NETWORK: [
    "A network error blocked the request. Check Tailscale (if remote) and basic connectivity.",
    "If the failure is transient, ONE retry is fine. Don't loop.",
  ],
  PCS_INVALID_FLAG: [
    "An unknown or misspelled flag was passed. Check the suggestion above; only known flags are accepted.",
    "Run `playwright-cli-sessions --help` for the full flag list per command.",
  ],
  PCS_MISSING_ARG: [
    "The command needs more arguments. The error message shows the expected form — read it and try again.",
  ],
  PCS_INVALID_INPUT: [
    "The input wasn't accepted. Re-read the message — it explains what was rejected and why.",
  ],
  PCS_SESSION_NOT_FOUND: [
    "Run `playwright-cli-sessions list` to see saved session names (and check spelling).",
    "If the session genuinely doesn't exist yet, run `login <name> --url=<login-url>` to create it.",
  ],
  PCS_BROWSER_CRASH: [
    "Chromium crashed mid-command. Run `playwright-cli-sessions browser status` to inspect.",
    "Restart with `browser stop && browser start`, then retry ONCE.",
    "If it crashes again on the same URL, file `report` — don't loop.",
  ],
  PCS_BROWSER_CONTROL_LOST: [
    "The CLI lost control of the tab/window mid-action (page closed, browser disconnected, frame detached).",
    "1. Run `playwright-cli-sessions browser status` to see the live state.",
    "2. If state is DEAD or missing, run `browser stop` then `browser start`.",
    "3. Retry the original command ONCE.",
    '4. If it fails again, run `report "<what you tried>"` — do not loop. Something deeper is broken.',
  ],
  PCS_REMOTE_UNREACHABLE: [
    "PLAYWRIGHT_CLI_REMOTE is set but no attached Chrome is reachable on the remote host.",
    "1. `tailscale status | grep workers-macbook-pro` — is the worker up?",
    "2. If yes, run `playwright-cli-sessions browser start` (auto-routes to remote) and retry.",
    "3. If the worker is down, surface this to the user. Do NOT silently fall back to local Chrome.",
    "   The user must explicitly opt in via PLAYWRIGHT_CLI_ALLOW_LOCAL_FALLBACK=1.",
  ],
  PCS_UNKNOWN: [
    "An unexpected error escaped the structured paths. The message above is the raw cause.",
    'Run `playwright-cli-sessions browser status` to inspect state, then `report "<what you tried>"`.',
    "Don't retry blindly — file the report so this gap can be closed.",
  ],
};
