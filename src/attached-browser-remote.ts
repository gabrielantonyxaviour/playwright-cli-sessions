/**
 * attached-browser-remote — routes the attached-Chrome lifecycle to a remote
 * Mac (e.g. an M2 worker on Tailscale).
 *
 * Flow of `browser start` when PLAYWRIGHT_CLI_REMOTE=<ssh-host> is set:
 *   1. SSH to the host and run `playwright-cli-sessions browser start [...]`
 *      there. Parse the remote's CDP port + PID from its stdout.
 *   2. Spawn a detached `ssh -N -L <local>:127.0.0.1:<remote>` tunnel so the
 *      CDP WebSocket served by the remote Chrome is reachable at
 *      http://127.0.0.1:<local> on this machine. Every existing command
 *      (screenshot, navigate, exec, ...) already does
 *      `connectOverCDP("http://127.0.0.1:<port>")` — they are unchanged.
 *   3. Record the remote's host/port/pid and the local tunnel pid in the
 *      state file.
 *
 * `browser stop` reverses all three.
 *
 * Security notes:
 *   - SSH is the auth boundary. If the user's SSH config to <host> works,
 *     this works. No Chrome flag binds to the network; CDP stays on
 *     127.0.0.1 on the remote side too (the tunnel is the only bridge).
 *   - We run `source ~/.zshenv &&` before the remote CLI invocation —
 *     m2worker's non-interactive SSH shells don't auto-source zshrc, and
 *     Node/npx need the brew+fnm PATH exports from zshenv.
 */
import {
  execFile as execFileCb,
  spawn,
  type ChildProcess,
} from "node:child_process";
import { createConnection, createServer } from "node:net";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  AttachedRemoteInfo,
  AttachedState,
  StartOpts,
} from "./attached-browser.js";

const execFile = promisify(execFileCb);

/** Same helpers as the local module, duplicated to keep this file self-contained. */
function isPortResponsive(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port });
    const cleanup = (ok: boolean) => {
      sock.removeAllListeners();
      sock.destroy();
      resolve(ok);
    };
    sock.once("connect", () => cleanup(true));
    sock.once("error", () => cleanup(false));
    sock.setTimeout(timeoutMs, () => cleanup(false));
  });
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr === null || typeof addr === "string") {
        srv.close();
        reject(new Error("Could not determine free local port"));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Verify the SSH host is reachable and has a working `playwright-cli-sessions`
 * on PATH (via ~/.zshenv). Throws with a clean error if not.
 */
async function preflight(host: string): Promise<void> {
  try {
    await execFile(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        host,
        "source ~/.zshenv && command -v npx >/dev/null && echo OK",
      ],
      { timeout: 10_000 },
    );
  } catch (err) {
    const msg = (err as Error).message;
    throw new Error(
      `PLAYWRIGHT_CLI_REMOTE preflight failed for host "${host}".\n` +
        `  - Verify 'ssh ${host}' works without a password prompt.\n` +
        `  - Verify ~/.zshenv on ${host} puts node/npx on PATH for non-interactive shells.\n` +
        `Underlying error: ${msg}`,
    );
  }
}

/**
 * Run `browser start` on the remote via SSH. Returns parsed port+pid.
 * The CLI prints human-readable output (see src/commands/browser.ts doStart);
 * we grep port/pid from it. If the remote CLI's output format ever changes,
 * this parse needs updating — keep it in sync.
 */
