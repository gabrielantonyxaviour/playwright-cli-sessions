/**
 * stuck-detector — spot agents that are blind-retrying the same failing
 * command and tell them to stop.
 *
 * Why this exists:
 *   When a Claude Code or Codex session hits a recurring failure, it tends
 *   to retry with cosmetic flag tweaks instead of diagnosing. The user (a
 *   human watching this happen) wants two things:
 *     1. The CLI itself surfaces the loop ("you've been here 3 times")
 *     2. The CLI suggests concrete diagnostic moves before another retry
 *
 *   Time is the user's most valuable currency. This module exists to
 *   protect it.
 *
 * Trigger:
 *   Same `cmd`, same `exitCode`, ≥3 occurrences in the last 5 minutes,
 *   from an agent session (`invokedBy === "claude-code"`). Human-issued
 *   runs are exempt — humans don't need to be lectured about their own
 *   typing.
 *
 * Output:
 *   The detector returns a structured result; cli.ts formats and prints
 *   it. Warnings are advisory-only — the command still runs. The point is
 *   to make blind retries visible, not to force-block them.
 */

import { readRecentByCmd, type UsageLogEntry } from "./usage-log.js";
import { detectInvocationSource } from "./invocation.js";

export const STUCK_WINDOW_MS = 5 * 60 * 1000;
export const STUCK_THRESHOLD = 3;

export interface StuckResult {
  /** Same cmd that triggered detection. */
  cmd: string;
  /** Number of identical-failure occurrences inside the window. */
  count: number;
  /** Window length used for detection (ms). */
  windowMs: number;
  /** The exit code shared across the failures. */
  exitCode: number;
  /** Last error message recorded (one-line). */
  lastError: string | undefined;
  /** Earliest timestamp in the matched run. */
  firstTs: string;
  /** Latest timestamp in the matched run. */
  lastTs: string;
}

/**
 * Return a StuckResult when the current invocation looks like the next
 * step in a blind-retry loop, otherwise null.
 *
 * Only fires for `invokedBy === "claude-code"` — humans are exempt. The
 * CLI passes the *current* cmd; the detector looks back at prior failed
 * runs of the same cmd.
 */
export function detectStuckLoop(cmd: string): StuckResult | null {
  if (detectInvocationSource() !== "claude-code") return null;

  const recent = readRecentByCmd(cmd, STUCK_WINDOW_MS, "claude-code");
  if (recent.length < STUCK_THRESHOLD) return null;

  // Only count failures (exitCode !== 0). A successful run mid-window
  // breaks the "blind retry" signal — the agent is making progress.
  const failures = recent.filter((e) => e.exitCode !== 0);
  if (failures.length < STUCK_THRESHOLD) return null;

  // Group by exitCode; the loop is "stuck" when one exitCode dominates
  // the recent failures. Same code N times = same failure mode N times.
  const byCode = new Map<number, UsageLogEntry[]>();
  for (const f of failures) {
    const list = byCode.get(f.exitCode) ?? [];
    list.push(f);
    byCode.set(f.exitCode, list);
  }
  let dominantCode: number | null = null;
  let dominantList: UsageLogEntry[] = [];
  for (const [code, list] of byCode) {
    if (list.length >= STUCK_THRESHOLD && list.length > dominantList.length) {
      dominantCode = code;
      dominantList = list;
    }
  }
  if (dominantCode === null) return null;

  const sorted = [...dominantList].sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0,
  );
  const last = sorted[sorted.length - 1]!;
  const first = sorted[0]!;

  return {
    cmd,
    count: sorted.length,
    windowMs: STUCK_WINDOW_MS,
    exitCode: dominantCode,
    lastError: last.error,
    firstTs: first.ts,
    lastTs: last.ts,
  };
}

/**
 * Format a stuck-loop warning block for stderr. Advisory tone — the CLI
 * is reminding the agent it's been here before, not refusing to run.
 */
export function formatStuckWarning(r: StuckResult): string {
  const minutes = Math.max(
    1,
    Math.round((Date.parse(r.lastTs) - Date.parse(r.firstTs)) / 60_000),
  );
  const lines: string[] = [];
  lines.push("⚠ STUCK LOOP DETECTED");
  lines.push(
    `  You have run \`${r.cmd}\` ${r.count} times in the last ${minutes} min, all exiting [${r.exitCode}].`,
  );
  if (r.lastError && r.lastError.trim().length > 0) {
    const oneLine = r.lastError.replace(/\s+/g, " ").trim().slice(0, 200);
    lines.push(`  Last error: "${oneLine}"`);
  }
  lines.push("");
  lines.push("  Stop and diagnose before another retry:");
  lines.push("    1. playwright-cli-sessions browser status");
  lines.push("    2. playwright-cli-sessions browser tabs list");
  lines.push(
    "    3. screenshot the URL with --allow-http-error to see what loaded",
  );
  lines.push('    4. If still stuck, file `report "<what you tried>"`');
  lines.push("");
  lines.push(
    "  This warning is informational — the command will still run. But if",
  );
  lines.push("  you're about to retry the same way again, please don't.");
  return lines.join("\n");
}
