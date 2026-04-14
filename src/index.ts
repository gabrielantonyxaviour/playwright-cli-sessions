/**
 * playwright-cli-sessions — public API
 *
 * Exports the store, probe, and detection primitives for programmatic use.
 * The CLI entry point is src/cli.ts.
 */

export {
  listSaved,
  listSavedNames,
  readSaved,
  writeSaved,
  deleteSaved,
  saveStorageState,
  cloneSession,
  tagService,
  SESSION_STORE_ROOT,
  PROBE_CACHE_FILE,
} from "./store.js";

export type {
  SavedSession,
  SavedSessionInfo,
  StorageState,
  Cookie,
  Origin,
} from "./store.js";

export { probeServices, getProbeCapableServices } from "./session-probe.js";
export type { ProbeResult } from "./session-probe.js";

export { detectAuth, mergeAuth, SERVICE_DOMAINS } from "./service-detector.js";
export type { DetectedAuth } from "./service-detector.js";

export { checkExpiry, enrichAuthWithExpiry } from "./session-expiry.js";
export type {
  ServiceExpiry,
  ExpiryStatus,
  AuthWithExpiry,
} from "./session-expiry.js";

export { getCachedProbeResults, getCacheAgeMinutes } from "./probe-cache.js";
