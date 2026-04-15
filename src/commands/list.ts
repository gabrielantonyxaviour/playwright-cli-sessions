/**
 * list — enumerate saved sessions with probe-based or cookie-based status.
 *
 * Usage:
 *   playwright-cli-sessions list [--probe=false] [--json]
 *
 * Default: runs live HTTP probes (1-hour cache) for all detected services.
 * Pass --probe=false to skip network calls and use cookie-expiry metadata only.
 */

import { listSaved } from "../store.js";
import {
  getCachedProbeResults,
  getCacheAgeMinutes,
  flushProbeCache,
} from "../probe-cache.js";
import { getProbeCapableServices } from "../session-probe.js";
import type { SavedSessionInfo } from "../store.js";
import type { ProbeResult } from "../session-probe.js";
import type { ServiceExpiry } from "../session-expiry.js";

interface ListOptions {
  probe: boolean;
  json: boolean;
}

// ── Status formatters ────────────────────────────────────────────────

function formatProbeStatus(result: ProbeResult, ageMin: number | null): string {
  if (result.reason === "no-probe") return "[no-probe]";
  if (result.reason === "no-cookies") return "[no-cookies]";
  if (result.alive) {
    const age = ageMin !== null ? `, probed ${ageMin}m ago` : "";
    return `[LIVE${age}]`;
  }
  return `[DEAD, ${result.reason}]`;
}

function formatExpiryStatus(expiry: ServiceExpiry | undefined): string {
  if (!expiry) return "[unknown]";
  switch (expiry.status) {
    case "valid":
      return `[cookie-valid ${expiry.daysUntilExpiry}d]`;
    case "expiring-soon":
      return `[expiring-soon ${expiry.daysUntilExpiry}d]`;
    case "expired":
      return "[cookie-expired]";
    case "session-only":
      return "[session-cookie]";
    default:
      return "[unknown]";
  }
}

function formatSessionHeader(info: SavedSessionInfo): string {
  const date = info.savedAt ? info.savedAt.slice(0, 10) : "unknown";
  const urlPart = info.lastUrl ? `, ${info.lastUrl}` : "";
  const clonePart = info.cloneOf ? ` [clone of ${info.cloneOf}]` : "";
  return `${info.name} (saved ${date}${urlPart})${clonePart}`;
}

// ── Main export ──────────────────────────────────────────────────────

export async function cmdList(opts: ListOptions): Promise<void> {
  const sessions = listSaved();

  if (sessions.length === 0) {
    console.log("No saved sessions found in ~/.playwright-sessions/");
    return;
  }

  const capableServices = new Set(getProbeCapableServices());

  // Collect all results
  const sessionResults: Array<{
    info: SavedSessionInfo;
    probeMap?: Map<string, ProbeResult>;
    cacheAgeMin: number | null;
  }> = [];

  if (opts.probe) {
    // Parallel probes across all sessions.
    //
    // Always call getCachedProbeResults with ALL detected services — not just
    // ones in local PROBE_ENDPOINTS. The shared .probe-cache.json is populated
    // by both CLI and MCP; if MCP has cached a DEAD result for a service CLI
    // can't probe itself, we still want to honor it instead of falling through
    // to cookie metadata (which can show `cookie-valid Nd` for server-invalidated
    // sessions). Services with no cache entry AND no local probe endpoint get
    // a "no-probe" result and fall back to cookie metadata in the renderer.
    await Promise.all(
      sessions.map(async (info) => {
        const allServices = info.auth.map((a) => a.service);

        let probeMap = new Map<string, ProbeResult>();
        const cacheAgeMin = getCacheAgeMinutes(info.name);

        if (allServices.length > 0) {
          const results = await getCachedProbeResults(
            info.name,
            await readStorageState(info.filePath),
            allServices,
          );
          probeMap = new Map(results.map((r) => [r.service, r]));
        }

        sessionResults.push({ info, probeMap, cacheAgeMin });
      }),
    );
    // Single flush after all parallel probes — eliminates concurrent-write race (fix A1)
    flushProbeCache();
  } else {
    for (const info of sessions) {
      sessionResults.push({ info, cacheAgeMin: null });
    }
  }

  if (opts.json) {
    // JSON output
    const out = sessionResults.map(({ info, probeMap, cacheAgeMin }) => ({
      name: info.name,
      savedAt: info.savedAt,
      lastUrl: info.lastUrl,
      cloneOf: info.cloneOf,
      services: info.auth.map((a) => {
        const probeResult = probeMap?.get(a.service);
        const expiry = info.expiry.find((e) => e.service === a.service);
        return {
          service: a.service,
          identity: a.identity,
          ...(probeResult
            ? {
                alive: probeResult.alive,
                probeReason: probeResult.reason,
                cacheAgeMin,
              }
            : {
                expiryStatus: expiry?.status ?? "unknown",
                daysUntilExpiry: expiry?.daysUntilExpiry,
              }),
        };
      }),
    }));
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  // Human-readable output
  for (const { info, probeMap, cacheAgeMin } of sessionResults) {
    console.log(formatSessionHeader(info));

    if (info.auth.length === 0) {
      console.log("  (no services detected)");
    } else {
      for (const a of info.auth) {
        const label = a.identity ? `${a.service} (${a.identity})` : a.service;
        const padded = label.padEnd(34);

        let status: string;
        if (probeMap) {
          const result = probeMap.get(a.service);
          if (result) {
            status = formatProbeStatus(result, cacheAgeMin);
          } else if (capableServices.has(a.service)) {
            // Probe-capable but probe returned no result — distinguish from
            // genuinely non-probe-capable services so we don't mislead with
            // "cookie-valid Nd" (fix A2: GitHub server-invalidated token bug)
            const expiry = info.expiry.find((e) => e.service === a.service);
            const expiryStr = expiry
              ? formatExpiryStatus(expiry).replace("[", "").replace("]", "")
              : "unknown";
            status = `[no-probe-result, cookie ${expiryStr}]`;
          } else {
            // Not probe-capable — cookie metadata is the only source
            const expiry = info.expiry.find((e) => e.service === a.service);
            status = formatExpiryStatus(expiry);
          }
        } else {
          const expiry = info.expiry.find((e) => e.service === a.service);
          status = formatExpiryStatus(expiry);
        }

        console.log(`  ${padded} ${status}`);
      }
    }
    console.log();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

async function readStorageState(filePath: string): Promise<unknown> {
  const { readFileSync } = await import("node:fs");
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    return data.storageState ?? null;
  } catch {
    return null;
  }
}
