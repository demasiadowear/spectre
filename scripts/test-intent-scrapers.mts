// Test manuale scraper Intent (senza DB): scraping reale AddLance +
// Freelanceboard, filtro keyword, scoring. Run: npx tsx scripts/test-intent-scrapers.mts
import { launchIntentBrowser, INTENT_USER_AGENT } from "../lib/intent/browser";
import { scrapeAddlance } from "../lib/intent/scrapers/addlance";
import { scrapeFreelanceboard } from "../lib/intent/scrapers/freelanceboard";
import { matchesIntent, scoreIntent, isPugliaZone, hoursSincePublished } from "../lib/intent/score";

const browser = await launchIntentBrowser();
const ctx = await browser.newContext({ userAgent: INTENT_USER_AGENT, locale: "it-IT" });
const page = await ctx.newPage();

const all = [];
for (const [name, run] of [["addlance", scrapeAddlance], ["freelanceboard", scrapeFreelanceboard]] as const) {
  try {
    const items = await run(page);
    console.log(`\n=== ${name}: ${items.length} richieste ===`);
    all.push(...items);
  } catch (e) {
    console.error(`${name} FAILED:`, (e as Error).message);
  }
}
await browser.close();

const matched = all.filter(matchesIntent);
console.log(`\nTotale: ${all.length} — match intent web/digitale: ${matched.length}\n`);
for (const req of matched) {
  const score = scoreIntent(req);
  const h = hoursSincePublished(req);
  console.log(
    `[${score}] ${req.platform} | ${req.title.slice(0, 60)} | zona=${req.zone || "-"} puglia=${isPugliaZone(req)} | budget=${req.budget || "-"} | ${h === null ? "data?" : Math.round(h) + "h"} | ${req.source_url.slice(0, 70)}`,
  );
}
