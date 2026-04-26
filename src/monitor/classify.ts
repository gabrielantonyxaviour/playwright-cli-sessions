/**
 * monitor/classify — rules that turn a usage-log entry (and the surrounding
 * recent activity) into a classified event.
 *
 * Categories:
 *   ok           — nothing notable.
 *   loop         — repeated invocations of the same exec script (versioned
 *                  cascade like gh-rename-vN.mjs, OR the same filename ≥6×
 *                  in a short window).
 *   tab-pile     — `browser tabs list` reported >cap (rare, but still flag).
 *   wrong-tool   — exec script targeting github.com/.../settings,
 *                  vercel.com/.../, etc. — a CLI shortcut existed.
 *   strict-fall  — exit-79 fired (PCS_REMOTE_UNREACHABLE). Worth knowing
 *                  about — usually means M2 was momentarily unreachable.
 *   selector-fail — exit-10 (PCS_SELECTOR_TIMEOUT) — agents waiting on
 *                  selectors that never appeared. Could be flaky page or
 *                  bad selector choice.
 *   nav-fail     — exit-11 (PCS_HTTP_ERROR / PCS_NAV_FAILED).
 *
 * Exit-1 (PCS_UNKNOWN) is intentionally NOT flagged — those are usually
 * exec scripts deliberately throwing on failed assertions, which is the
 * correct way to signal "your verification failed" to the agent. Treating
 * those as issues would drown real signals in noise.
 */
import type { UsageLogEntry } from "../usage-log.js";

export type EventKind =
  | "ok"
  | "loop"
  | "wrong-tool"
  | "strict-fall"
  | "selector-fail"
  | "nav-fail";

export type Severity = "info" | "warn" | "error";

export interface ClassifiedEvent {
  ts: string;
  cwd: string;
  cmd: string;
  args: string[];
  exitCode: number;
  durationMs: number;
  kind: EventKind;
  severity: Severity;
  reason: string;
}

/** Strip versioning suffix so gh-rename.mjs / gh-rename-v2.mjs / gh-rename3.mjs all collapse to one key. */
function normalizeScriptKey(scriptPath: string): string {
  const base = scriptPath.replace(/^.*\//, "");
  return base
    .replace(/-v?\d+\.mjs$/, "-vN.mjs")
    .replace(/-\d+\.mjs$/, "-N.mjs")
    .replace(
      /-final\.mjs$|-debug\.mjs$|-fix\.mjs$|-real\.mjs$|-attempt\.mjs$/,
      "-vN.mjs",
    );
}

/** Hosts where a clear CLI shortcut exists. */
const CLI_SHORTCUT_HOSTS: Record<string, string> = {
  "github.com": "gh CLI",
  "vercel.com": "vercel CLI",
  "supabase.com": "supabase CLI / psql",
  "cloudflare.com": "wrangler",
  "dash.cloudflare.com": "wrangler",
};

/** Try to extract a URL from CLI args (e.g. `screenshot https://x` or `--url=https://x`). */
function extractUrl(args: string[]): string | undefined {
  for (const a of args) {
    if (typeof a !== "string") continue;
    const m = a.match(/https?:\/\/[^\s'"]+/);
    if (m) return m[0];
    if (a.startsWith("--url=")) {
      const url = a.slice(6);
      if (url.startsWith("http")) return url;
    }
  }
  return undefined;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export function classify(
  entry: UsageLogEntry,
  /** Recent entries (oldest first) within a sliding window — used for loop detection. */
  recent: UsageLogEntry[],
): ClassifiedEvent {
  const base = {
    ts: entry.ts,
    cwd: entry.cwd,
    cmd: entry.cmd,
    args: entry.args,
    exitCode: entry.exitCode,
    durationMs: entry.durationMs,
  };

  // --- Strict-fallback fired ---
  if (entry.exitCode === 79) {
    return {
      ...base,
      kind: "strict-fall",
      severity: "warn",
      reason:
        "PCS_REMOTE_UNREACHABLE — strict no-fallback fired. M2 was unreachable; agent correctly refused to launch local Chrome.",
    };
  }

  // --- Selector / nav errors ---
  if (entry.exitCode === 10) {
    return {
      ...base,
      kind: "selector-fail",
      severity: "info",
      reason:
        "PCS_SELECTOR_TIMEOUT — a wait-for selector never appeared. Could be flaky page or wrong selector.",
    };
  }
  if (entry.exitCode === 11) {
    return {
      ...base,
      kind: "nav-fail",
      severity: "info",
      reason: "Navigation/HTTP error (PCS_NAV_FAILED or PCS_HTTP_ERROR).",
    };
  }

  // --- Loop detection (exec only) ---
  if (entry.cmd === "exec" && entry.args.length >= 2) {
    const scriptPath = entry.args[1] ?? "";
    if (scriptPath && scriptPath !== "-") {
      const key = normalizeScriptKey(scriptPath);
      // Sibling exec entries from the same cwd in the recent window.
      const sameKeyRecent = recent.filter(
        (r) =>
          r.cmd === "exec" &&
          r.cwd === entry.cwd &&
          (r.args[1] ?? "") !== "" &&
          normalizeScriptKey(r.args[1] ?? "") === key,
      );
      // 4+ runs of the same versioned-cascade key in the window → loop.
      if (sameKeyRecent.length >= 4) {
        const versioned = key !== scriptPath.replace(/^.*\//, "");
        return {
          ...base,
          kind: "loop",
          severity: versioned ? "error" : "warn",
          reason: versioned
            ? `Versioned-cascade loop detected: ${sameKeyRecent.length} runs of ${key} family (e.g. ${scriptPath.replace(/^.*\//, "")}) in recent window. This is the gh-rename-vN.mjs anti-pattern. The agent should have switched to a CLI shortcut after 1-2 failures.`
            : `Same exec script (${key}) re-run ${sameKeyRecent.length} times in recent window. May be legitimate iterative testing, or may be a stuck retry.`,
        };
      }
    }
  }

  // --- Wrong-tool detection: only `exec` (mutation-shaped) hitting a SaaS
  // settings/admin URL. Pure `screenshot`/`navigate`/`snapshot` of dashboards
  // is fine — that's visual inspection, NOT a mutation that should have used
  // a CLI shortcut. Also skip self-tests (cwd inside playwright-cli-sessions
  // or clan-runtime — those hit github.com/settings deliberately to test
  // auth-wall handling).
  if (entry.cmd === "exec") {
    const isSelfTest =
      entry.cwd.includes("infra/playwright-cli-sessions") ||
      entry.cwd.includes("agents/clan-runtime");
    if (!isSelfTest) {
      const url = extractUrl(entry.args);
      if (url) {
        const host = hostOf(url);
        if (host && host in CLI_SHORTCUT_HOSTS) {
          const isAdminish =
            /\/settings|\/admin|\/projects\/[^/]+\/(?:settings|env|domains)/.test(
              url,
            );
          if (isAdminish) {
            return {
              ...base,
              kind: "wrong-tool",
              severity: "warn",
              reason: `exec script targeting ${host} settings/admin URL via Playwright. Probable shortcut: ${CLI_SHORTCUT_HOSTS[host]}. If you're MUTATING (rename, env, etc.), use the CLI — it's faster and deterministic. (Pure visual checks are fine — use 'screenshot' instead of 'exec' to opt out of this warning.)`,
            };
          }
        }
      }
    }
  }

  return {
    ...base,
    kind: "ok",
    severity: "info",
    reason: "ok",
  };
}
