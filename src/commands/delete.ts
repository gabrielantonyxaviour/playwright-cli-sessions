/**
 * delete <name> — remove a saved session from ~/.playwright-sessions/
 */

import { deleteSaved, readSaved } from "../store.js";

export function cmdDelete(name: string): void {
  const session = readSaved(name);
  if (!session) {
    throw new Error(
      `No saved session found for "${name}". Run \`playwright-cli-sessions list\` to see available sessions.`,
    );
  }

  const deleted = deleteSaved(name);
  if (deleted) {
    console.log(`✓ Deleted session "${name}"`);
  } else {
    throw new Error(`Failed to delete session "${name}".`);
  }
}
