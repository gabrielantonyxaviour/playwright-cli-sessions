/**
 * Shared browser-launch helper for every CLI command that spawns Chromium.
 *
 * ⚠️  ARCHITECTURAL CONSTRAINT — DO NOT POLL BROWSER APIs
 * ────────────────────────────────────────────────────────
 * NEVER call storageState(), page.evaluate(), or any Playwright browser API
 * on a recurring timer (setInterval / setTimeout loop). On macOS, each call
 * activates the browser window and steals OS-level focus, making the machine
 * unusable. The only safe pattern is a single capture triggered by a user
 * action (Enter key press or browser window close).
 *
 * What this solves
 * ----------------
 * Playwright's default "bundled Chromium" is actually **Chrome for Testing** —
 * a distinct build identified by its patch version (`147.0.7727.15` vs a real
 * Chrome's `147.0.7727.56`), empty plugin array, and `navigator.webdriver === true`.
 * Sites with commodity bot detection (Tinder, Bumble, Instagram, Cloudflare-gated
 * endpoints) flag it on first contact and shadowban / block the account.
 *
 * To avoid that we:
 *   1. Launch the real system Chrome via `channel: "chrome"` (not the bundled
 *      Chrome for Testing).
 *   2. Remove the `--enable-automation` switch so the browser doesn't advertise
 *      itself as automated.
 *   3. Add `--disable-blink-features=AutomationControlled` which flips
 *      `navigator.webdriver` from `true` to `false`.
 *
 * Default channel (v0.4.0+)
 * -------------------------
 * When no --channel flag is passed (opts.channel undefined), chrome is used
 * automatically. To opt out, set PLAYWRIGHT_CLI_BUNDLED=1 or pass
 * --channel=chromium (both route to the bundled Chromium path, no stealth).
 *
 * Stealth patch (v0.3.2+, enabled by default when not in bundled mode)
 * ---------------------------------------------------------------------
 * Even with the above, Playwright's --headless=new mode still emits
 * `HeadlessChrome/<ver>` in both the HTTP User-Agent header and navigator.userAgent.
 * CDN-level bot filters (Cloudflare, Akamai, DataDome, PerimeterX) check the
 * UA header at the edge before any JavaScript runs. The stealth patch rewrites
 * it to `Chrome/<ver>` and also spoofs navigator.connection.rtt (reported as 0
 * in headless) and devicePixelRatio (always 1 in headless, should be 2 on Mac).
 *
 * This is handled by createStealthContext() — use it instead of browser.newContext()
 * directly. The patch is applied automatically when not in bundled mode and
 * PLAYWRIGHT_CLI_NO_STEALTH_PATCH is unset.
 *
 * Provenance: surfaced by a real Tinder signup field test against v0.3.1 on
 * 2026-04-18 which confirmed HeadlessChrome appeared in UA despite --channel=chrome.
 *
 * Opt-outs
 * --------
 * - `PLAYWRIGHT_CLI_BUNDLED=1` — use legacy bundled Chromium (no channel, no stealth).
 *   Useful for CI / headless servers without real Chrome installed.
 * - `PLAYWRIGHT_CLI_NO_STEALTH_PATCH=1` — keep --channel=chrome launch args but skip
 *   the UA rewrite, RTT spoof, and DPR patch. Useful if you want to test your own
 *   site's bot-detection pipeline against a headless UA.
 */

import { chromium } from "playwright";
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  LaunchOptions,
} from "playwright";

export interface LaunchOpts {
  headless?: boolean;
  /** Browser channel — "chrome" (default), "msedge", or omit for bundled Chromium. */
  channel?: string;
  /** Extra launch args appended to the stealth defaults. */
  args?: string[];
  /** Extra ignoreDefaultArgs entries appended to the stealth defaults. */
  ignoreDefaultArgs?: string[];
  /** Extra generic LaunchOptions forwarded to `chromium.launch`. */
  extra?: Omit<
    LaunchOptions,
    "headless" | "args" | "channel" | "ignoreDefaultArgs"
  >;
}

const STEALTH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  // Prevent macOS's on-demand font download prompt (e.g. Osaka, Kashida) that
  // fires when a page enumerates system fonts or paints CJK/emoji glyphs. The
  // prompt is a system-level UI interrupt, not a website install — but it's
  // disruptive during automation.
  "--disable-remote-fonts",
  "--disable-features=DownloadableFontsPreferences",
];

const STEALTH_IGNORE = ["--enable-automation"];

