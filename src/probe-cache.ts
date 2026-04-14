/**
 * Probe result cache — ~/.playwright-sessions/.probe-cache.json
 *
 * TTL: 1 hour. Shared with the MCP so both tools benefit from each other's probes.
 * Format matches the cache shape defined in the rebuild plan (Task A3).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PROBE_CACHE_FILE, ensureRoot } from "./store.js";
import { probeServices, type ProbeResult } from "./session-probe.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  probedAt: number; // unix ms
  services: Record<
    string,
    { alive: boolean; reason: string; durationMs: number }
  >;
}

type ProbeCache = Record<string, CacheEntry>;

function readCache(): ProbeCache {
  if (!existsSync(PROBE_CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(PROBE_CACHE_FILE, "utf-8")) as ProbeCache;
  } catch {
    return {};
  }
}

function writeCache(cache: ProbeCache): void {
  ensureRoot();
  writeFileSync(PROBE_CACHE_FILE, JSON.stringify(cache, null, 2));
}

/**
 * Get probe results for a session, using cache when fresh (< 1h).
 * When stale or missing, runs live probes and updates the cache.
 */
export async function getCachedProbeResults(
  sessionName: string,
  storageState: unknown,
  services: string[],
  timeoutMs = 5000,
): Promise<ProbeResult[]> {
  const cache = readCache();
  const entry = cache[sessionName];
  const now = Date.now();

  if (entry && now - entry.probedAt < CACHE_TTL_MS) {
    // Return cached results, falling back to live probe for services not in cache
    const cached: ProbeResult[] = [];
    const needsProbe: string[] = [];
    for (const svc of services) {
      const hit = entry.services[svc];
      if (hit) {
        cached.push({
          service: svc,
          alive: hit.alive,
          reason: hit.reason,
          durationMs: hit.durationMs,
        });
      } else {
        needsProbe.push(svc);
      }
    }

    if (needsProbe.length === 0) return cached;

    // Probe the missing ones
    const fresh = await probeServices(storageState, needsProbe, timeoutMs);
    // Merge into cache
    for (const r of fresh) {
      entry.services[r.service] = {
        alive: r.alive,
        reason: r.reason,
        durationMs: r.durationMs,
      };
    }
    entry.probedAt = now;
    writeCache(cache);
    return [...cached, ...fresh];
  }

  // Cache miss or stale — probe all
  const results = await probeServices(storageState, services, timeoutMs);
  cache[sessionName] = {
    probedAt: now,
    services: Object.fromEntries(
      results.map((r) => [
        r.service,
        { alive: r.alive, reason: r.reason, durationMs: r.durationMs },
      ]),
    ),
  };
  writeCache(cache);
  return results;
}

/** Age of cache entry in minutes, or null if not cached. */
export function getCacheAgeMinutes(sessionName: string): number | null {
  const cache = readCache();
  const entry = cache[sessionName];
  if (!entry) return null;
  return Math.floor((Date.now() - entry.probedAt) / 60000);
}
