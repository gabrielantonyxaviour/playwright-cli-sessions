/**
 * notify-email — daily attention report via Resend.
 *
 * Activated when both PLAYWRIGHT_HEALTH_EMAIL and RESEND_API_KEY are set.
 * Uses native fetch — no runtime dependency.
 *
 * Philosophy: the email is not a transition log. It is a full situation report
 * the user can read in 30 seconds to know which sessions to re-login today.
 *
 * Three sections:
 *   1. 🔴 Action needed now — new transitions + sessions with zero live services
 *   2. 🟡 Stale dead — services dead for >7 days that haven't been re-logged
 *   3. 🟢 Healthy snapshot — one line per session showing live services
 */

export interface Transition {
  session: string;
  service: string;
  from: string;
  to: string;
}

export interface SessionSnapshot {
  // name -> service -> "alive" | "dead" | "unknown"
  [service: string]: "alive" | "dead" | "unknown";
}

export interface Snapshot {
  ts: number;
  sessions: Record<string, SessionSnapshot>;
  /** Services declared on each session that have NO probe at all (browser-only
   *  or unsupported). Kept alongside sessions so the email can still flag them. */
  noProbeServices?: Record<string, string[]>;
  /** Services detected but skipped because cookies weren't available */
  noCookieServices?: Record<string, string[]>;
}

// Per-service login-URL template for re-auth commands.
const LOGIN_URLS: Record<string, string> = {
  GitHub: "https://github.com/login",
  Google: "https://accounts.google.com/",
  YouTube: "https://studio.youtube.com/",
  Supabase: "https://supabase.com/dashboard/sign-in",
  Vercel: "https://vercel.com/login",
  Neon: "https://console.neon.tech/app/projects",
  "Higgsfield AI": "https://higgsfield.ai/auth",
  Notion: "https://www.notion.so/login",
  Instagram: "https://www.instagram.com/accounts/login/",
  LinkedIn: "https://www.linkedin.com/login",
  "X/Twitter": "https://x.com/i/flow/login",
  Microsoft: "https://login.live.com/",
  WhatsApp: "https://web.whatsapp.com/",
};

// Services considered "key" — dead here is louder than dead on a marginal service.
const KEY_SERVICES = new Set([
  "GitHub",
  "Vercel",
  "Neon",
  "Supabase",
  "Google",
]);

const FROM =
  process.env.PLAYWRIGHT_HEALTH_FROM ||
  "Playwright Sessions <no-reply@contact.raxgbc.co.in>";

// ── Helpers ───────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loginCmd(session: string, service: string): string {
  const url = LOGIN_URLS[service] || "";
  return `npx playwright-cli-sessions login ${session}${url ? ` --url=${url}` : ""}`;
}

// ── Data shaping ──────────────────────────────────────────────────────

interface Roster {
  session: string;
  live: string[];
  dead: string[];
  noProbe: string[];
  everLiveLastSeen?: Record<string, number>; // from prev snapshot
}

function buildRosters(snap: Snapshot, prev: Snapshot | null): Roster[] {
  const out: Roster[] = [];
  const sessions = new Set([
    ...Object.keys(snap.sessions),
    ...Object.keys(snap.noProbeServices || {}),
  ]);
  for (const name of Array.from(sessions).sort()) {
    const svcs = snap.sessions[name] || {};
    const live: string[] = [];
    const dead: string[] = [];
    for (const [svc, state] of Object.entries(svcs)) {
      if (state === "alive") live.push(svc);
      else if (state === "dead") dead.push(svc);
    }
    const noProbe = snap.noProbeServices?.[name] || [];
    live.sort();
    dead.sort();
    noProbe.sort();
    // Find when each currently-dead service was last alive (scanned via prev)
    const everLiveLastSeen: Record<string, number> = {};
    if (prev) {
      for (const svc of dead) {
        // If prev had it alive, mark last seen as prev.ts
        if (prev.sessions[name]?.[svc] === "alive")
          everLiveLastSeen[svc] = prev.ts;
      }
    }
    out.push({ session: name, live, dead, noProbe, everLiveLastSeen });
  }
  return out;
}

function daysSince(ts: number, now: number): number {
  return Math.floor((now - ts) / 86_400_000);
}

// ── Render: HTML ──────────────────────────────────────────────────────

