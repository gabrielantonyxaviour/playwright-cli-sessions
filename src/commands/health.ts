/**
 * health — probe all sessions and notify on state transitions (alive → dead).
 *
 * Designed to be run daily via macOS LaunchAgent. Compares current probe
 * results against the last snapshot written to ~/.playwright-sessions/.health.json,
 * fires a macOS notification for each session that newly went dead, then
 * writes the updated snapshot.
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
import { sendHealthEmail } from "../notify-email.js";

// ── Snapshot types ────────────────────────────────────────────────────

interface Snapshot {
  ts: number;
  sessions: Record<
    string /* name */,
    Record<string /* service */, "alive" | "dead" | "unknown">
  >;
}

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
    // osascript may not be available in all environments — degrade gracefully
    console.error(`[notify] ${title}: ${body}`);
  }
}

// ── Main export ───────────────────────────────────────────────────────

export async function cmdHealth(): Promise<void> {
  const sessions = listSaved();
  const capableServices = new Set(getProbeCapableServices());

  const currSnapshot: Snapshot = { ts: Date.now(), sessions: {} };

  // Probe all sessions in parallel
  await Promise.all(
    sessions.map(async (info) => {
      const probeTargets = info.auth
        .map((a) => a.service)
        .filter((s) => capableServices.has(s));

      if (probeTargets.length === 0) return;

      // Re-read storageState from disk for probing
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
        currSnapshot.sessions[info.name][r.service] = r.alive
          ? "alive"
          : "dead";
      }
    }),
  );

  // One-shot flush after all parallel probes
  flushProbeCache();

  const prev = loadLastSnapshot();
  const transitions = diffTransitions(prev, currSnapshot);

  // Log every transition
  for (const t of transitions) {
    console.log(
      `[health] DEAD: Session "${t.session}" lost auth on ${t.service}`,
    );
  }

  // Notify: prefer email (Resend) when configured; fall back to osascript
  const emailTo = process.env.PLAYWRIGHT_HEALTH_EMAIL;
  const resendKey = process.env.RESEND_API_KEY;
  if (transitions.length > 0) {
    if (emailTo && resendKey) {
      const sent = await sendHealthEmail(
        transitions,
        currSnapshot,
        emailTo,
        resendKey,
      );
      if (!sent) {
        // fallback to osascript on email failure
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
      `[health] All ${total} probed session(s) OK — no state transitions.`,
    );
  }

  writeSnapshot(currSnapshot);
}
