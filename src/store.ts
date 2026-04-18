/**
 * Filesystem store for ~/.playwright-sessions/
 *
 * File format mirrors playwright-sessions MCP exactly:
 *   { name, storageState, lastUrl, savedAt, savedBy, auth: DetectedAuth[] }
 *
 * Both tools read/write the same directory so sessions are fully interoperable.
 */

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  detectAuth,
  mergeAuth,
  type DetectedAuth,
} from "./service-detector.js";
import { checkExpiry, type ServiceExpiry } from "./session-expiry.js";

// Honor PLAYWRIGHT_SESSIONS_DIR so tests (and power-users) can sandbox the
// session store outside of ~/.playwright-sessions. Read once at module load —
// Playwright commands are short-lived, so env mutation mid-process is not a
// concern.
export const SESSION_STORE_ROOT =
  process.env.PLAYWRIGHT_SESSIONS_DIR &&
  process.env.PLAYWRIGHT_SESSIONS_DIR.length > 0
    ? process.env.PLAYWRIGHT_SESSIONS_DIR
    : join(homedir(), ".playwright-sessions");
export const PROBE_CACHE_FILE = join(SESSION_STORE_ROOT, ".probe-cache.json");
export const HEALTH_LOG_FILE = join(SESSION_STORE_ROOT, ".health.json");

// ── File-format types (must match MCP's SavedState exactly) ─────────

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

export interface Origin {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
}

export interface StorageState {
  cookies: Cookie[];
  origins?: Origin[];
}

export interface SavedSession {
  name: string;
  storageState: StorageState;
  lastUrl?: string;
  savedAt: string;
  savedBy: string;
  /** Auto-detected + manually tagged services */
  auth?: DetectedAuth[];
  /** Set when this session was cloned from another (clone-safety guard) */
  cloneOf?: string;
}

export interface SavedSessionInfo {
  name: string;
  lastUrl?: string;
  savedAt: string;
  savedBy: string;
  filePath: string;
  auth: DetectedAuth[];
  expiry: ServiceExpiry[];
  cloneOf?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

const SESSION_ID = `pid-${process.pid}-${Date.now().toString(36)}`;

export function ensureRoot(): void {
  if (!existsSync(SESSION_STORE_ROOT)) {
    mkdirSync(SESSION_STORE_ROOT, { recursive: true });
  }
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function filePath(name: string): string {
  return join(SESSION_STORE_ROOT, `${safeName(name)}.json`);
}

// ── Public API ────────────────────────────────────────────────────────

export function listSavedNames(): string[] {
  ensureRoot();
  return readdirSync(SESSION_STORE_ROOT)
    .filter(
      (f) => f.endsWith(".json") && !f.startsWith(".") && f !== "manifest.json",
    )
    .map((f) => f.replace(/\.json$/, ""));
}

export function readSaved(name: string): SavedSession | null {
  const path = filePath(name);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SavedSession;
  } catch {
    return null;
  }
}

/**
 * Write a session under the given filename (the canonical ID — what
 * `readSaved(name)` and `deleteSaved(name)` key on). The `name` argument is
 * intentionally explicit: callers that read by `name` and mutate must write
 * back under the *same* `name` even if the embedded `session.name` differs
 * (e.g. a session file renamed on disk, or a cloned-then-tagged session).
 *
 * The embedded `.name` is normalized to match the filename so the invariant
 * "filename stem === session.name" holds after every write.
 */
export function writeSaved(name: string, session: SavedSession): void {
  ensureRoot();
  const normalized: SavedSession =
    session.name === name ? session : { ...session, name };
  writeFileSync(filePath(name), JSON.stringify(normalized, null, 2));
}

export function deleteSaved(name: string): boolean {
  const path = filePath(name);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/**
 * Add a service tag to a saved session (manual identity labelling).
 * If `service` already exists, updates identity. Marks entry as manual.
 */
export function tagService(
  name: string,
  service: string,
  identity?: string,
): void {
  const session = readSaved(name);
  if (!session) throw new Error(`No saved session: "${name}"`);

  const auth = session.auth ?? [];
  const existing = auth.find((a) => a.service === service);
  if (existing) {
    if (identity) existing.identity = identity;
    existing.manual = true;
    existing.detectedAt = new Date().toISOString();
  } else {
    auth.push({
      service,
      domain: "manual",
      ...(identity ? { identity } : {}),
      manual: true,
      detectedAt: new Date().toISOString(),
    });
  }
  session.auth = auth;
  writeSaved(name, session);
}

/**
 * Save a storageState (from a file or object) under `name`.
 * Runs service detection and merges with existing manual tags.
 */
export function saveStorageState(
  name: string,
  storageState: StorageState,
  lastUrl?: string,
): SavedSession {
  const existing = readSaved(name);

  // Detect services; merge with existing manual tags
  const autoDetected = detectAuth(storageState);
  const auth = mergeAuth(autoDetected, existing?.auth);

  if (!storageState.origins || storageState.origins.length === 0) {
    console.warn(
      "Warning: no localStorage origins captured. Some services (e.g. Tinder) store auth in localStorage.",
    );
  }

  const session: SavedSession = {
    name,
    storageState,
    lastUrl,
    savedAt: new Date().toISOString(),
    savedBy: SESSION_ID,
    ...(auth.length > 0 ? { auth } : {}),
    ...(existing?.cloneOf ? { cloneOf: existing.cloneOf } : {}),
  };
  writeSaved(name, session);
  return session;
}

/**
 * Clone a session: copies src -> dst with `cloneOf` guard set.
 * Subsequent saves on the clone will throw unless --overwrite-source is used.
 */
export function cloneSession(srcName: string, dstName: string): SavedSession {
  const src = readSaved(srcName);
  if (!src) throw new Error(`No saved session: "${srcName}"`);

  const dst: SavedSession = {
    ...src,
    name: dstName,
    cloneOf: srcName,
    savedAt: new Date().toISOString(),
    savedBy: SESSION_ID,
  };
  writeSaved(dstName, dst);
  return dst;
}

/** List all saved sessions with auth + expiry metadata. */
export function listSaved(): SavedSessionInfo[] {
  ensureRoot();
  const files = readdirSync(SESSION_STORE_ROOT).filter(
    (f) => f.endsWith(".json") && !f.startsWith(".") && f !== "manifest.json",
  );
  const results: SavedSessionInfo[] = [];
  for (const file of files) {
    const path = join(SESSION_STORE_ROOT, file);
    try {
      const data = JSON.parse(readFileSync(path, "utf-8")) as SavedSession;
      if (!data.storageState) continue; // skip non-session files
      // Always use the filename stem as the canonical ID.
      // The embedded `name` field may differ from the filename (e.g. cloned/renamed
      // sessions) — the filename is what `readSaved()` / `deleteSaved()` key on.
      const name = file.replace(/\.json$/, "");
      const auth = data.auth ?? detectAuth(data.storageState);
      const expiry = checkExpiry(
        data.storageState,
        auth.map((a) => a.service),
      );
      results.push({
        name,
        lastUrl: data.lastUrl,
        savedAt: data.savedAt,
        savedBy: data.savedBy,
        filePath: path,
        auth,
        expiry,
        ...(data.cloneOf ? { cloneOf: data.cloneOf } : {}),
      });
    } catch {
      // Skip corrupted files
    }
  }
  return results;
}
