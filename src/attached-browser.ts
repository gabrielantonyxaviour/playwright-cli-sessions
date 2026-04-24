/**
 * attached-browser — manage a single persistent Chrome that all CLI commands
 * attach to via CDP, instead of launching a fresh ephemeral Chrome per call.
 *
 * Why this exists:
 *   - Ephemeral profile per launch → Google flags the browser as unsafe at
 *     login time (no history, no stable identity). Persistent profile via
 *     --user-data-dir looks like any normal daily-driver Chrome.
 *   - Fresh Chrome window per command → focus-stealing on every invocation.
 *     Attached mode opens tabs in a window that's already visible; no new
 *     window pops.
 *
 * State file lives under $PLAYWRIGHT_SESSIONS_DIR (default ~/.playwright-sessions/)
 * so test sandboxes isolate naturally.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, createConnection } from "node:net";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
} from "playwright";
import { chromium } from "playwright";
import { SESSION_STORE_ROOT, ensureRoot } from "./store.js";

const STATE_FILE = join(SESSION_STORE_ROOT, ".attached-browser.json");
const PROFILE_DIR = join(SESSION_STORE_ROOT, ".chrome-profile");

export interface AttachedRemoteInfo {
  /** SSH host alias or hostname (e.g. "m2worker"). */
  host: string;
  /** Chrome CDP port on the remote side. */
  port: number;
  /** Chrome PID on the remote side (best-effort, for status). */
  pid: number;
}

export interface AttachedState {
  /**
   * Local PID. For local mode, this is Chrome itself. For remote mode, this
   * is the local SSH-tunnel process. Either way, stopping it is the first
   * step of `browser stop`.
   */
  pid: number;
  /**
   * Port the CDP client connects to on `127.0.0.1`. For local mode it's
   * Chrome's `--remote-debugging-port`. For remote mode it's the local side
   * of the SSH tunnel forwarding to the remote Chrome.
   */
  port: number;
  userDataDir: string;
  channel: string;
  headless: boolean;
  startedAt: string;
  /** Present only in remote mode. Identifies the remote Chrome + SSH target. */
  remote?: AttachedRemoteInfo;
}

function readState(): AttachedState | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as AttachedState;
  } catch {
    return null;
  }
}

function writeState(state: AttachedState): void {
  ensureRoot();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function clearState(): void {
  if (existsSync(STATE_FILE)) rmSync(STATE_FILE, { force: true });
}

/** Check PID is alive via signal 0 (permission check, no signal sent). */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Try a TCP connect to localhost:port with a short timeout. */
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

/** Find an unused TCP port by binding to 0 and reading the assigned port. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr === null || typeof addr === "string") {
        srv.close();
        reject(new Error("Could not determine free port"));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

/** Locate the Chrome executable. macOS canonical path first. */
function findChromeBinary(channel: string): string {
  const explicit = process.env.PLAYWRIGHT_CLI_CHROME_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  if (channel === "msedge") {
    const edge =
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
    if (existsSync(edge)) return edge;
  }
  const canonical =
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(canonical)) return canonical;
  throw new Error(
    `Could not find Chrome at ${canonical}. Set PLAYWRIGHT_CLI_CHROME_PATH to override.`,
  );
}

/** Derive the .app bundle path from the binary path (macOS only). */
function binaryToAppBundle(binary: string): string | null {
  const m = binary.match(/^(.*\.app)\/Contents\/MacOS\//);
  return m ? m[1]! : null;
}

/**
 * Find the main Chrome browser PID whose cmdline contains `--remote-debugging-port=<port>`.
 * Filters out `--type=` helper/renderer processes. Polls for up to `timeoutMs`.
 */
async function findChromePidByPort(
  port: number,
  timeoutMs = 5000,
): Promise<number | null> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileP = promisify(execFile);
  const marker = `--remote-debugging-port=${port}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileP("ps", ["-axo", "pid=,command="]);
      for (const line of stdout.split("\n")) {
        if (!line.includes(marker)) continue;
        if (line.includes("--type=")) continue; // helper/renderer
        const m = line.match(/^\s*(\d+)\s+/);
        if (m) return Number(m[1]);
      }
    } catch {
      // ignore and retry
    }
    await sleep(100);
  }
  return null;
}

/** Public: is an attached Chrome currently registered AND alive AND listening? */
export async function isAttached(): Promise<boolean> {
  const state = readState();
  if (!state) return false;
  if (!isPidAlive(state.pid)) {
    clearState();
    return false;
  }
  return isPortResponsive(state.port);
}

/** Return current attached state regardless of liveness. */
export function getRawState(): AttachedState | null {
  return readState();
}

/**
 * Connect to the attached Chrome via CDP. Callers MUST NOT call
 * browser.close() — that would kill Chrome. Use the returned page-lifecycle
 * helpers instead. Returns null if no attached Chrome is available.
 */
export async function tryAttach(): Promise<Browser | null> {
  if (!(await isAttached())) return null;
  const state = readState();
  if (!state) return null;
  try {
    return await chromium.connectOverCDP(`http://127.0.0.1:${state.port}`);
  } catch {
    return null;
  }
}

