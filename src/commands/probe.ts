/**
 * probe <name> [--service=X] — run live HTTP probes for a saved session.
 *
 * Probes all detectable services (or just --service=X if specified).
 * Results are written to the shared probe cache (~/.playwright-sessions/.probe-cache.json).
 *
 * Usage:
 *   playwright-cli-sessions probe gabriel-socials-comms
 *   playwright-cli-sessions probe gabriel-platforms --service=GitHub
 */

import { readSaved } from "../store.js";
import { getCachedProbeResults } from "../probe-cache.js";
import { getProbeCapableServices } from "../session-probe.js";

interface ProbeOptions {
  service?: string;
}

export async function cmdProbe(
  name: string,
  opts: ProbeOptions = {},
): Promise<void> {
  const session = readSaved(name);
  if (!session) {
    throw new Error(
      `No saved session found for "${name}". Run \`playwright-cli-sessions list\` to see available sessions.`,
    );
  }

  const capableServices = new Set(getProbeCapableServices());
  const sessionServices = (session.auth ?? []).map((a) => a.service);

  let servicesToProbe: string[];
  if (opts.service) {
    if (!capableServices.has(opts.service)) {
      console.warn(
        `Warning: no probe endpoint configured for service "${opts.service}". Result will be "no-probe".`,
      );
    }
    servicesToProbe = [opts.service];
  } else {
    servicesToProbe = sessionServices;
    if (servicesToProbe.length === 0) {
      console.log(`No services detected in session "${name}".`);
      return;
    }
  }

  console.log(
    `Probing ${servicesToProbe.length} service(s) for "${name}"...\n`,
  );

  const results = await getCachedProbeResults(
    name,
    session.storageState,
    servicesToProbe,
    8000,
  );

  for (const r of results) {
    const auth = (session.auth ?? []).find((a) => a.service === r.service);
    const label = auth?.identity
      ? `${r.service} (${auth.identity})`
      : r.service;
    const padded = label.padEnd(34);

    let status: string;
    if (r.reason === "no-probe") {
      status = "[no-probe — no endpoint configured]";
    } else if (r.reason === "no-cookies") {
      status = "[no-cookies — not in this session]";
    } else if (r.alive) {
      status = `[LIVE, ${r.durationMs}ms]`;
    } else {
      status = `[DEAD, ${r.reason}]`;
    }

    console.log(`  ${padded} ${status}`);
  }

  console.log(
    `\nResults cached for 1 hour in ~/.playwright-sessions/.probe-cache.json`,
  );
}
