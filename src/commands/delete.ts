/**
 * delete <name> — remove a saved session from ~/.playwright-sessions/
 */

import { deleteSaved, readSaved } from "../store.js";
import { PcsError } from "../errors.js";

export function cmdDelete(name: string): void {
  const session = readSaved(name);
  if (!session) {
    throw new PcsError(
      "PCS_SESSION_NOT_FOUND",
      `No saved session found for "${name}". Run \`playwright-cli-sessions list\` to see available sessions.`,
      { session: name },
    );
  }

  const deleted = deleteSaved(name);
  if (deleted) {
    console.log(`✓ Deleted session "${name}"`);
  } else {
    throw new PcsError("PCS_UNKNOWN", `Failed to delete session "${name}".`, {
      session: name,
    });
  }
}
