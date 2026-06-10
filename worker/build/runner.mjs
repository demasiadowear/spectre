// ============================================================
// SPECTRE AUTOPILOT — build runner (Stadio 3).
// Pesca i task "pending" da autopilot_builds:
//   scraping dati attività (ristoranti: processo JustEat standard)
//   -> template dai 5 di ayromex-templates-gallery
//   -> deploy Vercel preview
//   -> status "deployed" (il worker WA notifica Puccio; l'invio al
//      cliente avviene SOLO dopo approvazione manuale in dashboard).
//
//   node build/runner.mjs        # loop continuo
//   node build/runner.mjs --once # una passata e esce
// ============================================================
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  addAlert,
  buildsByStatus,
  pipelineLead,
  updateBuild,
} from "../lib/db.mjs";
import { scrapeJustEat, slugify } from "./justeat.mjs";
import { deployToVercel, prepareSite } from "./deploy.mjs";

const ONCE = process.argv.includes("--once");
const POLL_MS = 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function processBuild(build) {
  const id = String(build.id);
  const lead = await pipelineLead(String(build.lead_id));
  if (!lead) {
    await updateBuild(id, { status: "failed", error: "lead non trovato" });
    return;
  }

  const company = String(lead.company);
  const city = String(lead.city);
  const slug = slugify(company);
  console.log(`[build] ${id} — ${company} (${build.template}, ${build.source})`);

  try {
    // Base manifest dai dati già in SPECTRE (study + meta lead).
    let meta = {};
    try {
      meta = JSON.parse(String(lead.meta ?? "{}"));
    } catch {
      /* meta corrotta */
    }
    const manifest = {
      slug,
      business: company,
      category: String(lead.category),
      city,
      phone: String(lead.phone),
      address: meta.address ?? "",
      rating: meta.rating ?? null,
      reviews: meta.reviews ?? null,
      template: String(build.template),
      generated_at: new Date().toISOString(),
      menu: [],
    };

    await updateBuild(id, { status: "scraping" });
    const siteDir = await prepareSite(slug, String(build.template), manifest);

    if (String(build.source) === "justeat") {
      const scraped = await scrapeJustEat(company, city, siteDir);
      manifest.menu = scraped.dishes;
      manifest.source_url = scraped.url;
      // Riscrive il manifest con il menu dentro la dir del sito.
      await prepareManifest(siteDir, manifest);
    }

    await updateBuild(id, {
      status: "building",
      manifest_json: JSON.stringify(manifest),
    });

    const previewUrl = await deployToVercel(siteDir, slug);
    await updateBuild(id, { status: "deployed", preview_url: previewUrl });
    console.log(`[build] ${id} deployed -> ${previewUrl}`);
  } catch (err) {
    console.error(`[build] ${id} FAILED:`, err.message);
    await updateBuild(id, { status: "failed", error: err.message.slice(0, 500) });
    await addAlert(
      "anomaly",
      `Build demo fallita per ${company}: ${err.message.slice(0, 200)}`,
      String(build.lead_id),
    );
  }
}

async function prepareManifest(siteDir, manifest) {
  await writeFile(
    join(siteDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
}

async function main() {
  await mkdir(process.env.BUILD_WORKDIR ?? "./.builds", { recursive: true });
  console.log("[build] runner avviato…");
  for (;;) {
    const [pending] = await buildsByStatus("pending", 1);
    if (pending) await processBuild(pending);
    if (ONCE) break;
    await sleep(pending ? 5_000 : POLL_MS);
  }
}

main().catch((err) => {
  console.error("[build] fatal:", err);
  process.exit(1);
});
