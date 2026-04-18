/**
 * clone <source> <newName> — copy a saved session under a new name.
 *
 * The clone has `cloneOf` set in its metadata. If you later call `save` on
 * the clone, it will throw — clones are throwaway by design, matching the
 * playwright-sessions MCP v0.2.0 clone-safety model.
 *
 * To refresh the source from a modified clone, pass --overwrite-source.
 */

import { readSaved, cloneSession, saveStorageState } from "../store.js";
import { PcsError } from "../errors.js";

interface CloneOptions {
  overwriteSource?: boolean;
}

export async function cmdClone(
  srcName: string,
  dstName: string,
  opts: CloneOptions = {},
): Promise<void> {
  const src = readSaved(srcName);
  if (!src) {
    throw new PcsError(
      "PCS_SESSION_NOT_FOUND",
      `No saved session found for "${srcName}".`,
      { session: srcName },
    );
  }

  const existingDst = readSaved(dstName);
  if (existingDst && !opts.overwriteSource) {
    throw new PcsError(
      "PCS_INVALID_INPUT",
      `Session "${dstName}" already exists. Use a different name, or pass --overwrite-source to replace it.`,
      { session: dstName },
    );
  }

  const clone = cloneSession(srcName, dstName);
  const serviceNames = (clone.auth ?? []).map((a) =>
    a.identity ? `${a.service} (${a.identity})` : a.service,
  );

  console.log(`✓ Cloned "${srcName}" → "${dstName}"`);
  if (serviceNames.length > 0) {
    console.log(`  Services: ${serviceNames.join(", ")}`);
  }
  console.log(
    `  Note: this clone is throwaway — save will fail unless you use --overwrite-source.`,
  );
}

/**
 * Called by `save <name>` when the session has cloneOf set.
 * Throws unless --overwrite-source=<sourceSessionName> is specified.
 */
export function assertNotClone(name: string, overwriteSource?: string): void {
  const session = readSaved(name);
  if (!session?.cloneOf) return; // not a clone, fine

  if (overwriteSource === session.cloneOf) {
    // Allowed: we're intentionally refreshing the source from the clone
    // The save command will call saveStorageState which handles this
    return;
  }

  throw new PcsError(
    "PCS_INVALID_INPUT",
    `"${name}" is a clone of "${session.cloneOf}". ` +
      `Saving a clone is not allowed — it would silently diverge from the source.\n` +
      `To refresh the source with this clone's state, run:\n` +
      `  playwright-cli-sessions save ${name} --overwrite-source=${session.cloneOf}`,
    { session: name, cloneOf: session.cloneOf },
  );
}