export async function launchStealthChrome(
  opts: LaunchOpts = {},
): Promise<Browser> {
  const headless = opts.headless ?? false;
  // --channel=chromium is an explicit opt-out: treat like PLAYWRIGHT_CLI_BUNDLED=1
  const bundled =
    process.env.PLAYWRIGHT_CLI_BUNDLED === "1" || opts.channel === "chromium";

  const channelLabel = bundled ? "chromium" : (opts.channel ?? "chrome");
  // One-line mode indicator on stderr. Lets scenarios assert mode and gives
  // users a quick "am I headless or not" glance without --debug. Suppress with
  // PLAYWRIGHT_CLI_QUIET=1.
  if (process.env.PLAYWRIGHT_CLI_QUIET !== "1") {
    process.stderr.write(
      `[pcs] browser: ${headless ? "headless" : "headful"} ${channelLabel}\n`,
    );
  }

  if (bundled) {
    return chromium.launch({
      headless,
      args: opts.args,
      ...opts.extra,
    });
  }

  return chromium.launch({
    channel: opts.channel ?? "chrome",
    headless,
    args: [...STEALTH_ARGS, ...(opts.args ?? [])],
    ignoreDefaultArgs: [...STEALTH_IGNORE, ...(opts.ignoreDefaultArgs ?? [])],
    ...opts.extra,
  });
}

/**
 * Apply stealth init scripts to a BrowserContext. These are belt-and-suspenders
 * on top of the launch flags — even if some future Chrome release reverts
 * behavior around `--disable-blink-features`, these scripts keep
 * `navigator.webdriver` undefined and `window.chrome.runtime` present.
 */
export const STEALTH_INIT_SCRIPT = `
(() => {
  // Each patch closes a specific signal used by CreepJS (abrahamjuliot.github.io/creepjs)
  // and rebrowser's bot-detector. Source-mapped to creep.js:5421 getHeadlessFeatures.

  // webDriverIsOn: real Chrome returns \`false\`, not \`undefined\`.
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: () => false,
      configurable: true,
    });
  } catch (e) {}

  try {
    if (window.chrome && !window.chrome.runtime) {
      window.chrome.runtime = {};
    }
  } catch (e) {}

  // pdfIsDisabled: headless Chrome reports \`pdfViewerEnabled === false\`.
  try {
    Object.defineProperty(Navigator.prototype, 'pdfViewerEnabled', {
      get: () => true,
      configurable: true,
    });
  } catch (e) {}

  // notificationIsDenied + hasPermissionsBug: headless defaults Notification.permission
  // to 'denied', and navigator.permissions.query({name:'notifications'}) returns 'prompt'
  // while Notification.permission is 'denied' — CreepJS flags that exact mismatch.
  try {
    if (typeof Notification !== 'undefined') {
      Object.defineProperty(Notification, 'permission', {
        get: () => 'default',
        configurable: true,
      });
    }
  } catch (e) {}
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function (desc) {
        if (desc && desc.name === 'notifications') {
          return Promise.resolve({
            state: 'prompt',
            name: 'notifications',
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
          });
        }
        return origQuery(desc);
      };
    }
  } catch (e) {}

  // noTaskbar: real macOS has screen.availHeight < screen.height (menu bar = 38px).
  // Headless reports them equal.
  try {
    const realH = screen.height;
    const realW = screen.width;
    Object.defineProperty(screen, 'availHeight', {
      get: () => realH - 38,
      configurable: true,
    });
    Object.defineProperty(screen, 'availWidth', {
      get: () => realW,
      configurable: true,
    });
    Object.defineProperty(screen, 'availTop', {
      get: () => 38,
      configurable: true,
    });
    Object.defineProperty(screen, 'availLeft', {
      get: () => 0,
      configurable: true,
    });
  } catch (e) {}

  // hasVvpScreenRes: headless sets outerHeight === screen.height && innerWidth === screen.width.
  // There's an own getter on \`window\` itself that shadows Window.prototype, so we
  // override on the instance directly.
  try {
    Object.defineProperty(window, 'outerHeight', {
      get() { return window.innerHeight + 85; }, // address bar + tab strip ≈ 85px
      configurable: true,
    });
    Object.defineProperty(window, 'outerWidth', {
      get() { return window.innerWidth; },
      configurable: true,
    });
  } catch (e) {}

  // hasKnownBgColor: headless Chrome renders \`ActiveText\` CSS as rgb(255,0,0).
  // Inject a style override so computed background-color isn't the known-bad value.
  try {
    const injectStyle = () => {
      if (document.getElementById('__pcs_activetext_patch')) return;
      const s = document.createElement('style');
      s.id = '__pcs_activetext_patch';
      s.textContent = '* { --__pcs_t: ActiveText; }';
      (document.head || document.documentElement).appendChild(s);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectStyle, { once: true });
    } else {
      injectStyle();
    }
  } catch (e) {}
})();
`;

/**
 * Fingerprint patches applied on top of the baseline init script. Skipped when
 * PLAYWRIGHT_CLI_NO_STEALTH_PATCH=1.
 *
 * Worker-scope UA override (v0.5.0)
 * ---------------------------------
 * Playwright's `context.userAgent` option rewrites the HTTP UA header and the
 * main-thread `navigator.userAgent`, but `HeadlessChrome/<ver>` still leaks
 * inside WebWorker / SharedWorker / ServiceWorker scopes — deep fingerprinters
 * (CreepJS, Fingerprint Pro at paranoid tier) spawn a worker and read
 * `self.navigator.userAgent` to bypass main-thread patches. We wrap the Worker
 * and SharedWorker constructors so same-origin script URLs get rehosted as a
 * blob that prepends a `navigator.userAgent` override.
 *
 * Limits: module workers and cross-origin worker URLs pass through unpatched
 * (importScripts would CORS-fail). Acceptable — commodity detectors use
 * same-origin classic workers; the sites that use exotic worker loading
 * aren't what we're trying to sneak past.
 */
