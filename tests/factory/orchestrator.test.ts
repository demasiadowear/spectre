import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";

// ============================================================
// Freni dell'orchestrazione e generazione della SiteSpec.
//
// Qui si prova ciò che impedisce al sistema di spendere o di mentire:
// pausa globale, dry-run, tetti giornalieri, e il fatto che la
// generazione senza Gemini produca comunque una spec valida e neutra
// (è il percorso che gira davvero quando manca la API key).
//
// Nessuna GEMINI_API_KEY è impostata nei test: geminiJSON torna null e
// si esercita il fallback deterministico. Nessuna chiamata esterna.
// ============================================================

process.env.TURSO_DATABASE_URL = ":memory:";
process.env.TURSO_AUTH_TOKEN = "test";
delete process.env.GEMINI_API_KEY;

type OrchestratorModule = typeof import("@/lib/factory/orchestrator");
type GenerateModule = typeof import("@/lib/factory/generate");
type QueueModule = typeof import("@/lib/factory/queue");
type DbModule = typeof import("@/lib/factory/db");

let orch: OrchestratorModule;
let gen: GenerateModule;
let queue: QueueModule;
let db: DbModule;
let turso: import("@libsql/client").Client;

before(async () => {
  orch = await import("@/lib/factory/orchestrator");
  gen = await import("@/lib/factory/generate");
  queue = await import("@/lib/factory/queue");
  db = await import("@/lib/factory/db");
  const mod = await import("@/lib/turso");
  assert.ok(mod.turso);
  turso = mod.turso;
});

beforeEach(async () => {
  await turso.executeMultiple("drop table if exists agent_jobs;");
  db.resetFactorySchemaCache();
  await db.ensureFactorySchema();
});

describe("isFactoryPaused", () => {
  const original = process.env.FACTORY_PAUSED;
  afterEach(() => {
    if (original === undefined) delete process.env.FACTORY_PAUSED;
    else process.env.FACTORY_PAUSED = original;
  });

  it("per default non è in pausa", () => {
    delete process.env.FACTORY_PAUSED;
    assert.equal(orch.isFactoryPaused(), false);
  });

  for (const v of ["1", "true", "TRUE", "on", " on "]) {
    it(`riconosce "${v}" come pausa`, () => {
      process.env.FACTORY_PAUSED = v;
      assert.equal(orch.isFactoryPaused(), true);
    });
  }

  for (const v of ["0", "false", "no", ""]) {
    it(`non confonde "${v}" con una pausa`, () => {
      process.env.FACTORY_PAUSED = v;
      assert.equal(orch.isFactoryPaused(), false);
    });
  }
});

