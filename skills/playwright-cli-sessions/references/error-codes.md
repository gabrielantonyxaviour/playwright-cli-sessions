# PCS_* error codes — complete reference (v0.4.2)

All errors emit `Error [CODE]: message` on stderr. Exit codes are stable across
versions — dispatch on them in shell loops.

---

## Auth errors — exit 77

These all use exit 77. Distinguish them by the error code string in stderr.

### `PCS_AUTH_WALL`

**Exit:** 77  
**Triggers:** Navigation landed on a login page, CAPTCHA, or Cloudflare challenge
instead of the intended destination. Fires when the CLI auto-detects an auth
wall mid-navigation (detection is skipped when the *input* URL is itself a
login route).

**Grep-friendly line on stderr (fires first, before the Error line):**
```
AUTH_WALL service=<s> session=<n> url=<u> suggest="playwright-cli-sessions login <name>"
```

**What to do:**
1. If the session name is known: `playwright-cli-sessions refresh <name>`
2. If no session exists yet: `playwright-cli-sessions login <name> --url=<login-url>`
3. Do NOT retry the same command — the session is missing or expired and will
   hit the wall again.

---

### `PCS_AUTH_EXPIRED`

**Exit:** 77  
**Triggers:** Session cookies are present on disk but the server returned 401/403
on a probe or mid-navigation.

**What to do:** `playwright-cli-sessions refresh <name>` to re-authenticate and
overwrite the stale session file.

---

### `PCS_STALE_SESSION` (v0.4.1+)

**Exit:** 77  
**Triggers:** Pre-launch staleness check — the session's last probe result was
DEAD (non-2xx / redirect to login), or the probe is more than 6 hours old and
the fresh probe returned dead.

**Error shape:**
```
Error [PCS_STALE_SESSION]: Session "<name>" probe failed (302). Last probed 8h ago.
  Run: playwright-cli-sessions refresh <name>
```

**What to do:** Follow the suggestion in the error message:
`playwright-cli-sessions refresh <name>`

**Opt-outs:** `--no-probe` per call, or `PLAYWRIGHT_CLI_NO_STALE_CHECK=1`
globally.

---

## Navigation errors — exit 11

### `PCS_HTTP_ERROR` (v0.4.2+)

**Exit:** 11  
**Triggers:** `page.goto()` received a 4xx or 5xx HTTP response.

**What to do:**
- Verify the URL is correct.
- If the non-2xx response is intentional (scraping error pages, testing 404
  responses), pass `--allow-http-error` to suppress this error and proceed.

---

### `PCS_NAV_FAILED`

**Exit:** 11  
**Triggers:** `page.goto()` threw a navigation error — DNS resolution failure,
TCP connection refused, protocol error, SSL mismatch, or request aborted.

**What to do:**
- Check the URL is reachable: `curl -I <url>`
- Check network connectivity / VPN / proxy settings.
- If the failure is intermittent, retry the command once.

---

## Timeout errors — exit 10

### `PCS_SELECTOR_TIMEOUT`

**Exit:** 10  
**Triggers:** Any `--wait-for=<selector>`, `--wait-for-text=<str>`, or
`--wait-for-count=<sel>:<N>` flag did not resolve within the timeout.

**Error shape:**
```
Error [PCS_SELECTOR_TIMEOUT]: --wait-for="[data-loaded]" timed out after 10000ms
  details: { selector: "[data-loaded]", timeout: 10000 }
```

**What to do:**
- Confirm the selector is correct by running `snapshot <url>` to inspect the
  ARIA tree, or open the page in a headed browser to inspect the DOM.
- The page may need longer to load — try `--timeout=<ms>` to extend the wait.
- If the selector never appears (dynamic data not loaded), add
  `--wait-until=networkidle` before `--wait-for` to let all XHR settle first.

---

## Argument / input errors — exit 2

### `PCS_INVALID_FLAG`

**Exit:** 2  
**Triggers:** An unrecognised flag was passed. Levenshtein suggestion fires
when edit-distance ≤ 2:

```
Error [PCS_INVALID_FLAG]: unknown flag 'waite-for'. Did you mean --wait-for?
```

**What to do:** Fix the flag name. If no suggestion appears, check the command's
`--help` output.

---

### `PCS_MISSING_ARG`

**Exit:** 2  
**Triggers:** A required positional argument is absent (e.g., `exec` called
without a script path).

**What to do:** Supply the missing argument. Run the command with `--help` to
see the required signature.

---

### `PCS_INVALID_INPUT`

**Exit:** 2  
**Triggers:** An argument value fails validation (e.g., `--wait-for-count` given
a non-integer count, `--timeout` given a non-number).

**What to do:** Fix the argument value.

---

## Session errors — exit 3

### `PCS_SESSION_NOT_FOUND`

**Exit:** 3  
**Triggers:** `--session=<name>` was passed but `~/.playwright-sessions/<name>.json`
does not exist.

**What to do:**
1. Run `playwright-cli-sessions list` to see available sessions.
2. Either use a session from the list, or create a new one with
   `playwright-cli-sessions login <name> --url=<login-url>`.

---

## Browser errors — exit 20

### `PCS_BROWSER_CRASH`

**Exit:** 20  
**Triggers:** The browser process exited unexpectedly — OOM kill, GPU driver
crash, or browser binary not found.

**What to do:**
- Re-run — transient crashes (OOM on memory-heavy pages) often don't repeat.
- If persistent: `playwright-cli-sessions report "browser crash on <url>"` so
  the issue can be investigated.
- Check available memory: large pages + full-page screenshots can exhaust RAM
  on machines with < 4 GB available.

---

## Network errors — exit 12

### `PCS_NETWORK`

**Exit:** 12  
**Triggers:** A transient network operation failed — typically during the probe
step (checking session liveness) or during a health check.

**What to do:**
- Retry the command — this is usually a transient blip.
- If it persists: check network connectivity and DNS resolution.

---

## Fallback — exit 1

### `PCS_UNKNOWN`

**Exit:** 1  
**Triggers:** Any error that doesn't match a known category — an unhandled
exception, a bug in user-supplied `exec` script, or a Playwright API error
that isn't classified.

**Error shape:**
```
Error [PCS_UNKNOWN]: TypeError: Cannot read properties of null (reading 'click')
  details: {}
```

**What to do:**
- If the error is from your `exec` script: read the message and fix the script.
  Common causes: null element reference, strict-mode locator violation (see
  `references/exec-patterns.md`), modal overlay interception.
- If the error looks like a CLI bug (not from your script):
  `playwright-cli-sessions report "<what you expected vs what happened>"`.
