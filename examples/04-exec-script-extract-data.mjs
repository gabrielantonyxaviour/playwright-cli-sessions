/**
 * 04 — exec script: extract structured data from a page.
 *
 * `exec` runs your `.mjs` file with a real Playwright `page`, `context`,
 * and `browser`. Whatever your `run()` returns is JSON-serialized to
 * stdout. Throw to exit non-zero. You get the full Playwright API:
 * locators, evaluate, network interception, file downloads, anything.
 *
 * Run:
 *   playwright-cli-sessions exec ./04-exec-script-extract-data.mjs
 *
 * Output:
 *   {"title":"Hacker News","topStory":{"title":"...","points":...,"url":"..."}}
 */
export async function run({ page }) {
  await page.goto("https://news.ycombinator.com", {
    waitUntil: "domcontentloaded",
  });

  const title = await page.title();

  const topStory = await page.evaluate(() => {
    const row = document.querySelector("tr.athing");
    if (!row) return null;
    const a = row.querySelector(".titleline > a");
    const sub = row.nextElementSibling;
    const points = sub?.querySelector(".score")?.textContent ?? "";
    return {
      title: a?.textContent ?? "",
      url: a?.getAttribute("href") ?? "",
      points: parseInt(points.replace(/\D/g, ""), 10) || null,
    };
  });

  return { title, topStory };
}
