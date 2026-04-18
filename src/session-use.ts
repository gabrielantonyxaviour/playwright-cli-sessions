// Session freshness check — fires before browser launch on --session=<name>.
// If probe cache is older than PLAYWRIGHT_CLI_STALE_HOURS (default 6h) or
// missing, runs a fast synchronous probe. On DEAD throws PCS_STALE_SESSION
// (exit 77). Opt-outs: --no-probe flag, PLAYWRIGHT_CLI_NO_STALE_CHECK=1.

import {
  getCachedProbeResults,
  getCacheAgeMinutes,
  flushProbeCache,
} from "./probe-cache.js";
import { detectAuth } from "./service-detector.js";
import { PcsError } from "./errors.js";
import type { SavedSession } from "./store.js";

export interface FreshnessCheckOpts {
  noProbe?: boolean;
}

function formatTimeAgo(ageMinutes: number): string {
  if (ageMinutes < 60) return `${Math.round(ageMinutes)}m ago`;
  return `${Math.floor(ageMinutes / 60)}h ago`;
}

export async function checkSessionFreshness(
  sessionName: string,
  session: SavedSession,
  opts: FreshnessCheckOpts = {},
): Promise<void> {
  if (process.env.PLAYWRIGHT_CLI_NO_STALE_CHECK === "1") return;
  if (opts.noProbe) return;

  const rawHours = process.env.PLAYWRIGHT_CLI_STALE_HOURS;
  const staleHours =
    rawHours !== undefined && rawHours !== ""
      ? Math.max(0, parseFloat(rawHours) || 0)
      : 6;

  const ageMinutes = getCacheAgeMinutes(sessionName);
  const thresholdMinutes = staleHours * 60;

  if (ageMinutes !== null && ageMinutes < thresholdMinutes) return;

  const services = detectAuth(session.storageState).map((a) => a.service);

  const results = await getCachedProbeResults(
    sessionName,
    session.storageState,
    services,
    5000,
  );

  flushProbeCache();

  const dead = results.filter(
    (r) => !r.alive && r.reason !== "no-probe" && r.reason !== "no-cookies",
  );

  if (dead.length > 0) {
    const reason = dead[0].reason;
    const timeAgoStr =
      ageMinutes !== null ? formatTimeAgo(ageMinutes) : "never";
    throw new PcsError(
      "PCS_STALE_SESSION",
      `Session "${sessionName}" probe failed (${reason}). Last probed ${timeAgoStr}.\n  Run: playwright-cli-sessions refresh ${sessionName}`,
      { session: sessionName, reason, lastProbed: timeAgoStr },
    );
  }

  process.stderr.write(
    `✓ Session "${sessionName}" is live (probed just now)\n`,
  );
}
