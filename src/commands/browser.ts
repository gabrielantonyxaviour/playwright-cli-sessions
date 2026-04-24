/**
 * `browser` subcommand — manage the persistent attached Chrome.
 *
 *   browser start   [--headless] [--channel=<chrome|msedge>]
 *   browser stop
 *   browser status  [--json]
 *
 * When an attached Chrome is running, other browser commands (screenshot,
 * navigate, snapshot, exec, expect) connect to it via CDP instead of
 * launching a fresh Chrome per call. That gives you:
 *   - One visible window, not N window pops
 *   - A persistent profile (Google / OAuth logins survive across commands)
 *   - No cold-start cost per command
 */
import {
  getStatus,
  startAttached,
  stopAttached,
  type AttachedState,
} from "../attached-browser.js";
import { PcsError } from "../errors.js";

export interface BrowserOptions {
  headless?: boolean;
  channel?: string;
  json?: boolean;
}

export async function cmdBrowser(
  sub: string,
  opts: BrowserOptions = {},
): Promise<void> {
  switch (sub) {
    case "start":
      return doStart(opts);
    case "stop":
      return doStop();
    case "status":
      return doStatus(opts);
    default:
      throw new PcsError(
        "PCS_INVALID_INPUT",
        `Unknown browser subcommand "${sub}". Expected: start | stop | status`,
        { subcommand: sub },
      );
  }
}

async function doStart(opts: BrowserOptions): Promise<void> {
  const state = await startAttached({
    headless: opts.headless === true,
    channel: opts.channel,
  });
  const mode = state.headless ? "headless" : "headful";
  const where = state.remote
    ? ` via SSH tunnel → ${state.remote.host}:${state.remote.port}`
    : "";
  process.stdout.write(
    `✓ Attached Chrome started (${mode} ${state.channel})${where}\n` +
      `  local pid:  ${state.pid}${state.remote ? "  (ssh tunnel)" : "  (chrome)"}\n` +
      `  local port: ${state.port}\n` +
      `  profile:    ${state.userDataDir}\n` +
      `  started:    ${state.startedAt}\n` +
      (state.remote
        ? `  remote host: ${state.remote.host}\n` +
          `  remote pid:  ${state.remote.pid}\n` +
          `  remote port: ${state.remote.port}\n`
        : "") +
      `\n` +
      `Subsequent browser commands will attach to this Chrome automatically.\n` +
      `Run \`playwright-cli-sessions browser stop\` when you're done for the day.\n`,
  );
}

async function doStop(): Promise<void> {
  const stopped = await stopAttached();
  if (stopped) {
    process.stdout.write("✓ Attached Chrome stopped.\n");
  } else {
    process.stdout.write("No attached Chrome was running.\n");
  }
}

async function doStatus(opts: BrowserOptions): Promise<void> {
  const { running, state } = await getStatus();

  if (opts.json === true) {
    process.stdout.write(JSON.stringify({ running, state }, null, 2) + "\n");
    return;
  }

  if (!state) {
    process.stdout.write(
      `No attached Chrome. Run \`playwright-cli-sessions browser start\` to launch one.\n`,
    );
    return;
  }

  const mode = state.headless ? "headless" : "headful";
  const status = running ? "running" : "DEAD";
  const where = state.remote
    ? ` via SSH tunnel → ${state.remote.host}:${state.remote.port}`
    : "";
  process.stdout.write(
    `Attached Chrome: ${status} (${mode} ${state.channel})${where}\n` +
      `  local pid:  ${state.pid}${state.remote ? "  (ssh tunnel)" : "  (chrome)"}\n` +
      `  local port: ${state.port}\n` +
      `  profile:    ${state.userDataDir}\n` +
      `  started:    ${state.startedAt}\n` +
      (state.remote
        ? `  remote host: ${state.remote.host}\n` +
          `  remote pid:  ${state.remote.pid}  (chrome on ${state.remote.host})\n` +
          `  remote port: ${state.remote.port}\n`
        : ""),
  );

  if (!running) {
    process.stdout.write(
      `\nThe recorded Chrome is no longer alive/responsive. State file cleared.\n` +
        `Run \`playwright-cli-sessions browser start\` to launch a fresh one.\n`,
    );
  }
}

/** Helper for `AttachedState` → minimal summary string (for logging). */
export function summarizeAttached(state: AttachedState): string {
  return `pid=${state.pid} port=${state.port} ${state.headless ? "headless" : "headful"} ${state.channel}`;
}