function renderHtml(
  transitions: Transition[],
  snap: Snapshot,
  prev: Snapshot | null,
): string {
  const now = snap.ts;
  const rosters = buildRosters(snap, prev);
  const zeroLive = rosters.filter(
    (r) => r.live.length === 0 && (r.dead.length > 0 || r.noProbe.length > 0),
  );
  const keyDead: Array<{ session: string; services: string[] }> = [];
  for (const r of rosters) {
    const keys = r.dead.filter((s) => KEY_SERVICES.has(s));
    if (keys.length > 0) keyDead.push({ session: r.session, services: keys });
  }

  const transitionRows = transitions
    .map(
      (t) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-family:monospace;font-size:12px;">${escapeHtml(t.session)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-family:monospace;font-size:12px;">${escapeHtml(t.service)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#888;font-family:monospace;">${escapeHtml(loginCmd(t.session, t.service))}</td>
        </tr>`,
    )
    .join("");

  const zeroLiveRows = zeroLive
    .map(
      (r) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-family:monospace;font-size:12px;">${escapeHtml(r.session)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#c0392b;">${escapeHtml(r.dead.join(", ") || "(no probed services)")}</td>
        </tr>`,
    )
    .join("");

  const keyDeadRows = keyDead
    .map(
      (r) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-family:monospace;font-size:12px;">${escapeHtml(r.session)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#d4670e;">${escapeHtml(r.services.join(", "))}</td>
        </tr>`,
    )
    .join("");

  // Stale dead — services dead this run AND dead in prev snapshot too.
  const stale: Array<{ session: string; service: string; days: number }> = [];
  if (prev) {
    for (const r of rosters) {
      for (const svc of r.dead) {
        const prevState = prev.sessions[r.session]?.[svc];
        if (prevState === "dead") {
          stale.push({
            session: r.session,
            service: svc,
            days: daysSince(prev.ts, now),
          });
        }
      }
    }
  }
  const staleRows = stale
    .slice(0, 20)
    .map(
      (s) =>
        `<tr>
          <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;font-family:monospace;font-size:12px;">${escapeHtml(s.session)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;font-family:monospace;font-size:12px;">${escapeHtml(s.service)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#888;">≥${s.days}d</td>
        </tr>`,
    )
    .join("");

  const healthyRows = rosters
    .map((r) => {
      const liveStr = r.live.length > 0 ? r.live.join(", ") : "—";
      const deadStr = r.dead.length > 0 ? ` · dead: ${r.dead.join(", ")}` : "";
      const npStr =
        r.noProbe.length > 0 ? ` · no-probe: ${r.noProbe.join(", ")}` : "";
      const color = r.live.length === 0 ? "#c0392b" : "#1a1a1a";
      return `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #f4f4f4;font-family:monospace;font-size:12px;width:180px;color:${color};">${escapeHtml(r.session)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f4f4f4;font-size:12px;line-height:1.5;">
          <span style="color:#138a3f;">${escapeHtml(liveStr)}</span><span style="color:#c0392b;">${escapeHtml(deadStr)}</span><span style="color:#aaa;">${escapeHtml(npStr)}</span>
        </td>
      </tr>`;
    })
    .join("");

  const totalLive = rosters.reduce((n, r) => n + r.live.length, 0);
  const totalDead = rosters.reduce((n, r) => n + r.dead.length, 0);
  const totalNoProbe = rosters.reduce((n, r) => n + r.noProbe.length, 0);

  const section = (
    title: string,
    subtitle: string,
    body: string,
    accent: string,
  ) => `
    <div style="padding:18px 26px;border-top:1px solid #ececec;">
      <div style="font-size:13px;font-weight:700;letter-spacing:0.02em;color:${accent};margin-bottom:4px;">${title}</div>
      <div style="font-size:12px;color:#777;margin-bottom:12px;">${subtitle}</div>
      ${body}
    </div>`;

  const sections: string[] = [];

  if (transitions.length > 0) {
    sections.push(
      section(
        `🔴 ${transitions.length} session${transitions.length === 1 ? "" : "s"} just went dead`,
        "Re-auth with the command shown next to each.",
        `<table style="width:100%;border-collapse:collapse;border:1px solid #f0f0f0;border-radius:6px;overflow:hidden;">
          <thead><tr style="background:#faf7f7;">
            <th style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Session</th>
            <th style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Service</th>
            <th style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Re-login</th>
          </tr></thead>
          <tbody>${transitionRows}</tbody>
        </table>`,
        "#c0392b",
      ),
    );
  }

  if (zeroLive.length > 0) {
    sections.push(
      section(
        `⚠️ ${zeroLive.length} session${zeroLive.length === 1 ? "" : "s"} with ZERO live services`,
        "These are effectively useless until re-authed. Consider deleting if no longer needed.",
        `<table style="width:100%;border-collapse:collapse;border:1px solid #f0f0f0;border-radius:6px;overflow:hidden;">
          <thead><tr style="background:#fcf9ee;">
            <th style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Session</th>
            <th style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Dead services</th>
          </tr></thead>
          <tbody>${zeroLiveRows}</tbody>
        </table>`,
        "#a67a0a",
      ),
    );
  }

  if (keyDead.length > 0) {
    sections.push(
      section(
        `🟠 Key services dead`,
        "GitHub / Vercel / Neon / Supabase / Google — these usually warrant attention first.",
        `<table style="width:100%;border-collapse:collapse;border:1px solid #f0f0f0;border-radius:6px;overflow:hidden;">
          <tbody>${keyDeadRows}</tbody>
        </table>`,
        "#d4670e",
      ),
    );
  }

  if (stale.length > 0) {
    sections.push(
      section(
        `🟡 Stale dead (${stale.length})`,
        "Services that have been dead since the previous check. If you no longer need the session/service, delete it or just live with the noise.",
        `<table style="width:100%;border-collapse:collapse;border:1px solid #f0f0f0;border-radius:6px;overflow:hidden;">
          <tbody>${staleRows}</tbody>
        </table>${stale.length > 20 ? `<div style="font-size:11px;color:#aaa;padding:8px 0 0;">… ${stale.length - 20} more stale entries truncated.</div>` : ""}`,
        "#a67a0a",
      ),
    );
  }

  sections.push(
    section(
      `🟢 Full roster`,
      `${rosters.length} session${rosters.length === 1 ? "" : "s"} · ${totalLive} live · ${totalDead} dead · ${totalNoProbe} no-probe`,
      `<table style="width:100%;border-collapse:collapse;">
        <tbody>${healthyRows}</tbody>
      </table>`,
      "#138a3f",
    ),
  );

  const headlineCount = transitions.length + zeroLive.length;
  const headline =
    transitions.length > 0
      ? `${transitions.length} new dead · ${zeroLive.length} zero-live session${zeroLive.length === 1 ? "" : "s"}`
      : zeroLive.length > 0
        ? `${zeroLive.length} zero-live session${zeroLive.length === 1 ? "" : "s"} still outstanding`
        : `All clear — ${totalLive} live services across ${rosters.length} sessions`;
  const headlineColor = headlineCount > 0 ? "#c0392b" : "#138a3f";

  return `<!doctype html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafafa;margin:0;padding:24px;color:#1a1a1a;">
  <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #ececec;border-radius:10px;overflow:hidden;">
    <div style="padding:22px 26px;border-bottom:1px solid #ececec;">
      <div style="font-size:11px;color:#999;letter-spacing:0.08em;text-transform:uppercase;">Playwright Sessions · Daily Attention Report</div>
      <div style="font-size:20px;font-weight:600;margin-top:6px;color:${headlineColor};">${escapeHtml(headline)}</div>
      <div style="font-size:12px;color:#888;margin-top:6px;">Snapshot ${new Date(snap.ts).toLocaleString()} · probes: Vercel, GitHub, Supabase, LinkedIn, Instagram, Google, YouTube, Notion, X/Twitter, Neon, Higgsfield AI</div>
    </div>
    ${sections.join("")}
    <div style="padding:16px 26px;border-top:1px solid #ececec;font-size:11px;color:#999;line-height:1.6;">
      Run <code style="background:#f4f4f4;padding:2px 6px;border-radius:4px;">npx playwright-cli-sessions list --probe</code> to re-check on demand.
      Services shown as <i>no-probe</i> (Microsoft, WhatsApp) cannot be verified via HTTP — open the session manually to check.
    </div>
  </div>
</body>
</html>`;
}

// ── Entry ─────────────────────────────────────────────────────────────

export async function sendHealthEmail(
  transitions: Transition[],
  snap: Snapshot,
  prev: Snapshot | null,
  to: string,
  apiKey: string,
): Promise<boolean> {
  const rosters = buildRosters(snap, prev);
  const zeroLive = rosters.filter(
    (r) => r.live.length === 0 && (r.dead.length > 0 || r.noProbe.length > 0),
  );
  const subjectBits: string[] = [];
  if (transitions.length > 0)
    subjectBits.push(`${transitions.length} new dead`);
  if (zeroLive.length > 0) subjectBits.push(`${zeroLive.length} zero-live`);
  const subject =
    subjectBits.length > 0
      ? `Playwright Sessions — ${subjectBits.join(", ")}`
      : `Playwright Sessions — all clear`;
  const html = renderHtml(transitions, snap, prev);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[health] email send failed: ${res.status} ${body}`);
      return false;
    }
    console.log(
      `[health] email sent to ${to} (${transitions.length} new dead, ${zeroLive.length} zero-live)`,
    );
    return true;
  } catch (err) {
    console.error(`[health] email send exception:`, err);
    return false;
  }
}
