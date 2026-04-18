/**
 * usage-log — append-only JSONL log of every CLI invocation.
 *
 * Motivation:
 *   Other Claude sessions using this CLI sometimes hit unexpected errors and
 *   silently work around them (switch to curl, fabricate output, fall back to
 *   manual steps). The user never learns the CLI has a gap.
 *
 *   The usage log captures every invocation (success + failure) so:
 *     - The user can audit what failed and when.
 *     - The `report` command can point to specific log entries.
 *     - A future daily digest can surface unreported failures.
 *
 * Contract:
 *   - One JSON object per line, appended atomically via a single writeFile call.
 *   - Writing never crashes the CLI. On I/O failure we swallow silently —
 *     logging is best-effort; the primary command must not be held hostage.
 *   - Lives under SESSION_STORE_ROOT so it honors PLAYWRIGHT_SESSIONS_DIR
 *     (sandboxed in tests, per-user in production).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SESSION_STORE_ROOT } from "./store.js";
import { detectInvocationSource, type InvocationSource } from "./invocation.js";

export const USAGE_LOG_FILE = join(SESSION_STORE_ROOT, ".usage-log.jsonl");

export interface UsageLogEntry {
  /** ISO timestamp when the command ended */
  ts: string;
  /** Subcommand e.g. "screenshot", "list", or "unknown" for a bad route */
  cmd: string;
  /** Raw positional args + flags, minus the node/cli-path prefix */
  args: string[];
  /** Exit code the process will use */
  exitCode: number;
  /** Wall-clock duration in ms */
  durationMs: number;
  /** Error message when exitCode !== 0, otherwise omitted */
  error?: string;
  /** Process cwd, so cross-project issues are traceable */
  cwd: string;
  /** Per-process random-ish ID to group logs from the same invocation */
  sessionId: string;
  /** Node version + platform for environment-dependent bugs */
  env: { node: string; platform: string };
  /**
   * Who ran this command — detected via CLAUDECODE=1 env var.
   * "claude-code" when the CLI was invoked by an agent session; "user"
   * when the caller was a human at the terminal.
   */
  invokedBy: InvocationSource;
}

export function logUsage(
  entry: Omit<UsageLogEntry, "ts" | "sessionId" | "env" | "cwd" | "invokedBy">,
): void {
  try {
    if (!existsSync(SESSION_STORE_ROOT)) {
      mkdirSync(SESSION_STORE_ROOT, { recursive: true });
    }
    const full: UsageLogEntry = {
      ...entry,
      ts: new Date().toISOString(),
      cwd: process.cwd(),
      sessionId: `${process.pid}-${Date.now().toString(36)}`,
      env: { node: process.version, platform: process.platform },
      invokedBy: detectInvocationSource(),
    };
    appendFileSync(USAGE_LOG_FILE, JSON.stringify(full) + "\n", "utf-8");
  } catch {
    // Best-effort. Logging failures must never break the user's workflow.
  }
}

/** Read back the tail of the log. Caller-facing — used by `report` to attach context. */
export function readRecentUsage(limit = 20): UsageLogEntry[] {
  if (!existsSync(USAGE_LOG_FILE)) return [];
  try {
    const lines = readFileSync(USAGE_LOG_FILE, "utf-8")
      .split("\n")
      .filter((l) => l.length > 0);
    const tail = lines.slice(-limit);
    const parsed: UsageLogEntry[] = [];
    for (const line of tail) {
      try {
        parsed.push(JSON.parse(line) as UsageLogEntry);
      } catch {
        // Skip corrupted lines
      }
    }
    return parsed;
  } catch {
    return [];
  }
}
