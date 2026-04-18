/**
 * notify — fire a non-blocking desktop notification via macOS osascript.
 *
 * Used by the `report` command when a Claude Code session files an issue —
 * the user can't watch every terminal, so a notification is how we pierce the
 * "out of sight, out of mind" problem that otherwise lets CLI bugs accumulate
 * silently.
 *
 * Non-blocking:
 *   We spawn osascript with stdio ignored and unref it. Even if the
 *   NotificationCenter is slow, the CLI never waits. Failures are swallowed
 *   silently — a missed notification must not fail the user-facing command.
 *
 * No-op:
 *   - On non-darwin platforms (no osascript).
 *   - When PLAYWRIGHT_CLI_SESSIONS_NO_NOTIFY=1.
 *   - When the caller passes `force: false` implicitly (nothing to notify).
 */

import { spawn } from "node:child_process";

export interface NotifyOptions {
  /** Ignored on non-darwin. Does nothing if NO_NOTIFY env is set. */
  title: string;
  message: string;
  /** Optional subtitle (macOS notification UI). */
  subtitle?: string;
}

/**
 * Escape a string for embedding inside an AppleScript double-quoted literal.
 * AppleScript treats backslash and double-quote specially inside quoted strings.
 */
function escapeForAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function fireNotification(opts: NotifyOptions): void {
  if (process.env.PLAYWRIGHT_CLI_SESSIONS_NO_NOTIFY === "1") return;
  if (process.platform !== "darwin") return;

  // Cap message length — macOS truncates long notifications awkwardly, and an
  // over-long title becomes unreadable. 200 chars is a safe compromise.
  const title = opts.title.slice(0, 120);
  const message = opts.message.slice(0, 240);
  const subtitle = opts.subtitle ? opts.subtitle.slice(0, 120) : undefined;

  const parts = [
    `display notification "${escapeForAppleScript(message)}"`,
    `with title "${escapeForAppleScript(title)}"`,
  ];
  if (subtitle) {
    parts.push(`subtitle "${escapeForAppleScript(subtitle)}"`);
  }
  const script = parts.join(" ");

  try {
    const child = spawn("osascript", ["-e", script], {
      stdio: "ignore",
      detached: true,
    });
    // Don't let the notification hold the event loop open.
    child.unref();
    // Swallow spawn errors (e.g. osascript missing). Never break the caller.
    child.on("error", () => {});
  } catch {
    // Best-effort.
  }
}