export interface StartOpts {
  headless?: boolean;
  channel?: string;
  extraArgs?: string[];
}

const STEALTH_LAUNCH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-remote-fonts",
  "--disable-features=DownloadableFontsPreferences",
];

/**
 * Start a persistent Chrome subprocess with CDP enabled. If already running,
 * returns the existing state without re-launching. Returns the live state.
 *
 * Remote routing: when `PLAYWRIGHT_CLI_REMOTE=<ssh-host>` is set (e.g.
 * `m2worker`), we SSH to that host, start Chrome there, and forward its CDP
 * port back via an SSH tunnel. The returned state includes a `remote` field
 * recording the host + remote port so `stopAttached` can tear it down
 * symmetrically.
 */
export async function startAttached(
  opts: StartOpts = {},
): Promise<AttachedState> {
  const existing = readState();
  if (
    existing &&
    isPidAlive(existing.pid) &&
    (await isPortResponsive(existing.port))
  ) {
    return existing;
  }
  // Stale state from a dead prior run — clear before starting fresh.
  if (existing) clearState();

  const remoteHost = process.env.PLAYWRIGHT_CLI_REMOTE;
  if (remoteHost && remoteHost.length > 0) {
    const { startAttachedRemote } =
      await import("./attached-browser-remote.js");
    const state = await startAttachedRemote(remoteHost, opts);
    writeState(state);
    return state;
  }

  mkdirSync(PROFILE_DIR, { recursive: true });
  const port = await findFreePort();
  const channel = opts.channel ?? "chrome";
  const chromeBin = findChromeBinary(channel);

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-infobars",
    "--disable-session-crashed-bubble",
    ...STEALTH_LAUNCH_ARGS,
    ...(opts.extraArgs ?? []),
  ];
  if (opts.headless === true) args.push("--headless=new");

  // macOS: launch via `open -n -a <App> --args ...` so the new Chrome is
  // registered with LaunchServices. Direct-binary spawn leaves the window
  // unregistered with the window server — CDP works but no visible UI.
  // `open` exits immediately after launching; we find the real Chrome PID
  // by scanning ps for our unique --remote-debugging-port.
  //
  // Headless mode (--headless=new) still goes through open -n -a — no UI is
  // expected, and the process tracking via port still works.
  let launchedPid: number | undefined;
  if (process.platform === "darwin") {
    const appBundle = binaryToAppBundle(chromeBin);
    if (!appBundle) {
      throw new Error(
        `Could not derive .app bundle from Chrome binary path: ${chromeBin}`,
      );
    }
    const openChild = spawn(
      "open",
      ["-n", "-a", appBundle, "--args", ...args],
      {
        stdio: "ignore",
      },
    );
    // Wait for `open` to finish (it exits quickly after handing off to LaunchServices).
    await new Promise<void>((resolve) => openChild.on("exit", () => resolve()));
  } else {
    const child = spawn(chromeBin, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    launchedPid = child.pid;
  }

  // Wait up to 10s for the CDP port to come up.
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (await isPortResponsive(port)) {
      ready = true;
      break;
    }
    await sleep(100);
  }
  if (!ready) {
    if (launchedPid !== undefined) {
      try {
        process.kill(launchedPid, "SIGTERM");
      } catch {
        // ignore
      }
    }
    throw new Error(
      `Chrome started but CDP on port ${port} never became responsive.`,
    );
  }

  // On darwin we need to resolve the actual Chrome PID (not the `open` PID).
  // On other platforms, child.pid is the Chrome PID directly.
  let pid = launchedPid;
  if (process.platform === "darwin") {
    const found = await findChromePidByPort(port);
    if (!found) {
      throw new Error(
        `Chrome CDP is up on ${port} but could not locate the browser PID. ` +
          `Profile: ${PROFILE_DIR}`,
      );
    }
    pid = found;
  }

  const state: AttachedState = {
    pid: pid!,
    port,
    userDataDir: PROFILE_DIR,
    channel,
    headless: opts.headless === true,
    startedAt: new Date().toISOString(),
  };
  writeState(state);
  return state;
}

