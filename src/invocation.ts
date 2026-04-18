/**
 * invocation — tell whether a CLI run originated from a Claude Code session
 * or a human at the terminal.
 *
 * Why this exists:
 *   When a Claude Code agent hits a gap in the CLI and files a `report`, the
 *   user is often not watching the terminal — they're reviewing other work, on
 *   another desktop, or asleep. The `report` command uses this detection to
 *   decide whether to fire a desktop notification. It's also stamped into
 *   every usage-log entry so the `.reports/` and `.usage-log.jsonl` files
 *   preserve "who ran this" for later auditing.
 *
 * Detection is based on the CLAUDECODE=1 env var Claude Code sets in the
 * shell it spawns. The marker is the single canonical signal — do not add
 * heuristic fallbacks (parent-process sniffing, TTY checks) that can be
 * fooled by tmux, cmux-teams, or SSH sessions.
 */

export type InvocationSource = "claude-code" | "user";

export function detectInvocationSource(): InvocationSource {
  return process.env.CLAUDECODE === "1" ? "claude-code" : "user";
}
