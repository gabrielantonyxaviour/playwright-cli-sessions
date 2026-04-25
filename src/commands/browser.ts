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
  tryAttach,
  type AttachedState,
} from "../attached-browser.js";
import { listSavedNames, readSaved } from "../store.js";
import { PcsError } from "../errors.js";

export interface BrowserOptions {
  channel?: string;
  json?: boolean;
  /** For `tabs close-all`: only close tabs whose URL contains this substring. */
  match?: string;
}

export async function cmdBrowser(
  sub: string,
  rest: string[] = [],
  opts: BrowserOptions = {},
): Promise<void> {
  switch (sub) {
    case "start":
      return doStart(opts);
    case "stop":
      return doStop();
    case "status":
      return doStatus(opts);
    case "import-sessions":
      return doImportSessions();
    case "tabs": {
      const subsub = rest[0];
      if (subsub === "list") return doTabsList(opts);
      if (subsub === "close-all") return doTabsCloseAll(opts);
      throw new PcsError(
        "PCS_INVALID_INPUT",
        `Unknown browser tabs subcommand "${subsub ?? ""}". Expected: list | close-all`,
        { subcommand: `tabs ${subsub ?? ""}` },
      );
    }
    default:
      throw new PcsError(
        "PCS_INVALID_INPUT",
        `Unknown browser subcommand "${sub}". Expected: start | stop | status | import-sessions | tabs`,
        { subcommand: sub },
      );
  }
}

async function doTabsList(opts: BrowserOptions): Promise<void> {
  const browser = await tryAttach();
  if (!browser) {
    throw new PcsError(
      "PCS_INVALID_INPUT",
      `No attached Chrome is running. Run \`browser start\` first.`,
    );
  }
  try {
    const ctx = browser.contexts()[0];
    if (!ctx) {
      process.stdout.write("(no contexts in attached browser)\n");
      return;
    }
    const pages = ctx.pages();
    const out: Array<{ index: number; url: string; title: string }> = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!;
      const url = page.url();
      let title = "";
      try {
        title = await page.title();
      } catch {
        title = "(no title)";
      }
      out.push({ index: i, url, title });
    }
    if (opts.json === true) {
      process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    } else if (out.length === 0) {
      process.stdout.write("(no tabs open)\n");
    } else {
      for (const t of out) {
        process.stdout.write(
          `  [${t.index}] ${t.url}\n      ${t.title || "(no title)"}\n`,
        );
      }
      process.stdout.write(`\nTotal: ${out.length} tab(s)\n`);
    }
  } finally {
    try {
      await browser.close();
    } catch {
      // ignore — disconnects CDP only
    }
  }
}

