/**
 * screenshot-guard — cap PNG dimensions so Claude Code sessions can Read them.
 *
 * Anthropic's image input API rejects any image > 2000px on either axis in
 * many-image requests. Our stealth context sets deviceScaleFactor=2 on macOS
 * with a 1440×900 viewport — the raw Playwright capture comes out 2880×1800,
 * which fails that limit silently (the Read tool returns an error). `--full-page`
 * on any moderately tall page compounds it.
 *
 * Fix: capture at CSS-pixel scale (removes DPR multiplier) and post-process
 * with sharp to fit within a max dimension (default 2000). Emits a one-line
 * stderr note whenever a downscale actually happens so AI sessions know the
 * saved image is not raw-resolution.
 *
 * Opt-outs:
 *   --no-downscale                          — write raw capture, skip the guard
 *   --max-dimension=<N>                     — override the 2000 cap per call
 *   PLAYWRIGHT_CLI_NO_DOWNSCALE=1           — global skip
 *   PLAYWRIGHT_CLI_MAX_DIMENSION=<N>        — global override
 */

import { writeFileSync } from "node:fs";
import type { Page } from "playwright";
import sharp from "sharp";

export interface GuardOpts {
  path?: string;
  fullPage?: boolean;
  maxDimension?: number;
  noDownscale?: boolean;
}

// Anthropic's many-image dimension limit is 2000px. Their check appears to
// reject at exactly 2000 (we've seen "exceeds the dimension limit (2000px)"
// from sources reported as 2000-and-something). Hold a safety margin so we
// never produce an image that gets rejected on that boundary.
const DEFAULT_MAX = 1900;

function resolveMaxDim(opts: GuardOpts): number {
  if (opts.maxDimension !== undefined) return opts.maxDimension;
  const envRaw = process.env.PLAYWRIGHT_CLI_MAX_DIMENSION;
  if (envRaw && envRaw !== "") {
    const n = parseInt(envRaw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_MAX;
}

function shouldSkip(opts: GuardOpts): boolean {
  if (opts.noDownscale === true) return true;
  if (process.env.PLAYWRIGHT_CLI_NO_DOWNSCALE === "1") return true;
  return false;
}

/**
 * Capture a screenshot and, unless opted out, downscale to fit within
 * maxDimension on each axis. Returns the final PNG buffer. When `path` is set,
 * the file is written and the buffer is still returned for the caller's use.
 */
export async function captureScreenshot(
  page: Page,
  opts: GuardOpts = {},
): Promise<Buffer> {
  // `scale: 'css'` prevents the deviceScaleFactor from doubling the output
  // resolution. 1440×900 viewport → 1440×900 PNG, not 2880×1800.
  const raw = await page.screenshot({
    fullPage: opts.fullPage === true,
    scale: "css",
  });

  if (shouldSkip(opts)) {
    if (opts.path) writeFileSync(opts.path, raw);
    return raw;
  }

  const maxDim = resolveMaxDim(opts);
  const meta = await sharp(raw).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;

  if (w <= maxDim && h <= maxDim) {
    if (opts.path) writeFileSync(opts.path, raw);
    return raw;
  }

  const scale = Math.min(maxDim / w, maxDim / h);
  const newW = Math.floor(w * scale);
  const newH = Math.floor(h * scale);
  const resized = await sharp(raw)
    .resize(newW, newH, { fit: "inside" })
    .png()
    .toBuffer();

  process.stderr.write(
    `ℹ Downscaled screenshot ${w}×${h} → ${newW}×${newH} (max-dimension ${maxDim}; pass --no-downscale to keep full resolution)\n`,
  );

  if (opts.path) writeFileSync(opts.path, resized);
  return resized;
}

/**
 * Monkey-patch `page.screenshot()` so any call inside an `exec` script
 * automatically gets the same downscale guard as the `screenshot` subcommand.
 *
 * Background: agents often write `await page.screenshot({ path: ... })`
 * directly inside an exec `.mjs` script. Without this wrapper, those go
 * straight to Playwright's raw screenshot, which produces 2880×1800 (Mac DPR-2)
 * or larger files that Anthropic's many-image limit (2000px) rejects when the
 * agent later tries to read them.
 *
 * The wrapper:
 * - applies `scale: 'css'` so DPR-2 doesn't double the output
 * - downscales the buffer through sharp to fit within DEFAULT_MAX (1900) on
 *   each axis
 * - if `path` is provided in the original opts, writes the downscaled buffer
 *   to that path
 *
 * Skip via `PLAYWRIGHT_CLI_NO_DOWNSCALE=1` env (which already shouldSkip
 * honors). Per-call `noDownscale` is not exposed because `page.screenshot()`'s
 * Playwright signature doesn't accept it.
 */
export function wrapPageScreenshot(page: Page): void {
  const original = page.screenshot.bind(page);
  // Wrap. We don't worry about TS strictness — this is a runtime monkey-patch
  // for the user's exec script convenience.
  (page as unknown as { screenshot: typeof page.screenshot }).screenshot =
    async function (o?: Parameters<typeof original>[0]): Promise<Buffer> {
      const original_opts = o ?? {};
      // Force scale: 'css' unless caller overrides — keeps DPR-2 from doubling.
      const buf = await original({
        ...original_opts,
        // Strip path so original doesn't write the un-downscaled bytes.
        path: undefined,
        scale: original_opts.scale ?? "css",
      });
      if (shouldSkip({})) {
        if (original_opts.path) writeFileSync(original_opts.path, buf);
        return buf;
      }
      const maxDim = resolveMaxDim({});
      const meta = await sharp(buf).metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;
      if (w <= maxDim && h <= maxDim) {
        if (original_opts.path) writeFileSync(original_opts.path, buf);
        return buf;
      }
      const scale = Math.min(maxDim / w, maxDim / h);
      const newW = Math.floor(w * scale);
      const newH = Math.floor(h * scale);
      const resized = await sharp(buf)
        .resize(newW, newH, { fit: "inside" })
        .png()
        .toBuffer();
      process.stderr.write(
        `ℹ Downscaled exec page.screenshot ${w}×${h} → ${newW}×${newH} (max-dimension ${maxDim})\n`,
      );
      if (original_opts.path) writeFileSync(original_opts.path, resized);
      return resized;
    };
}
