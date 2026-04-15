/**
 * notify-email — send daily health-check summary via Resend.
 *
 * Activated when both PLAYWRIGHT_HEALTH_EMAIL and RESEND_API_KEY are set.
 * Uses native fetch — no new runtime dependency.
 */

interface Transition {
  session: string;
  service: string;
  from: string;
  to: string;
}

interface SnapshotLike {
  ts: number;
  sessions: Record<string, Record<string, "alive" | "dead" | "unknown">>;
}

const FROM =
  process.env.PLAYWRIGHT_HEALTH_FROM ||
  "Playwright Sessions <no-reply@contact.raxgbc.co.in>";

function renderHtml(transitions: Transition[], snap: SnapshotLike): string {
  const rows = transitions
    .map(
      (t) =>
        `<tr>
          <td style="padding:10px 14px;border-bottom:1px solid #eee;font-family:monospace;font-size:13px;">${escapeHtml(t.session)}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #eee;font-family:monospace;font-size:13px;">${escapeHtml(t.service)}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:13px;color:#c0392b;">${escapeHtml(t.from)} → ${escapeHtml(t.to)}</td>
        </tr>`,
    )
    .join("");

  const aliveCount = Object.values(snap.sessions).reduce(
    (n, svcs) => n + Object.values(svcs).filter((s) => s === "alive").length,
    0,
  );
  const deadCount = Object.values(snap.sessions).reduce(
    (n, svcs) => n + Object.values(svcs).filter((s) => s === "dead").length,
    0,
  );

  return `<!doctype html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafafa;margin:0;padding:24px;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #ececec;border-radius:10px;overflow:hidden;">
    <div style="padding:22px 26px;border-bottom:1px solid #ececec;">
      <div style="font-size:12px;color:#888;letter-spacing:0.08em;text-transform:uppercase;">Playwright Sessions · Daily Health Check</div>
      <div style="font-size:20px;font-weight:600;margin-top:6px;">${transitions.length} session${transitions.length === 1 ? "" : "s"} need${transitions.length === 1 ? "s" : ""} re-login</div>
    </div>
    <div style="padding:22px 26px;">
      <p style="margin:0 0 16px;color:#444;line-height:1.55;">The following saved session${transitions.length === 1 ? "" : "s"} transitioned from <b>alive</b> to <b>dead</b> since the last check. Re-login to restore auth.</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:6px;overflow:hidden;">
        <thead>
          <tr style="background:#f6f6f6;text-align:left;">
            <th style="padding:10px 14px;border-bottom:1px solid #eee;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Session</th>
            <th style="padding:10px 14px;border-bottom:1px solid #eee;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Service</th>
            <th style="padding:10px 14px;border-bottom:1px solid #eee;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Change</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin:22px 0 0;color:#888;font-size:12px;line-height:1.55;">Run <code style="background:#f4f4f4;padding:2px 6px;border-radius:4px;">npx playwright-cli-sessions list</code> to see full status · ${aliveCount} alive, ${deadCount} dead across all sessions · snapshot at ${new Date(snap.ts).toLocaleString()}</p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendHealthEmail(
  transitions: Transition[],
  snap: SnapshotLike,
  to: string,
  apiKey: string,
): Promise<boolean> {
  const subject = `Playwright Sessions: ${transitions.length} session${transitions.length === 1 ? "" : "s"} need re-login`;
  const html = renderHtml(transitions, snap);

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
    console.log(`[health] email sent to ${to} (${transitions.length} dead)`);
    return true;
  } catch (err) {
    console.error(`[health] email send exception:`, err);
    return false;
  }
}
