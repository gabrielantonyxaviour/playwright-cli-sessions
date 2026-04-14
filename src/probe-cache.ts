/**
 * Probe result cache — ~/.playwright-sessions/.probe-cache.json
 *
 * TTL: 1 hour. Shared with the MCP so both tools benefit from each other's probes.
 *
 * Fix (A1): Module-level in-memory cache — load once on first call, flush once
 * after all parallel probes are done via flushProbeCache(). This eliminates the
 * concurrent-write race where 16 parallel Promise.all probes each read+wrote
 * the shared cache file, causing last-writer-wins corruption.
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

let memCache: ProbeCache | null = null;
let dirty = false;

function ensureLoaded(): ProbeCache {
  if (memCache) return memCache;
  if (!existsSync(PROBE_CACHE_FILE)) {
    memCache = {};
    return memCache;
  }
  try {
    memCache = JSON.parse(
      readFileSync(PROBE_CACHE_FILE, "utf-8"),
    ) as ProbeCache;
  } catch {
    memCache = {};
  }
  return memCache;
}

/**
 * Must be called by the caller (e.g. cmdList) once after all probes are done.
 * Writes the in-memory cache to disk in a single atomic write.
 */
export function flushProbeCache(): void {
  if (!dirty || !memCache) return;
  ensureRoot();
  writeFileSync(PROBE_CACHE_FILE, JSON.stringify(memCache, null, 2));
  dirty = false;
}

/**
 * Get probe results for a session, using cache when fresh (< 1h).
 * When stale or missing, runs live probes and updates the in-memory cache.
 * Call flushProbeCache() after all parallel calls are complete.
 */
export async function getCachedProbeResults(
  sessionName: string,
  storageState: unknown,
  services: string[],
  timeoutMs = 5000,
): Promise<ProbeResult[]> {
  const cache = ensureLoaded();
  const entry = cache[sessionName];
  const now = Date.now();

  if (entry && now - entry.probedAt < CACHE_TTL_MS) {
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

    const fresh = await probeServices(storageState, needsProbe, timeoutMs);
    for (const r of fresh) {
      entry.services[r.service] = {
        alive: r.alive,
        reason: r.reason,
        durationMs: r.durationMs,
      };
    }
    entry.probedAt = now;
    dirty = true;
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
  dirty = true;
  return results;
}

/** Age of cache entry in minutes, or null if not cached. */
export function getCacheAgeMinutes(sessionName: string): number | null {
  const cache = ensureLoaded();
  const entry = cache[sessionName];
  if (!entry) return null;
  return Math.floor((Date.now() - entry.probedAt) / 60000);
}
