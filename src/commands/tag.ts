/**
 * tag <name> <service> [identity] — manually label a service in a saved session.
 *
 * Useful when auto-detection missed a service or got the identity wrong.
 * Manual tags are preserved across subsequent saves (mergeAuth keeps them).
 *
 * Usage:
 *   playwright-cli-sessions tag gabriel-platforms LinkedIn "gabrielantony"
 *   playwright-cli-sessions tag gabriel-platforms WhatsApp   # service only, no identity
 */

import { tagService, readSaved } from "../store.js";

export function cmdTag(name: string, service: string, identity?: string): void {
  const session = readSaved(name);
  if (!session) {
    throw new Error(
      `No saved session found for "${name}". Run \`playwright-cli-sessions list\` to see available sessions.`,
    );
  }

  tagService(name, service, identity);

  const identityPart = identity ? ` (${identity})` : "";
  console.log(`✓ Tagged "${name}" with service: ${service}${identityPart}`);
}
