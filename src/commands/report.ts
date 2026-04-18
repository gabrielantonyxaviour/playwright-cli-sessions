/**
 * report — file a structured issue about CLI behavior.
 * reports — list recent reports.
 *
 * Motivation:
 *   When a Claude session (or human) uses `playwright-cli-sessions` and hits
 *   unexpected behavior, the path of least resistance is to fall back to
 *   curl / manual steps / a different tool. The user never learns the CLI
 *   has a gap. The `report` command is the designed alternative:
 *
 *     playwright-cli-sessions report "screenshot of gmail.com with session
 *       gabriel-platforms returned a 200x200 blank image — expected full-page"
 *
 *   Each report is a markdown file under ~/.playwright-sessions/.reports/,
 *   stamped with recent usage-log entries for context. The SKILL.md tells
 *   Claude: on unexpected behavior, file a report — do NOT work around it.
 *
 * Storage:
 *   ~/.playwright-sessions/.reports/YYYY-MM-DDTHH-MM-SS-<slug>.md
 *   (directory is auto-created)
 */

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { SESSION_STORE_ROOT } from "../store.js";
import { readRecentUsage } from "../usage-log.js";
import { detectInvocationSource } from "../invocation.js";
import { fireNotification } from "../notify.js";

export const REPORTS_DIR = join(SESSION_STORE_ROOT, ".reports");

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "report"
  );
}

function tsFileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
}

export interface ReportOptions {
  /** Number of recent usage-log entries to embed as context (default 10) */
  context?: number;
  /**
   * Whether to fire a desktop notification when the caller is Claude Code.
   * Defaults to true. A false opt-out is useful for tests and CI runs where
   * a macOS NotificationCenter popup would be noise, not signal.
   */
  notify?: boolean;
}

/** Write a new report file. Returns the absolute path. */
export function cmdReport(message: string, opts: ReportOptions = {}): string {
  if (!message || !message.trim()) {
    throw new Error(
      `report requires a message.\n  playwright-cli-sessions report "<what went wrong>"`,
    );
  }

  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const firstLine = message.split("\n")[0] ?? message;
  const fileName = `${tsFileStamp()}-${slugify(firstLine)}.md`;
  const path = join(REPORTS_DIR, fileName);
  const recent = readRecentUsage(opts.context ?? 10);
  const invokedBy = detectInvocationSource();

  const lines: string[] = [];
  lines.push(`# Report: ${firstLine}`);
  lines.push("");
  lines.push(`**Filed:** ${new Date().toISOString()}`);
  lines.push(`**Invoked by:** ${invokedBy}`);
  lines.push(`**CWD:** ${process.cwd()}`);
  lines.push("");
  lines.push("## Message");
  lines.push("");
  lines.push(message);
  lines.push("");

  if (recent.length > 0) {
    lines.push("## Recent CLI invocations (context)");
    lines.push("");
    lines.push("| time | cmd | exit | duration | error |");
    lines.push("|------|-----|-----:|---------:|-------|");
    for (const entry of recent) {
      const err = entry.error ? entry.error.split("\n")[0]!.slice(0, 80) : "";
      lines.push(
        `| ${entry.ts} | ${entry.cmd} | ${entry.exitCode} | ${entry.durationMs}ms | ${err} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Environment");
  lines.push("");
  lines.push(`- node: ${process.version}`);
  lines.push(`- platform: ${process.platform}`);

  writeFileSync(path, lines.join("\n") + "\n", "utf-8");
  console.log(`✓ Report saved to ${path}`);

  // When a Claude Code session files a report, the human user is rarely
  // watching the terminal — they're on another desktop, reviewing a PR, or
  // asleep. A desktop notification is how we pierce "out of sight, out of
  // mind" so CLI gaps surface the moment they happen instead of accumulating
  // silently in .reports/. Human-filed reports don't notify (the human
  // already knows they filed it).
  const shouldNotify = opts.notify !== false && invokedBy === "claude-code";
  if (shouldNotify) {
    fireNotification({
      title: "playwright-cli-sessions: Claude filed a report",
      subtitle: firstLine.slice(0, 100),
      message: `Saved to ${path}. Run \`npx playwright-cli-sessions reports\` to view.`,
    });
  }

  return path;
}

export interface ReportsListOptions {
  limit?: number;
  json?: boolean;
}

interface ReportSummary {
  path: string;
  fileName: string;
  filedAt: string;
  title: string;
  invokedBy: "claude-code" | "user" | "unknown";
}

function readReportSummary(path: string): ReportSummary | null {
  try {
    const stat = statSync(path);
    const text = readFileSync(path, "utf-8");
    const lines = text.split("\n");
    const firstLine = lines.find((l) => l.startsWith("# ")) ?? "";
    const title = firstLine.replace(/^#\s*Report:\s*/, "").replace(/^#\s*/, "");
    // Parse "**Invoked by:** claude-code" from the header. Older reports
    // (pre-0.3.1) lack this field — mark them "unknown" so they're visible
    // but not misattributed.
    const invokedLine = lines.find((l) => l.startsWith("**Invoked by:**"));
    let invokedBy: ReportSummary["invokedBy"] = "unknown";
    if (invokedLine) {
      const value = invokedLine.replace(/^\*\*Invoked by:\*\*\s*/, "").trim();
      if (value === "claude-code" || value === "user") invokedBy = value;
    }
    return {
      path,
      fileName: path.split("/").pop() ?? path,
      filedAt: stat.mtime.toISOString(),
      title: title.trim() || "(untitled)",
      invokedBy,
    };
  } catch {
    return null;
  }
}

export function cmdReports(opts: ReportsListOptions = {}): void {
  if (!existsSync(REPORTS_DIR)) {
    if (opts.json) {
      console.log("[]");
    } else {
      console.log(
        `No reports filed yet. Use \`playwright-cli-sessions report "<message>"\` to file one.`,
      );
    }
    return;
  }

  const files = readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(REPORTS_DIR, f));

  const summaries = files
    .map(readReportSummary)
    .filter((s): s is ReportSummary => s !== null)
    // Newest first
    .sort((a, b) => b.filedAt.localeCompare(a.filedAt));

  const limit = opts.limit ?? 20;
  const top = summaries.slice(0, limit);

  if (opts.json) {
    console.log(JSON.stringify(top, null, 2));
    return;
  }

  if (top.length === 0) {
    console.log(
      `No reports filed yet. Use \`playwright-cli-sessions report "<message>"\` to file one.`,
    );
    return;
  }

  console.log(`Recent reports (${top.length} of ${summaries.length}):`);
  console.log();
  for (const s of top) {
    const date = s.filedAt.slice(0, 16).replace("T", " ");
    const marker = s.invokedBy === "claude-code" ? " [CC]" : "";
    console.log(`  [${date}]${marker} ${s.title}`);
    console.log(`    ${s.path}`);
  }
}