export function buildStealthPatchScript(ua: string): string {
  const uaJson = JSON.stringify(ua);
  return `
(() => {
  try {
    Object.defineProperty(Navigator.prototype, 'userAgent', {
      get: () => ${uaJson},
      configurable: true,
    });
  } catch (e) {}
  try {
    if (navigator.connection) {
      Object.defineProperty(navigator.connection, 'rtt', {
        get: () => 50 + Math.floor(Math.random() * 50),
        configurable: true,
      });
    }
  } catch (e) {}
  try {
    const PATCH = ${JSON.stringify(
      `(() => { try { Object.defineProperty(self.navigator, 'userAgent', { get: () => __UA__, configurable: true }); } catch(e) {} })();`,
    )}.replace('__UA__', ${JSON.stringify(uaJson)});
    const wrap = (OrigCtor) => {
      if (!OrigCtor) return OrigCtor;
      const Wrapped = function(scriptURL, options) {
        try {
          const url = scriptURL instanceof URL ? scriptURL.toString() : scriptURL;
          const isModule = options && options.type === 'module';
          if (typeof url === 'string' && !isModule) {
            let sameOrigin = false;
            try {
              const u = new URL(url, self.location.href);
              sameOrigin = u.origin === self.location.origin || u.protocol === 'blob:';
            } catch (e) {}
            if (sameOrigin) {
              const proxy = PATCH + '\\ntry { importScripts(' + JSON.stringify(url) + '); } catch(e) {}';
              const blob = new Blob([proxy], { type: 'application/javascript' });
              return new OrigCtor(URL.createObjectURL(blob), options);
            }
          }
        } catch (e) {}
        return new OrigCtor(scriptURL, options);
      };
      Wrapped.prototype = OrigCtor.prototype;
      return Wrapped;
    };
    if (self.Worker) self.Worker = wrap(self.Worker);
    if (self.SharedWorker) self.SharedWorker = wrap(self.SharedWorker);
  } catch (e) {}
  try {
    // ServiceWorker can't be rehosted as a blob (browser security), and
    // Playwright's context.route() doesn't reliably intercept the SW install
    // script request to rewrite the body. Deep fingerprinters (CreepJS) probe
    // self.navigator.userAgent inside the SW scope to bypass main-thread UA
    // overrides. Since we don't need SW for session work, reject register()
    // so the SW-scope fingerprint path is unavailable.
    if (navigator.serviceWorker && navigator.serviceWorker.register) {
      navigator.serviceWorker.register = function () {
        return Promise.reject(new DOMException('SecurityError', 'SecurityError'));
      };
    }
  } catch (e) {}
})();
`;
}

/** Build a headful-looking User-Agent string from a raw Chrome version number. */
function buildStealthUA(version: string): string {
  const platform = process.platform;
  if (platform === "win32") {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
  } else if (platform === "darwin") {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
  } else {
    return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
  }
}

/**
 * Create a BrowserContext with stealth settings applied.
 *
 * When the stealth patch is active (default: non-bundled + PLAYWRIGHT_CLI_NO_STEALTH_PATCH unset):
 *   - Rewrites the User-Agent to remove "HeadlessChrome" (fixes CDN-level UA detection)
 *   - Sets deviceScaleFactor to match the host OS (2 on macOS, 1 elsewhere)
 *   - Sets viewport to a realistic desktop size
 *   - Spoofs navigator.connection.rtt to a non-zero value
 *
 * Always applies the baseline init script (navigator.webdriver removal, chrome.runtime).
 */
export async function createStealthContext(
  browser: Browser,
  baseOpts: BrowserContextOptions = {},
  bundledOverride?: boolean,
): Promise<BrowserContext> {
  const bundled = bundledOverride ?? process.env.PLAYWRIGHT_CLI_BUNDLED === "1";
  const noPatch = process.env.PLAYWRIGHT_CLI_NO_STEALTH_PATCH === "1";
  const shouldPatch = !bundled && !noPatch;

  const contextOpts: BrowserContextOptions = { ...baseOpts };

  if (shouldPatch) {
    const version = browser.version();
    const isMac = process.platform === "darwin";
    contextOpts.userAgent = buildStealthUA(version);
    contextOpts.deviceScaleFactor = isMac ? 2 : 1;
    contextOpts.viewport = isMac
      ? { width: 1440, height: 900 }
      : { width: 1920, height: 1080 };
  }

  const context = await browser.newContext(contextOpts);
  await context.addInitScript(STEALTH_INIT_SCRIPT);
  if (shouldPatch) {
    const ua = contextOpts.userAgent ?? buildStealthUA(browser.version());
    await context.addInitScript(buildStealthPatchScript(ua));
  }
  return context;
}