/** Stop the attached Chrome. Returns true if it was running. */
export async function stopAttached(): Promise<boolean> {
  const state = readState();
  if (!state) return false;

  // Remote mode: stop the remote Chrome via SSH, then kill the local tunnel.
  if (state.remote) {
    const wasAlive = isPidAlive(state.pid);
    const { stopAttachedRemote } = await import("./attached-browser-remote.js");
    await stopAttachedRemote(state);
    clearState();
    return wasAlive;
  }

  let wasAlive = isPidAlive(state.pid);
  if (wasAlive) {
    try {
      process.kill(state.pid, "SIGTERM");
    } catch {
      // ignore — may race with process already exiting
    }
    // Give it up to 3s to exit cleanly; escalate to SIGKILL if stuck.
    for (let i = 0; i < 30; i++) {
      if (!isPidAlive(state.pid)) {
        wasAlive = true; // we actually stopped it
        break;
      }
      await sleep(100);
    }
    if (isPidAlive(state.pid)) {
      try {
        process.kill(state.pid, "SIGKILL");
      } catch {
        // ignore
      }
    }
  }
  clearState();
  return wasAlive;
}

/** Public status snapshot for `browser status`. */
export async function getStatus(): Promise<{
  running: boolean;
  state: AttachedState | null;
}> {
  const state = readState();
  if (!state) return { running: false, state: null };
  const alive = isPidAlive(state.pid);
  const responsive = alive ? await isPortResponsive(state.port) : false;
  if (!alive) clearState();
  return { running: alive && responsive, state };
}

/**
 * Shape returned by `acquireContext`. Callers work with `context`, then call
 * `dispose` exactly once. In attached mode, `dispose` closes only ephemeral
 * session contexts (leaving the persistent profile + the attached Chrome
 * alive). In fallback mode, `dispose` closes context + browser.
 */
export interface AcquiredContext {
  browser: Browser;
  context: BrowserContext;
  /** True if this came from the attached Chrome. */
  attached: boolean;
  /** Close whatever needs closing (context or context+browser). */
  dispose(): Promise<void>;
}

/**
 * Acquire a browser context for a browser command.
 *
 * - If an attached Chrome is running:
 *     - No storageState → reuse `browser.contexts()[0]` (persistent profile).
 *       The context and browser live past this call; only ephemeral pages
 *       created by the caller should be closed.
 *     - With storageState → create a new ephemeral context in the attached
 *       browser, applying it. Dispose closes just that context.
 * - No attached Chrome → `null` is returned; caller falls back to
 *   `launchStealthChrome` + `createStealthContext` as before.
 *
 * This helper does NOT apply stealth init scripts — leaving that to
 * createStealthContext in the fallback path, and relying on
 * `--disable-blink-features=AutomationControlled` (applied at `browser start`)
 * for the attached path. The persistent Chrome profile itself is the strongest
 * stealth signal available: it's real Chrome, logged in as the user.
 */
export async function acquireAttachedContext(
  storageStateOpt?: BrowserContextOptions["storageState"],
): Promise<AcquiredContext | null> {
  const browser = await tryAttach();
  if (!browser) return null;

  // Either path must drop the CDP connection when done, else Node keeps an
  // active WebSocket handle and the process hangs on exit. `browser.close()`
  // would kill Chrome — we want `browser.close()` to disconnect-only, which
  // the Playwright docs confirm is the behavior when the browser was obtained
  // via `connectOverCDP` (it closes the connection, not the browser). Empirical
  // testing shows this is NOT consistently true across Playwright versions —
  // so we call `browser.close()` on connected browsers, which Playwright
  // implements as disconnect for CDP-connected browsers.
  //
  // See: https://playwright.dev/docs/api/class-browser#browser-close — the
  // "connected" branch disconnects.

  if (storageStateOpt !== undefined) {
    const context = await browser.newContext({ storageState: storageStateOpt });
    return {
      browser,
      context,
      attached: true,
      async dispose() {
        try {
          await context.close();
        } catch {
          // best-effort
        }
        try {
          await browser.close(); // disconnects (does NOT kill Chrome for CDP-connected)
        } catch {
          // ignore
        }
      },
    };
  }

  const contexts = browser.contexts();
  const context =
    contexts.length > 0 ? contexts[0]! : await browser.newContext();
  return {
    browser,
    context,
    attached: true,
    async dispose() {
      // Persistent profile — leave it alone. Just drop the CDP connection
      // so Node can exit cleanly.
      try {
        await browser.close(); // disconnects (does NOT kill Chrome for CDP-connected)
      } catch {
        // ignore
      }
    },
  };
}
