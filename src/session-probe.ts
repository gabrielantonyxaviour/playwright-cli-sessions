/**
 * Live auth probe — makes lightweight HTTP requests to service endpoints
 * with the saved cookies to verify sessions are actually alive on the server.
 *
 * Unlike session-expiry.ts (which only reads cookie metadata), this layer
 * catches server-side invalidation: password changes, manual logouts,
 * revoked tokens, etc.
 *
 * Usage:
 *   const results = await probeServices(storageState, ['GitHub', 'Vercel']);
 *   // [{ service: 'GitHub', alive: true }, { service: 'Vercel', alive: false, reason: '401' }]
 *
 * The probe is OPT-IN because it makes network calls. Default UX uses the
 * cheap cookie-expiry scan; --probe switches to this.
 */

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

interface StorageStateShape {
  cookies: Cookie[];
  origins?: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

export interface ProbeResult {
  service: string;
  alive: boolean;
  /** HTTP status code, or "error" / "timeout" / "no-probe" */
  reason: string;
  /** Milliseconds the request took */
  durationMs: number;
}

interface ProbeEndpoint {
  url: string;
  /**
   * HTTP status codes that indicate the session is alive.
   * Most browser-cookie-based probes hit a settings/profile page with
   * redirect:"manual" — 200 = logged in, 302 = redirected to /login = dead.
   */
  aliveStatusCodes: number[];
  /** Additional headers (rarely needed) */
  headers?: Record<string, string>;
  /** HTTP method; defaults to GET */
  method?: string;
  /** Request body (for POST probes like Notion's /api/v3/loadUserContent) */
  body?: string;
  /** Override the 5s default timeout per-service (X/Twitter is slow) */
  timeoutMs?: number;
}

// Per-service probe endpoints.
//
// Principles:
//   1. Endpoints must accept BROWSER SESSION COOKIES (not OAuth tokens).
//      Many API hosts like api.github.com reject session cookies — those
//      are unusable. Use web UI routes like /settings/profile instead.
//   2. Use redirect:"manual" so a 302-to-/login is treated as dead.
//   3. Only include endpoints we've verified actually work end-to-end.
//      It's better to return "no-probe" than to false-flag a live session.
// NOTE: The probe endpoint map is deliberately conservative.
//
// Most modern web apps use localStorage-stored JWTs or Authorization headers
// rather than httpOnly session cookies, so a pure cookie-based probe can't
// verify them. Adding unverified endpoints would produce false "DEAD" results
// and erode trust.
//
// This list only includes endpoints verified to work end-to-end with browser
// session cookies. Services not listed return reason:"no-probe" — that is
// NOT a failure, just "we don't have a probe for this". The CLI/handler
// renders it differently from actual failures.
//
// To add a new endpoint: verify by running `node dist/index.js sessions
// --name=<session> --probe` with a known-good session and confirm [LIVE].
const PROBE_ENDPOINTS: Record<string, ProbeEndpoint> = {
  Vercel: {
    // VERIFIED: api.vercel.com/v2/user returns 200 with browser session cookies.
    // Expired/missing session → 401.
    url: "https://api.vercel.com/v2/user",
    aliveStatusCodes: [200],
  },
  GitHub: {
    // VERIFIED: /settings/profile returns 200 with valid user_session cookie.
    // Expired user_session → 302 redirect to /login.
    url: "https://github.com/settings/profile",
    aliveStatusCodes: [200],
  },
  Supabase: {
    // VERIFIED: /dashboard/account/me returns 200 with valid session.
    // Invalid/missing session → redirect.
    url: "https://supabase.com/dashboard/account/me",
    aliveStatusCodes: [200],
  },
  LinkedIn: {
    // VERIFIED: /feed/ returns 200 when li_at cookie is valid.
    // Expired li_at → 302 redirect to /login.
    url: "https://www.linkedin.com/feed/",
    aliveStatusCodes: [200],
  },
  Instagram: {
    // VERIFIED: /accounts/edit/ returns 200 with valid sessionid cookie.
    // Not logged in → 302 redirect to /accounts/login/.
    url: "https://www.instagram.com/accounts/edit/",
    aliveStatusCodes: [200],
  },
  Google: {
    // VERIFIED: Gmail main mailbox view returns 200 when SID/HSID/SSID cookies
    // are valid. Dead cookies → 302 redirect to accounts.google.com/ServiceLogin.
    // Note: Google is granular — Gmail alive ≠ YouTube alive, so they are
    // probed independently.
    url: "https://mail.google.com/mail/u/0/",
    aliveStatusCodes: [200],
  },
  YouTube: {
    // VERIFIED: YouTube Studio root returns 200 when LOGIN_INFO and SID cookies
    // are valid. Dead → 302 redirect to accounts.google.com/ServiceLogin.
    url: "https://studio.youtube.com/",
    aliveStatusCodes: [200],
  },
  Notion: {
    // VERIFIED: POST /api/v3/loadUserContent with empty body returns 200 JSON
    // when token_v2 cookie is valid. Dead → 401. This is the endpoint Notion's
    // web app uses to bootstrap user data.
    url: "https://www.notion.so/api/v3/loadUserContent",
    aliveStatusCodes: [200],
    method: "POST",
    body: "{}",
    headers: { "Content-Type": "application/json" },
  },
  "X/Twitter": {
    // VERIFIED: /home returns 200 when auth_token + ct0 cookies are valid.
    // Dead → 302 redirect to /i/flow/login. x.com is slow; give it more time.
    url: "https://x.com/home",
    aliveStatusCodes: [200],
    timeoutMs: 10_000,
  },
  Neon: {
    // VERIFIED: /app/projects returns 200 when keycloak session is valid.
    // Dead → 302 redirect to /sign_in. The /api/v2/ endpoints require a
    // separate bearer token and cannot be probed with cookies alone.
    url: "https://console.neon.tech/app/projects",
    aliveStatusCodes: [200],
  },
  "Higgsfield AI": {
    // VERIFIED: Clerk's /v1/me returns 200 with user JSON when session is
    // valid. Dead → 401 {"errors":[{"code":"signed_out"}]}. Clerk is the auth
    // provider for higgsfield.ai so this is the canonical truth.
    url: "https://clerk.higgsfield.ai/v1/me",
    aliveStatusCodes: [200],
  },
  // NOT PROBEABLE (intentionally omitted):
  //   - Microsoft: consumer vs work/school SSO means a single HTTP probe
  //     can't reliably distinguish. Live.com endpoints happily serve 200
  //     shells regardless of auth. Leave as no-probe.
  //   - WhatsApp: auth lives in IndexedDB (not captured by storageState) and
  //     Web.whatsapp.com checks User-Agent aggressively. Browser-only.
};

function normalizeDomain(d: string): string {
  return d.replace(/^\./, "").toLowerCase();
}

/**
 * Build a Cookie header string for a given request URL by selecting cookies
 * whose domain scope matches the URL's hostname — the same matching logic
 * a real browser uses.
 *
 * A cookie with domain ".github.com" is sent to any host ending in "github.com".
 * A cookie with domain "api.github.com" is sent only to api.github.com + subs.
 */
function buildCookieHeader(
  storageState: StorageStateShape,
  requestUrl: string,
): string {
  let hostname: string;
  try {
    hostname = new URL(requestUrl).hostname.toLowerCase();
  } catch {
    return "";
  }

  const parts: string[] = [];
  const seen = new Set<string>();

  for (const c of storageState.cookies) {
    const cd = normalizeDomain(c.domain);
    // Host-only match (cookie without leading dot) OR domain match:
    //   hostname === cd  OR  hostname endsWith "." + cd
    const matches = hostname === cd || hostname.endsWith("." + cd);
    if (!matches) continue;
    if (seen.has(c.name)) continue; // first cookie wins
    seen.add(c.name);
    parts.push(`${c.name}=${c.value}`);
  }

  return parts.join("; ");
}

/**
 * Probe a single service. Returns a ProbeResult regardless of outcome.
 * Never throws.
 */
async function probeOne(
  service: string,
  storageState: StorageStateShape,
  timeoutMs: number,
): Promise<ProbeResult> {
  const endpoint = PROBE_ENDPOINTS[service];
  if (!endpoint) {
    return {
      service,
      alive: false,
      reason: "no-probe",
      durationMs: 0,
    };
  }

  const cookieHeader = buildCookieHeader(storageState, endpoint.url);
  if (!cookieHeader) {
    return {
      service,
      alive: false,
      reason: "no-cookies",
      durationMs: 0,
    };
  }

  const start = Date.now();
  const controller = new AbortController();
  const effectiveTimeout = endpoint.timeoutMs ?? timeoutMs;
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);

  try {
    const res = await fetch(endpoint.url, {
      method: endpoint.method ?? "GET",
      headers: {
        Cookie: cookieHeader,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        ...(endpoint.headers || {}),
      },
      body: endpoint.body,
      signal: controller.signal,
      redirect: "manual", // treat redirects as auth failure
    });

    const durationMs = Date.now() - start;
    const alive = endpoint.aliveStatusCodes.includes(res.status);
    return {
      service,
      alive,
      reason: String(res.status),
      durationMs,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const name =
      err && typeof err === "object" && "name" in err
        ? (err as { name: string }).name
        : "error";
    return {
      service,
      alive: false,
      reason: name === "AbortError" ? "timeout" : "error",
      durationMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe multiple services in parallel. Each probe has its own timeout.
 */
export async function probeServices(
  storageState: unknown,
  services: string[],
  timeoutMs = 5000,
): Promise<ProbeResult[]> {
  const state = storageState as StorageStateShape;
  if (!state?.cookies) return [];
  return Promise.all(services.map((s) => probeOne(s, state, timeoutMs)));
}

/** Services with known probe endpoints — useful to show what can be probed */
export function getProbeCapableServices(): string[] {
  return Object.keys(PROBE_ENDPOINTS);
}
