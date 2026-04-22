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
  | "PCS_UNKNOWN";

export class PcsError extends Error {
  constructor(
    public readonly code: PcsErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
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
  PCS_UNKNOWN: 1,
};