async function doTabsCloseAll(opts: BrowserOptions): Promise<void> {
  const browser = await tryAttach();
  if (!browser) {
    throw new PcsError(
      "PCS_INVALID_INPUT",
      `No attached Chrome is running. Run \`browser start\` first.`,
    );
  }
  try {
    const ctx = browser.contexts()[0];
    if (!ctx) {
      process.stdout.write("(no contexts in attached browser)\n");
      return;
    }
    const pages = ctx.pages();
    const match = opts.match;
    let closed = 0;
    let skipped = 0;
    // Always leave at least one tab alive — closing the last tab can shut
    // the window. Open `about:blank` if we're about to close everything.
    const matched: typeof pages = [];
    for (const page of pages) {
      if (match && match.length > 0 && !page.url().includes(match)) {
        skipped += 1;
        continue;
      }
      matched.push(page);
    }
    if (matched.length === pages.length && pages.length > 0) {
      // We'd close every tab — open a placeholder first so the window stays.
      try {
        const placeholder = await ctx.newPage();
        await placeholder.goto("about:blank").catch(() => undefined);
      } catch {
        // best-effort
      }
    }
    for (const page of matched) {
      try {
        await page.close();
        closed += 1;
      } catch {
        // already closed; skip
      }
    }
    process.stdout.write(
      match
        ? `Closed ${closed} tab(s) matching "${match}" (${skipped} kept).\n`
        : `Closed ${closed} tab(s).\n`,
    );
  } finally {
    try {
      await browser.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Inject cookies from every saved storageState JSON into the attached
 * browser's persistent profile context. Lets the user avoid re-authenticating
 * each service in the attached Chrome window by reusing credentials already
 * captured via `login <name>` into the session JSON files.
 *
 * Cookies and localStorage (origins) are both imported when present. Merge
 * is "last one wins" — if two sessions hold different cookies for the same
 * (name, domain, path), the session read last overwrites. For a single user
 * with distinct services per session that rarely happens; if it does, delete
 * the redundant session first.
 */
async function doImportSessions(): Promise<void> {
  const browser = await tryAttach();
  if (!browser) {
    throw new PcsError(
      "PCS_INVALID_INPUT",
      `No attached Chrome is running. Start one first:\n` +
        `  playwright-cli-sessions browser start\n` +
        `\n` +
        `Import writes cookies + localStorage directly into the attached\n` +
        `Chrome's persistent profile via CDP. It cannot run standalone.`,
    );
  }

  const contexts = browser.contexts();
  const context = contexts[0];
  if (!context) {
    try {
      await browser.close();
    } catch {
      // ignore
    }
    throw new PcsError(
      "PCS_UNKNOWN",
      "Attached Chrome has no default context to import into.",
    );
  }

  // Drop the initial connection — we re-attach per session so a transient
  // CDP hiccup on one session doesn't wedge the rest.
  try {
    await browser.close();
  } catch {
    // ignore
  }

  const names = listSavedNames();
  if (names.length === 0) {
    process.stdout.write("No saved sessions found. Nothing to import.\n");
    return;
  }

  process.stdout.write(
    `Importing ${names.length} saved sessions into attached Chrome profile (one at a time, with pauses)...\n\n`,
  );

  let totalCookies = 0;
  let successCount = 0;
  const failures: Array<{ name: string; error: string }> = [];

  const { setTimeout: sleep } = await import("node:timers/promises");

  for (const name of names) {
    const saved = readSaved(name);
    if (!saved) {
      failures.push({ name, error: "could not read session file" });
      process.stdout.write(`  ✗ ${name}: could not read session file\n`);
      continue;
    }
    const ss = saved.storageState;
    if (!ss || typeof ss !== "object") {
      failures.push({ name, error: "no storageState in session" });
      process.stdout.write(`  ✗ ${name}: no storageState in session\n`);
      continue;
    }
    const cookies = Array.isArray(ss.cookies) ? ss.cookies : [];
    const origins = Array.isArray(ss.origins) ? ss.origins : [];
    if (cookies.length === 0) {
      process.stdout.write(`  · ${name}: empty (no cookies) — skipped\n`);
      continue;
    }

    // Fresh CDP connection per session. If any connection drops or the
    // context gets into a weird state, the NEXT session gets a clean one.
    let perSessionBrowser: Awaited<ReturnType<typeof tryAttach>> | null = null;
    try {
      perSessionBrowser = await tryAttach();
      if (!perSessionBrowser) {
        failures.push({ name, error: "could not re-attach between sessions" });
        process.stdout.write(
          `  ✗ ${name}: could not re-attach between sessions\n`,
        );
        continue;
      }
      const ctx = perSessionBrowser.contexts()[0];
      if (!ctx) {
        failures.push({ name, error: "no default context" });
        process.stdout.write(`  ✗ ${name}: no default context\n`);
        continue;
      }

      // storageState Cookie schema is wire-compatible with Playwright's
      // addCookies; cast through unknown to bridge the sameSite nominal type.
      await ctx.addCookies(
        cookies as unknown as Parameters<typeof ctx.addCookies>[0],
      );
      totalCookies += cookies.length;
      successCount += 1;

      const parts: string[] = [`${cookies.length} cookies`];
      if (origins.length > 0) {
        parts.push(`${origins.length} localStorage origins skipped`);
      }
      process.stdout.write(`  ✓ ${name}: ${parts.join(", ")}\n`);
    } catch (err) {
      failures.push({ name, error: (err as Error).message.split("\n")[0] });
      process.stdout.write(
        `  ✗ ${name}: ${(err as Error).message.split("\n")[0]}\n`,
      );
    } finally {
      if (perSessionBrowser) {
        try {
          await perSessionBrowser.close();
        } catch {
          // ignore
        }
      }
    }

    // Small breather between sessions. Keeps CDP from getting overwhelmed on
    // the tunneled remote path and lets Chrome flush cookie DB writes.
    await sleep(250);
  }

  process.stdout.write(
    `\n` +
      `Imported from ${successCount}/${names.length} sessions:\n` +
      `  cookies added:  ${totalCookies}\n`,
  );
  if (failures.length > 0) {
    process.stdout.write(`  failures:       ${failures.length}\n`);
    process.stdout.write(
      `\nNote: some sessions may have been logged out or banned server-side\n` +
        `already — the cookies are still imported, but won't grant access until\n` +
        `you run \`login <name>\` again to refresh them.\n`,
    );
  }
}

async function doStart(opts: BrowserOptions): Promise<void> {
  // Attached mode is always headful — no --headless flag. The whole point of
  // the attached Chrome is a persistent, visible, real profile (Google trusts
  // it, you can log in, you can see what's happening). Headless defeats that.
  // Scenario harness only: PLAYWRIGHT_CLI_HEADLESS=1 env is honored as an
  // internal back-door so `tests/run.sh` doesn't pop windows during tests.
  const headless = process.env.PLAYWRIGHT_CLI_HEADLESS === "1";
  const state = await startAttached({
    headless,
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