describe("runWorker", () => {
  const original = process.env.FACTORY_PAUSED;
  afterEach(() => {
    if (original === undefined) delete process.env.FACTORY_PAUSED;
    else process.env.FACTORY_PAUSED = original;
  });

  it("in pausa non tocca la coda", async () => {
    process.env.FACTORY_PAUSED = "1";
    await queue.enqueueJob({ lead_id: "lead-1", kind: "analyze_website", reason: "prova" });
    const res = await orch.runWorker();
    assert.equal(res.paused, true);
    assert.equal(res.claimed, 0);
    // Il job deve essere ancora prendibile: la pausa non lo consuma.
    const job = await queue.claimJob("worker-a");
    assert.ok(job, "il job è stato consumato durante la pausa");
  });

  it("il dry-run racconta senza eseguire", async () => {
    delete process.env.FACTORY_PAUSED;
    await queue.enqueueJob({
      lead_id: "lead-1",
      kind: "analyze_website",
      reason: "lead senza sito",
    });
    const res = await orch.runWorker({ dryRun: true });
    assert.equal(res.claimed, 0);
    assert.equal(res.details.length, 1);
    assert.match(res.details[0].outcome, /dry-run/);
    // Deve citare il motivo: il dry-run serve a capire il perché.
    assert.match(res.details[0].outcome, /lead senza sito/);
    // E il job deve essere intatto.
    const job = await queue.claimJob("worker-a");
    assert.equal(job?.attempts, 1, "il dry-run ha consumato un tentativo");
  });

  it("il batch è limitato anche se ne chiedo di più", async () => {
    delete process.env.FACTORY_PAUSED;
    for (let i = 0; i < 25; i++) {
      await queue.enqueueJob({
        lead_id: `lead-${i}`,
        kind: "analyze_website",
        reason: "prova",
      });
    }
    const res = await orch.runWorker({ batch: 1000, dryRun: true });
    assert.ok(res.details.length <= orch.MAX_BATCH, `batch non clampato: ${res.details.length}`);
  });

  it("su coda vuota non fa niente e non lancia", async () => {
    delete process.env.FACTORY_PAUSED;
    const res = await orch.runWorker();
    assert.equal(res.claimed, 0);
    assert.equal(res.failed, 0);
  });

  it("un lead inesistente fallisce in modo definitivo, senza ritentare", async () => {
    delete process.env.FACTORY_PAUSED;
    const { id } = await queue.enqueueJob({
      lead_id: "lead-che-non-esiste",
      kind: "analyze_website",
      reason: "prova",
      max_attempts: 5,
    });
    const res = await orch.runWorker({ batch: 1 });
    assert.equal(res.failed, 1);
    const job = await queue.getJob(id);
    assert.equal(job?.status, "failed", "un errore fatale è stato messo in ritentativo");
  });
});

describe("DAILY_LIMITS", () => {
  it("copre tutti i tipi di job", () => {
    const kinds = [
      "analyze_website",
      "research_business",
      "generate_site",
      "run_site_qa",
      "prepare_outreach",
      "schedule_followup",
    ];
    for (const k of kinds) {
      assert.equal(typeof orch.DAILY_LIMITS[k as keyof typeof orch.DAILY_LIMITS], "number");
    }
  });

  it("la generazione ha un tetto più basso dell'analisi: costa di più", () => {
    assert.ok(orch.DAILY_LIMITS.generate_site < orch.DAILY_LIMITS.analyze_website);
  });
});

