/**
 * `monitor` subcommand — analyze the usage log and surface bad-usage patterns
 * across all Claude Code sessions that have used playwright-cli-sessions.
 *
 *   monitor report  [--since=24h] [--severity=warn|error] [--json]
 *
 * Reads ~/.playwright-sessions/.usage-log.jsonl (no daemon, no live tail —
 * an on-demand audit). Classifies each entry via src/monitor/classify and
 * prints a grouped summary plus the worst offenders. Designed so the user
 * (or a Claude session helping the user) can ask "are agents misbehaving?"
 * and get a concrete answer.
 */
import { readFileSync, existsSync } from "node:fs";
import { USAGE_LOG_FILE, type UsageLogEntry } from "../usage-log.js";
import {
  classify,
  type ClassifiedEvent,
  type Severity,
} from "../monitor/classify.js";
import { PcsError } from "../errors.js";

export interface MonitorOptions {
  /** "24h" / "7d" / ISO timestamp / Unix-ms — defaults to 24h. */
  since?: string;
  /** Minimum severity to print: info | warn | error. Defaults to info. */
  severity?: string;
  json?: boolean;
}

const SEV_RANK: Record<Severity, number> = { info: 0, warn: 1, error: 2 };

function parseSince(value: string | undefined): Date {
  const now = Date.now();
  if (!value) return new Date(now - 24 * 3600 * 1000);
  const m = value.match(/^(\d+)([hdm])$/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const ms = unit === "h" ? 3600_000 : unit === "d" ? 86400_000 : 60_000;
    return new Date(now - n * ms);
  }
  // Try ISO date
  const d = new Date(value);
  if (!isNaN(d.getTime())) return d;
  throw new PcsError(
    "PCS_INVALID_FLAG",
    `Invalid --since="${value}". Expected formats: 24h, 7d, 30m, or ISO timestamp.`,
  );
}

export async function cmdMonitor(
  sub: string,
  opts: MonitorOptions = {},
): Promise<void> {
  switch (sub) {
    case "report":
      return doReport(opts);
    default:
      throw new PcsError(
        "PCS_INVALID_INPUT",
        `Unknown monitor subcommand "${sub}". Expected: report`,
        { subcommand: sub },
      );
  }
}

async function doReport(opts: MonitorOptions): Promise<void> {
  if (!existsSync(USAGE_LOG_FILE)) {
    process.stdout.write(
      "No usage log found yet. Run a few playwright-cli-sessions commands and try again.\n",
    );
    return;
  }

  const since = parseSince(opts.since);
  const minSev: Severity = (opts.severity as Severity) ?? "info";
  const minSevRank = SEV_RANK[minSev] ?? 0;

  const lines = readFileSync(USAGE_LOG_FILE, "utf8").trim().split("\n");
  const entries: UsageLogEntry[] = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line) as UsageLogEntry;
      if (new Date(e.ts).getTime() >= since.getTime()) entries.push(e);
    } catch {
      // skip malformed lines
    }
  }

  if (entries.length === 0) {
    process.stdout.write(
      `No usage entries since ${since.toISOString()}. System has been quiet.\n`,
    );
    return;
  }

  // Loop detection needs a sliding window of recent entries (per cwd).
  // Keep a 10-minute window in memory.
  const WINDOW_MS = 10 * 60 * 1000;
  const events: ClassifiedEvent[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const tsMs = new Date(entry.ts).getTime();
    const recent: UsageLogEntry[] = [];
    for (let j = Math.max(0, i - 50); j < i; j++) {
      const r = entries[j]!;
      if (tsMs - new Date(r.ts).getTime() <= WINDOW_MS) recent.push(r);
    }
    events.push(classify(entry, recent));
  }

  if (opts.json === true) {
    process.stdout.write(
      JSON.stringify(
        {
          since: since.toISOString(),
          totalEntries: entries.length,
          events: events.filter((e) => SEV_RANK[e.severity] >= minSevRank),
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  // Aggregate stats.
  const total = entries.length;
  const errCount = entries.filter((e) => e.exitCode !== 0).length;
  const exit1Count = entries.filter((e) => e.exitCode === 1).length;
  const projects: Record<string, number> = {};
  for (const e of entries) {
    const proj = e.cwd.split("/").slice(-2).join("/");
    projects[proj] = (projects[proj] || 0) + 1;
  }
  const topProjects = Object.entries(projects)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // Group classified events.
  const byKind: Record<string, ClassifiedEvent[]> = {};
  for (const ev of events) {
    if (SEV_RANK[ev.severity] < minSevRank) continue;
    if (ev.kind === "ok") continue;
    (byKind[ev.kind] ||= []).push(ev);
  }

  const sinceShort =
    typeof opts.since === "string" ? opts.since : "24h (default)";

  process.stdout.write(
    `\nplaywright-cli-sessions monitor — report for last ${sinceShort}\n` +
      "─".repeat(72) +
      "\n\n" +
      `Total invocations: ${total}\n` +
      `Non-zero exits:    ${errCount} (${((errCount / total) * 100).toFixed(1)}%)\n` +
      `  exit-1 (PCS_UNKNOWN — usually exec-script throws):  ${exit1Count}\n` +
      `  exit-79 (PCS_REMOTE_UNREACHABLE):                   ${entries.filter((e) => e.exitCode === 79).length}\n` +
      `  exit-77 (auth-wall):                                ${entries.filter((e) => e.exitCode === 77).length}\n` +
      `  exit-78 (challenge-wall):                           ${entries.filter((e) => e.exitCode === 78).length}\n` +
      `  exit-10 (selector timeout):                         ${entries.filter((e) => e.exitCode === 10).length}\n` +
      `  exit-11 (HTTP / nav error):                         ${entries.filter((e) => e.exitCode === 11).length}\n\n` +
      `Top projects by activity:\n`,
  );
  for (const [proj, n] of topProjects) {
    process.stdout.write(`  ${n.toString().padStart(4)}× ${proj}\n`);
  }

  // Print issues by category.
  const order: Array<keyof typeof byKind> = [
    "loop",
    "wrong-tool",
    "strict-fall",
    "selector-fail",
    "nav-fail",
  ];

  const anyIssues = order.some((k) => (byKind[k] ?? []).length > 0);
  if (!anyIssues) {
    process.stdout.write(
      `\n✓ No issues at severity ≥${minSev}. System is healthy.\n` +
        `  (Tip: pass --severity=info to see the everything log.)\n`,
    );
    return;
  }

  process.stdout.write(
    `\n${"─".repeat(72)}\nDetected issues\n${"─".repeat(72)}\n`,
  );
  for (const kind of order) {
    const list = byKind[kind] ?? [];
    if (list.length === 0) continue;
    process.stdout.write(`\n[${kind}] ${list.length} event(s)\n`);
    // Print up to 5 representative entries per kind.
    for (const ev of list.slice(0, 5)) {
      const proj = ev.cwd.split("/").slice(-2).join("/");
      const arg = ev.args.slice(0, 3).join(" ");
      process.stdout.write(
        `  ${ev.ts}  ${proj}\n` +
          `    cmd: ${ev.cmd} ${arg}  (exit ${ev.exitCode}, ${ev.durationMs}ms)\n` +
          `    why: ${ev.reason}\n`,
      );
    }
    if (list.length > 5) {
      process.stdout.write(
        `  … and ${list.length - 5} more — pass --json for full list.\n`,
      );
    }
  }
  process.stdout.write("\n");
}
