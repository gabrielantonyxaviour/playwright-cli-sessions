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

const DEFAULT_MAX = 2000;

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