describe("publicBaseUrl", () => {
  const saved = { url: process.env.FACTORY_PUBLIC_URL, vercel: process.env.VERCEL_URL };
  afterEach(() => {
    if (saved.url === undefined) delete process.env.FACTORY_PUBLIC_URL;
    else process.env.FACTORY_PUBLIC_URL = saved.url;
    if (saved.vercel === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = saved.vercel;
  });

  it("preferisce FACTORY_PUBLIC_URL", () => {
    process.env.FACTORY_PUBLIC_URL = "https://siti.ayromex.it/";
    assert.equal(orch.publicBaseUrl(), "https://siti.ayromex.it");
  });

  it("usa VERCEL_URL in https quando manca l'esplicita", () => {
    delete process.env.FACTORY_PUBLIC_URL;
    process.env.VERCEL_URL = "specter.vercel.app";
    assert.equal(orch.publicBaseUrl(), "https://specter.vercel.app");
  });

  it("in locale torna localhost", () => {
    delete process.env.FACTORY_PUBLIC_URL;
    delete process.env.VERCEL_URL;
    assert.equal(orch.publicBaseUrl(), "http://localhost:3000");
  });
});

describe("paletteFor", () => {
  it("assegna palette coerenti per categoria", () => {
    assert.equal(gen.paletteFor("pizzeria").primary, gen.paletteFor("ristorante").primary);
    assert.notEqual(gen.paletteFor("pizzeria").primary, gen.paletteFor("parrucchiere").primary);
  });

  it("una categoria sconosciuta prende la palette di default", () => {
    const fallback = gen.paletteFor("cartomante");
    assert.ok(fallback.primary.startsWith("#"));
    assert.equal(fallback.primary, gen.paletteFor("").primary);
  });

  it("è deterministica: stessa categoria, stessa palette", () => {
    assert.deepEqual(gen.paletteFor("autofficina"), gen.paletteFor("autofficina"));
  });
});

describe("factsFromPlaces", () => {
  it("ogni campo esce come Fact con fonte e timestamp", () => {
    const input = gen.factsFromPlaces({
      lead_id: "lead-1",
      name: "Pizzeria Da Mimmo",
      category: "pizzeria",
      phone: "080 1234567",
      rating: 4.5,
      reviews: 120,
      observed_at: "2026-09-17T10:00:00.000Z",
    });
    assert.equal(input.name.source, "google_places");
    assert.equal(input.name.observed_at, "2026-09-17T10:00:00.000Z");
    assert.equal(input.name.band, "verified");
    assert.equal(input.phone?.value, "080 1234567");
  });

  it("i campi assenti non diventano Fact vuoti", () => {
    const input = gen.factsFromPlaces({ lead_id: "l", name: "X", category: "y" });
    assert.equal(input.phone, undefined);
    assert.equal(input.address, undefined);
    assert.equal(input.reviews_count, undefined);
  });

  it("un rating a zero non viene pubblicato come dato reale", () => {
    const input = gen.factsFromPlaces({
      lead_id: "l",
      name: "X",
      category: "y",
      rating: 0,
      reviews: 0,
    });
    assert.equal(input.rating, undefined);
    assert.equal(input.reviews_count, undefined);
  });
});

describe("generateSiteSpec senza Gemini", () => {
  it("produce comunque una spec valida e neutra", async () => {
    const { validateSiteSpec, findBannedClaims } = await import("@/lib/factory/sitespec");
    const input = gen.factsFromPlaces({
      lead_id: "lead-1",
      name: "Pizzeria Da Mimmo",
      category: "pizzeria",
      phone: "080 1234567",
      city: "Bari",
    });
    const { result, used_ai } = await gen.generateSiteSpec(input);
    assert.equal(used_ai, false, "nessuna API key: non deve risultare usata l'AI");

    const parsed = validateSiteSpec(result.spec);
    assert.equal(parsed.ok, true, parsed.errors.join("; "));
    assert.deepEqual(findBannedClaims(result.spec.copy.hero_title), []);
    assert.deepEqual(findBannedClaims(result.spec.copy.about), []);
  });

  it("non inventa servizi che non gli sono stati dati", async () => {
    const input = gen.factsFromPlaces({ lead_id: "l", name: "X", category: "pizzeria" });
    const { result } = await gen.generateSiteSpec(input);
    assert.deepEqual(result.spec.services, []);
    assert.ok(result.spec.incomplete.includes("servizi"));
  });

  it("usa un segnaposto invece di una foto altrui", async () => {
    const input = gen.factsFromPlaces({ lead_id: "l", name: "X", category: "pizzeria" });
    const { result } = await gen.generateSiteSpec(input);
    assert.equal(result.spec.images[0].placeholder, true);
    assert.equal(result.spec.images[0].url, "");
  });

  it("la CTA si aggancia al telefono verificato", async () => {
    const input = gen.factsFromPlaces({
      lead_id: "l",
      name: "X",
      category: "pizzeria",
      phone: "080 1234567",
    });
    const { result } = await gen.generateSiteSpec(input);
    assert.equal(result.spec.cta.kind, "call");
    assert.equal(result.spec.cta.target, "080 1234567");
  });

  it("senza nessun contatto la CTA viene disattivata, non inventata", async () => {
    const input = gen.factsFromPlaces({ lead_id: "l", name: "X", category: "pizzeria" });
    const { result } = await gen.generateSiteSpec(input);
    assert.equal(result.spec.cta.target, "");
  });

  it("elenca le fonti usate", async () => {
    const input = gen.factsFromPlaces({
      lead_id: "l",
      name: "X",
      category: "pizzeria",
      phone: "080 1",
    });
    const { result } = await gen.generateSiteSpec(input);
    assert.deepEqual(result.spec.sources, ["google_places"]);
  });
});