async function remoteBrowserStart(
  host: string,
  opts: StartOpts,
): Promise<{ port: number; pid: number }> {
  const flags: string[] = [];
  if (opts.headless === true) flags.push("--headless");
  if (opts.channel) flags.push(`--channel=${opts.channel}`);

  // Call the remote's installed CLI via npx @latest, ensuring we pick up
  // whatever version is published — matches what the user installs locally.
  const remoteCmd = `source ~/.zshenv && npx playwright-cli-sessions@latest browser start ${flags.join(" ")}`;
  const { stdout, stderr } = await execFile("ssh", [host, remoteCmd], {
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const combined = stdout + "\n" + stderr;

  const portMatch = combined.match(/^\s*port:\s+(\d+)/m);
  const pidMatch = combined.match(/^\s*pid:\s+(\d+)/m);
  if (!portMatch || !pidMatch) {
    throw new Error(
      `Could not parse 'browser start' output from ${host}. Output:\n${combined}`,
    );
  }
  return { port: Number(portMatch[1]), pid: Number(pidMatch[1]) };
}

/**
 * Launch a background SSH tunnel mapping a local port → the remote Chrome's
 * CDP port on 127.0.0.1. `-N` means no remote command; the ssh process stays
 * alive just to hold the forward open. ExitOnForwardFailure makes ssh die
 * if the forward can't bind, instead of hanging silently.
 */
function startTunnel(
  host: string,
  localPort: number,
  remotePort: number,
): ChildProcess {
  const child = spawn(
    "ssh",
    [
      "-N",
      "-T",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=30",
      "-o",
      "ServerAliveCountMax=3",
      "-L",
      `${localPort}:127.0.0.1:${remotePort}`,
      host,
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  return child;
}

/** Public: start a remote attached Chrome + SSH tunnel. */
export async function startAttachedRemote(
  host: string,
  opts: StartOpts,
): Promise<AttachedState> {
  await preflight(host);

  const { port: remotePort, pid: remotePid } = await remoteBrowserStart(
    host,
    opts,
  );
  const localPort = await findFreePort();
  const tunnel = startTunnel(host, localPort, remotePort);

  // Wait for the tunnel to be usable.
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (await isPortResponsive(localPort)) {
      ready = true;
      break;
    }
    await sleep(100);
  }
  if (!ready) {
    try {
      if (typeof tunnel.pid === "number") process.kill(tunnel.pid, "SIGTERM");
    } catch {
      // ignore
    }
    // Also stop the remote Chrome to avoid leaking it.
    try {
      await execFile(
        "ssh",
        [
          host,
          "source ~/.zshenv && npx playwright-cli-sessions@latest browser stop",
        ],
        { timeout: 15_000 },
      );
    } catch {
      // best-effort
    }
    throw new Error(
      `SSH tunnel for remote Chrome on ${host}:${remotePort} never became reachable on local port ${localPort}.`,
    );
  }

  const remote: AttachedRemoteInfo = {
    host,
    port: remotePort,
    pid: remotePid,
  };
  const state: AttachedState = {
    pid: tunnel.pid!,
    port: localPort,
    userDataDir: `remote:${host}:~/.playwright-sessions/.chrome-profile`,
    channel: opts.channel ?? "chrome",
    headless: opts.headless === true,
    startedAt: new Date().toISOString(),
    remote,
  };
  return state;
}

/** Public: stop the remote Chrome + local tunnel. Best-effort on both. */
export async function stopAttachedRemote(state: AttachedState): Promise<void> {
  if (!state.remote) return;

  try {
    await execFile(
      "ssh",
      [
        state.remote.host,
        "source ~/.zshenv && npx playwright-cli-sessions@latest browser stop",
      ],
      { timeout: 15_000 },
    );
  } catch {
    // Best-effort — the remote state file might be stale or the Chrome already dead.
  }

  if (state.pid > 0) {
    try {
      process.kill(state.pid, "SIGTERM");
    } catch {
      // ignore — tunnel may have already died
    }
  }
}

/** Public: check remote status via SSH. Does NOT hit the local tunnel. */
export async function statusAttachedRemote(host: string): Promise<string> {
  try {
    const { stdout } = await execFile(
      "ssh",
      [
        host,
        "source ~/.zshenv && npx playwright-cli-sessions@latest browser status",
      ],
      { timeout: 10_000 },
    );
    return stdout;
  } catch (err) {
    return `(could not reach ${host}: ${(err as Error).message.split("\n")[0]})`;
  }
}
