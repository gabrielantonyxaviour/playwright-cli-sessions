# Session expiry model — how probes work

## Two-layer status model

Sessions have two independent status signals:

### 1. Cookie-expiry (cheap, local, no network)

Scans cookie metadata from the saved JSON file. Reports:

| Status | Meaning |
|--------|---------|
| `valid` | Auth cookies present, expire > 3 days from now |
| `expiring-soon` | Auth cookies expire within 3 days |
| `expired` | All auth cookies are past their expiry timestamp |
| `session-only` | Auth cookies have no expiry (httpOnly session cookies) — can't judge |
| `unknown` | No auth cookies detected for this service |

**Limitation:** A server can invalidate cookies server-side (password change,
security event, manual logout) without changing the local expiry timestamp.
Cookie-expiry will claim `valid` even though the session is actually dead.

### 2. Live HTTP probe (network call, cached 1h)

Makes a lightweight `GET` request to a service-specific endpoint with the
saved cookies. Success = response status in the configured alive codes.

| Display | Meaning |
|---------|---------|
| `[LIVE, probed 3m ago]` | Probe returned 200 within cache TTL |
| `[DEAD, 401]` | Server rejected the session |
| `[DEAD, 302]` | Server redirected to login page |
| `[no-probe]` | No endpoint configured for this service |
| `[timeout]` | Probe took > 8s (service may be down) |

## Probe cache

Results are cached in `~/.playwright-sessions/.probe-cache.json` for 1 hour.
Both `playwright-cli-sessions` and `playwright-sessions` MCP share this cache.
Running `playwright-cli-sessions probe <name>` forces a fresh probe and updates
the cache for all tools.

## Services with probe endpoints

Currently configured: Vercel, GitHub, Google, YouTube, Neon, Supabase,
LinkedIn, Notion, Higgsfield AI, Instagram, X/Twitter, Microsoft, Tldv.

Services without endpoints (`[no-probe]`): WhatsApp (SPA, no stateless endpoint).

## Default behavior

`playwright-cli-sessions list` runs probes by default (cached). Pass
`--probe=false` to use cookie-expiry metadata only (faster, offline-capable).
