# exec patterns — tactical Playwright reference

Deep-dive for writing `exec` `.mjs` scripts or using `exec --eval='<js>'`.
If you are about to write a browser automation script, read this first —
especially sections 1 and 2. These cover the two most common sources of
unexpected failures in the wild.

## Contents

1. [Locator discipline — strict mode](#1-locator-discipline--strict-mode) — `getByRole('Sign In')` matching two buttons
2. [Modal overlays that intercept clicks](#2-modal-overlays-that-intercept-clicks) — `subtree intercepts pointer events`
3. [Wait strategies — decision table](#3-wait-strategies--decision-table) — picking `--wait-for` vs `--wait-for-text` vs `networkidle`
4. [Login flows inside `exec`](#4-login-flows-inside-exec) — scripted credentials (use sparingly)
5. [Background execution and error delivery](#5-background-execution-and-error-delivery) — stderr guarantees under `&`
6. [Selectors inside `evaluate` — vanilla DOM fallback](#6-selectors-inside-evaluate--vanilla-dom-fallback) — last-resort DOM queries

---

## 1. Locator discipline — strict mode

Playwright's role/text locators throw when more than one element matches.
This is called **strict mode** and it fires even when only one of the matches
is visible or relevant to you.

**The failure you will see:**

```
Error: strict mode violation: getByRole('button', { name: 'Sign In' }) resolved
to 2 elements:
  1) <button>Sign In</button>
  2) <button>Sign in with Passkey</button>
```

This was Marty's first blocker on 2026-04-18 — `'Sign In'` substring-matched
`'Sign in with Passkey'`. The fix is one word:

```javascript
// FAILS — substring match catches both elements
await page.getByRole('button', { name: 'Sign In' }).click();

// WORKS — exact: true requires full string equality
await page.getByRole('button', { name: 'Sign In', exact: true }).click();
```

**Locator preference order:**

| Priority | Locator | Why |
|----------|---------|-----|
| 1st | `page.getByRole('button', { name: '...', exact: true })` | Semantically correct, strict-mode safe |
| 2nd | `page.getByLabel('Email', { exact: true })` | Best for form inputs |
| 3rd | `page.getByText('Continue', { exact: true })` | When no ARIA role exists |
| 4th | `page.locator('[data-testid="submit"]')` | When the app has test IDs |
| Last resort | `.first()` / `.nth(0)` | Positionally brittle — fails on DOM reorder |

**Why `.first()` / `.nth()` are last resort:** they select by position in the
DOM, not by meaning. If the page adds a nav button above your target, `.first()`
now points to the wrong element. Only use them when:
- The elements genuinely have no distinguishing label or role
- You've verified the position is stable across page states
- You've left a comment explaining why position is the right selector

**Tip:** Use `playwright-cli-sessions snapshot <url>` to see the ARIA tree before
writing locators. The tree shows role + name for every interactive element — much
faster than guessing from the DOM.

---

## 2. Modal overlays that intercept clicks

**This is the #2 cause of silent `exec` script failures.** A dialog or overlay
is mounted on top of your target — it's transparent but pointer-events-enabled.
The page looks interactive (the button is visible), but Playwright can't click
through the overlay.

**The exact failure signature:**

```
TimeoutError: page.click: Timeout 30000ms exceeded.
  =========================== logs ===========================
  retrying click action, attempt #2
    waiting for element to be visible, enabled and stable
    element is visible, enabled and stable
    scrolling into view if needed
    done scrolling
    <button> from <button class="primary-action"> subtree intercepts pointer events
  ============================================================
```

The phrase **"subtree intercepts pointer events"** is the diagnostic. It means
something in the DOM tree above your target has `pointer-events: all` or no
`pointer-events` override, and Playwright's synthetic click lands on it instead.

**Fix order — try these in sequence:**

### Step 1: Press Escape

Most notification prompts and cookie banners dismiss on Escape:

```javascript
await page.keyboard.press('Escape');
await page.waitForTimeout(300); // give the overlay time to animate out
// now try your click
await page.getByRole('button', { name: 'Continue', exact: true }).click();
```

### Step 2: Dismiss by role

If the overlay is an accessible dialog, dismiss it explicitly:

```javascript
const dialog = page.getByRole('dialog');
if (await dialog.isVisible()) {
  await dialog.getByRole('button', { name: /dismiss|close|not now/i }).click();
  await page.waitForTimeout(300);
}
```

For notification permission prompts specifically (the push-notification banner
with `data-state="open" aria-hidden="true" class="fixed inset-0 z-50"`):

```javascript
// Try to find and click any "Not now" / "No thanks" / "Dismiss" button
const dismissBtn = page.getByRole('button', { name: /not now|no thanks|dismiss|block/i });
if (await dismissBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
  await dismissBtn.click();
}
```

### Step 3: `evaluate + dispatchEvent` (last resort)

When the overlay has no dismissible button — or when step 1/2 still leave an
invisible overlay that intercepts clicks — dispatch the MouseEvent directly on
the DOM node. This bypasses Playwright's pointer-event check entirely:

```javascript
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')]
    .find(b => b.textContent?.trim() === 'Continue');
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});
```

**Why this is a last resort, not a default:** `dispatchEvent` bypasses overlay
detection entirely — including cases where the overlay is intentional (e.g., a
paywall that should block the action). Use it only after confirming the overlay
is an unintended side effect (browser prompts, banners, app-shell junk).

**Prevention:** After `goto()` on pages you know show notification/cookie
prompts, add an Escape + short wait before any clicks:

```javascript
await page.goto('https://app.example.com');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
```

---

## 3. Wait strategies — decision table

Every fresh navigation can leave you with blank screenshots or stale DOM if
content loads asynchronously. Choose the wait that matches what you're
actually waiting for:

| Need | CLI flag | Playwright API equivalent |
|------|-------------|--------------------------|
| A specific element to appear | `--wait-for=<selector>` | `page.waitForSelector(sel)` |
| A text string anywhere on the page | `--wait-for-text="<str>"` | `page.waitForFunction(() => document.body.innerText.includes('...'))` |
| N items in a list/grid rendered | `--wait-for-count=<sel>:<N>` | `page.waitForFunction(() => document.querySelectorAll(sel).length >= N)` |
| All XHR/fetch finished (SPA) | `--wait-until=networkidle` or `--wait-for-network=idle` | `page.waitForLoadState('networkidle')` |
| Post-login route change | `page.waitForURL` (see pitfall) | — |

**`waitForURL` pitfall:** match loosely. If the real post-login redirect is
`/dashboard?first=true` and you wrote:

```javascript
await page.waitForURL('**/dashboard');
```

Playwright's glob `**/dashboard` won't match `/dashboard?first=true` because
the query string adds a trailing segment. Use either:

```javascript
// Option A: include the wildcard suffix
await page.waitForURL('**/dashboard**');

// Option B: more resilient — wait for a known post-login DOM element instead
await page.waitForSelector('[data-testid="home-nav"]', { timeout: 10_000 });

// Option C: blunt but reliable for exploratory work
await page.waitForTimeout(2000);
await page.waitForSelector('[data-testid="home-nav"]');
```

Option C is not elegant, but it degrades gracefully when the redirect pattern
changes — the `waitForSelector` still guards against acting before the page
is ready.

**For screenshot commands:** always add `--wait-for=<selector>` targeting a
content landmark — otherwise the screenshot fires the moment the HTML shell
loads, before JS-fetched data arrives, producing dark loading boxes.

```bash
playwright-cli-sessions screenshot https://app.example.com/dashboard \
  --wait-for='[data-loaded="true"]' \
  --out=/tmp/dash.png
```

---

## 4. Login flows inside `exec`

A known-good recipe for scripted login when saving a new session isn't
practical:

```javascript
// /tmp/login-and-act.mjs
export async function run({ page }) {
  await page.goto('https://app.example.com/login');

  // Use exact: true on every form locator — pages routinely have multiple
  // "Email" fields (visible + hidden) and strict mode will throw without it.
  await page.getByLabel('Email', { exact: true }).fill(process.env.EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(process.env.PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  // Wait for a post-login DOM landmark, NOT the URL (see waitForURL pitfall above)
  await page.waitForSelector('[data-testid="home-nav"]', { timeout: 10_000 });

  // --- do actual work here ---
  const title = await page.title();
  return { loggedIn: true, title };
}
```

```bash
EMAIL=user@example.com PASSWORD=secret \
  playwright-cli-sessions exec /tmp/login-and-act.mjs
```

**Prefer `login` + saved session over scripted credentials.** Scripting
credentials means re-authenticating on every run, which is slower, fragile
against 2FA, and noisy in logs. Use the scripted-login pattern only for:
- One-off exploratory runs where saving a session would be overkill
- Services where `login` + headful auth isn't available (API-key-only services)
- CI environments where cookies can't be persisted between runs

**Never automate credential entry for services you don't own.** The
`login`/`refresh` + saved-session workflow exists precisely to keep credentials
out of your scripts.

---

## 5. Background execution and error delivery

`playwright-cli-sessions` guarantees that a crashing `exec` run delivers its
error on stderr with a non-zero exit code, even when backgrounded with `&` and
stdout/stderr are redirected to files. Errors are classified into the
`PcsError` taxonomy (see `references/error-codes.md`).

**Expected shape on a thrown error:**

```bash
$ playwright-cli-sessions exec /tmp/script.mjs > /tmp/out.log 2> /tmp/err.log &
$ wait $!; echo "exit=$?"
exit=1

$ cat /tmp/err.log
Error [PCS_UNKNOWN]: TypeError: Cannot read properties of null (reading 'click')
  details: {}
```

For known error categories (auth walls, selector timeouts, nav failures),
you get the structured code instead of `PCS_UNKNOWN`:

```
Error [PCS_SELECTOR_TIMEOUT]: --wait-for="[data-loaded]" timed out after 10000ms
  details: { selector: "[data-loaded]", timeout: 10000 }
```

**In CI or parallel shell loops:** always capture both stdout and stderr, and
`wait` on the background PID before reading the logs:

```bash
playwright-cli-sessions exec /tmp/script.mjs > /tmp/out.log 2> /tmp/err.log &
PID=$!
# ... other work ...
wait $PID
EXIT=$?
if [ $EXIT -ne 0 ]; then
  echo "Script failed (exit $EXIT):"
  cat /tmp/err.log
fi
```

---

## 6. Selectors inside `evaluate` — vanilla DOM fallback

When Playwright's role/text locators can't uniquely identify an element (and
you've exhausted the options in section 1), use `page.evaluate` to run
vanilla JS in the browser context:

```javascript
// Find by partial text when getByText would strict-mode-fail
const result = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')]
    .find(b => b.textContent?.trim().startsWith('Continue'));
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return !!btn; // return data, not DOM refs (DOM refs don't cross the boundary)
});
if (!result) throw new Error('Continue button not found');
```

**Key rules for `evaluate` blocks:**

- Keep the block small — it runs in the browser's JS context, debugging is hard
- Return serializable data (strings, numbers, booleans, plain objects/arrays)
- Never return DOM element references — they can't cross the Node/browser boundary
- If you need to read element state AND click, do it in a single evaluate call
  so the element reference doesn't go stale between calls

**Combining `evaluate` with Playwright's waits:**

```javascript
// Wait for element to exist before evaluating
await page.waitForSelector('.card-list');

const cards = await page.evaluate(() =>
  [...document.querySelectorAll('.card-list .card')]
    .map(c => ({ title: c.querySelector('h3')?.textContent?.trim() }))
);
```
