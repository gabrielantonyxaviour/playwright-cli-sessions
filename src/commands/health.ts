/**
 * health — probe all sessions and send a daily attention report.
 *
 * Designed to run daily via macOS LaunchAgent. The email is a full snapshot,
 * not just a transition log, so a session that has been dead since before the
 * first probe shipped still surfaces for attention.
 *
 * Usage:
 *   playwright-cli-sessions health
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { listSaved } from "../store.js";
import { HEALTH_LOG_FILE, ensureRoot } from "../store.js";
import { getCachedProbeResults, flushProbeCache } from "../probe-cache.js";
import { getProbeCapableServices } from "../session-probe.js";
import { sendHealthEmail, type Snapshot } from "../notify-email.js";

// ── Helpers ───────────────────────────────────────────────────────────

function loadLastSnapshot(): Snapshot | null {
  if (!existsSync(HEALTH_LOG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(HEALTH_LOG_FILE, "utf-8")) as Snapshot;
  } catch {
    return null;
  }
}

function writeSnapshot(snap: Snapshot): void {
  ensureRoot();
  writeFileSync(HEALTH_LOG_FILE, JSON.stringify(snap, null, 2));
}

function diffTransitions(
  prev: Snapshot | null,
  curr: Snapshot,
): Array<{ session: string; service: string; from: string; to: string }> {
  if (!prev) return [];
  const transitions: Array<{
    session: string;
    service: string;
    from: string;
    to: string;
  }> = [];
  for (const [sess, svcs] of Object.entries(curr.sessions)) {
    for (const [svc, state] of Object.entries(svcs)) {
      const before = prev.sessions[sess]?.[svc];
      if (before && before !== state && state === "dead") {
        transitions.push({
          session: sess,
          service: svc,
          from: before,
          to: state,
        });
      }
    }
  }
  return transitions;
}

function notify(title: string, body: string): void {
  try {
    execFileSync("osascript", [
      "-e",
      `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)} sound name "Submarine"`,
    ]);
  } catch {
    console.error(`[notify] ${title}: ${body}`);
  }
}

// ── Main export ───────────────────────────────────────────────────────

export async function cmdHealth(): Promise<void> {
  const sessions = listSaved();
  const capableServices = new Set(getProbeCapableServices());

  const currSnapshot: Snapshot = {
    ts: Date.now(),
    sessions: {},
    noProbeServices: {},
  };

  // Probe all sessions in parallel
  await Promise.all(
    sessions.map(async (info) => {
      const allServices = info.auth.map((a) => a.service);
      if (allServices.length === 0) return;

      const probeTargets = allServices.filter((s) => capableServices.has(s));
      const nonProbed = allServices.filter((s) => !capableServices.has(s));
      if (nonProbed.length > 0) {
        currSnapshot.noProbeServices![info.name] = nonProbed;
      }

      if (probeTargets.length === 0) {
        currSnapshot.sessions[info.name] = {};
        return;
      }

      let storageState: unknown = null;
      try {
        const { readFileSync: rf } = await import("node:fs");
        const data = JSON.parse(rf(info.filePath, "utf-8"));
        storageState = data.storageState ?? null;
      } catch {
        /* skip if file unreadable */
      }

      const results = await getCachedProbeResults(
        info.name,
        storageState,
        probeTargets,
      );

      currSnapshot.sessions[info.name] = {};
      for (const r of results) {
        if (r.reason === "no-probe" || r.reason === "no-cookies") continue;
        // Treat transient network failures as "unknown" — not "dead".
        // This prevents a single timeout from triggering an alive→dead
        // transition email. A truly dead cookie returns a definite 302/401.
        if (r.reason === "timeout" || r.reason === "error") {
          currSnapshot.sessions[info.name][r.service] = "unknown";
          continue;
        }
        currSnapshot.sessions[info.name][r.service] = r.alive
          ? "alive"
          : "dead";
      }
    }),
  );

  flushProbeCache();

  const prev = loadLastSnapshot();
  const transitions = diffTransitions(prev, currSnapshot);

  for (const t of transitions) {
    console.log(
      `[health] DEAD: Session "${t.session}" lost auth on ${t.service}`,
    );
  }

  // Decide whether to email: always email if we have an emailTo configured,
  // regardless of transitions. A stale-dead session is worth surfacing.
  const emailTo = process.env.PLAYWRIGHT_HEALTH_EMAIL;
  const resendKey = process.env.RESEND_API_KEY;

  // Compute zero-live sessions so we can decide fallback behavior.
  const zeroLiveCount = Object.entries(currSnapshot.sessions).filter(
    ([, svcs]) =>
      Object.values(svcs).every((s) => s !== "alive") &&
      Object.keys(svcs).length > 0,
  ).length;

  const worthEmailing = transitions.length > 0 || zeroLiveCount > 0;

  if (worthEmailing) {
    if (emailTo && resendKey) {
      const sent = await sendHealthEmail(
        transitions,
        currSnapshot,
        prev,
        emailTo,
        resendKey,
      );
      if (!sent) {
        for (const t of transitions) {
          notify(
            "Playwright Session Dead",
            `Session "${t.session}" lost auth on ${t.service}`,
          );
        }
      }
    } else {
      for (const t of transitions) {
        notify(
          "Playwright Session Dead",
          `Session "${t.session}" lost auth on ${t.service}`,
        );
      }
    }
  } else {
    const total = Object.keys(currSnapshot.sessions).length;
    console.log(
      `[health] All ${total} probed session(s) OK — no transitions, no zero-live sessions.`,
    );
  }

  writeSnapshot(currSnapshot);
}
