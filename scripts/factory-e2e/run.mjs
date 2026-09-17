// ============================================================
// Harness end-to-end della Factory.
//
// Esegue il flusso VERO — analyze_website → research_business →
// generate_site → run_site_qa → prepare_outreach — con la coda vera, il
// DB vero (libSQL su file), richieste HTTP vere e il renderer vero.
//
// Cosa NON è reale, e perché:
//  - i siti dei prospect sono serviti in locale (scripts/factory-e2e/
//    fixtures): l'egress verso host di terzi è chiuso dalla policy
//    dell'ambiente, quindi non si può auditare un sito pubblico da qui.
//    Le richieste HTTP, il parsing del JSON-LD e il punteggio sono
//    comunque eseguiti per davvero, non simulati;
//  - i lead sono record di prova marcati (tag "test-e2e", id con
//    prefisso e2e-): non ci sono credenziali del DB di produzione in
//    questo ambiente, quindi non si leggono lead reali;
//  - Gemini non è configurato: gira il percorso di riserva
//    deterministico, che è lo stesso che gira in produzione quando la
//    chiave manca.
//
// Nessun messaggio viene inviato: l'harness non importa alcun canale
// di uscita, esattamente come l'orchestratore.
//
// Uso: node scripts/factory-e2e/run.mjs [--keep-db]
// ============================================================

import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT_DIR = join(HERE, "out");
const DB_PATH = join(OUT_DIR, "factory-e2e.db");
const SITES_PORT = 4310;
const SITES_BASE = `http://127.0.0.1:${SITES_PORT}`;
const PREVIEW_PORT = 4311;
const PREVIEW_BASE = `http://127.0.0.1:${PREVIEW_PORT}`;

mkdirSync(OUT_DIR, { recursive: true });
if (!process.argv.includes("--keep-db") && existsSync(DB_PATH)) rmSync(DB_PATH);

// Il DB è un file locale: nessuna credenziale di produzione è coinvolta.
process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`;
process.env.TURSO_AUTH_TOKEN = "local-e2e";
process.env.FACTORY_PUBLIC_URL = PREVIEW_BASE;
delete process.env.FACTORY_PAUSED;
delete process.env.GEMINI_API_KEY;

const log = (...a) => console.log(...a);
const section = (t) => log(`\n${"=".repeat(64)}\n${t}\n${"=".repeat(64)}`);

// ----- Server dei siti fixture ----------------------------------

const ROUTES = {
  "/glicine": { file: "weak-site.html", delayMs: 0 },
  "/loiodice": { file: "good-site.html", delayMs: 0 },
};

function startSitesServer() {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0].replace(/\/$/, "") || "/";
    const route = ROUTES[path];
    if (!route) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><body>404</body></html>");
      return;
    }
    const body = readFileSync(join(HERE, "fixtures", route.file));
    const send = () => {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": body.length,
      });
      res.end(body);
    };
    if (route.delayMs) setTimeout(send, route.delayMs);
    else send();
  });
  return new Promise((resolve) => server.listen(SITES_PORT, "127.0.0.1", () => resolve(server)));
}

// ----- Lead di prova --------------------------------------------
// Tre casi distinti, uno per esito atteso.

const LEADS = [
  {
    id: "e2e-lead-a-no-site",
    etichetta: "A — senza sito, dati raccolti a mano in visita",
    atteso: "demo generata",
    lead: {
      name: "Barberia Centrale",
      company: "Barberia Centrale",
      email: "",
      phone: "080 5240918",
      city: "Bari",
      category: "barbiere",
      address: "Via Nicolò Putignani 71, 70121 Bari",
      rating: 4.8,
      reviews: 143,
      website: "",
      // Rilevato in visita e digitato in SPECTER: precedenza assoluta.
      manual: {
        service: "Taglio uomo | Barba e rasatura | Taglio bambino | Trattamento cute",
        hours: "Martedì, Mercoledì, Giovedì: 09:00 - 19:00\nVenerdì, Sabato: 08:30 - 20:00\nDomenica, Lunedì: chiuso",
      },
    },
  },
  {
    id: "e2e-lead-b-weak-site",
    etichetta: "B — sito debole (vecchio, non mobile, senza contatti cliccabili)",
    atteso: "demo generata",
    lead: {
      name: "Ristorante Il Glicine",
      company: "Ristorante Il Glicine",
      email: "",
      phone: "080 5327441",
      city: "Modugno",
      category: "ristorante",
      address: "Via Giuseppe Di Vittorio 14, Modugno",
      rating: 4.6,
      reviews: 214,
      website: `${SITES_BASE}/glicine`,
      manual: {},
    },
  },
  {
    id: "e2e-lead-c-good-site",
    etichetta: "C — sito tecnicamente valido",
    atteso: "RESPINTO senza generare",
    lead: {
      name: "Studio Dentistico Loiodice",
      company: "Studio Dentistico Loiodice",
      email: "info@studioloiodice.it",
      phone: "080 5561234",
      city: "Bari",
      category: "dentista",
      address: "Via Sparano da Bari 102, 70121 Bari",
      rating: 4.9,
      reviews: 88,
      website: `${SITES_BASE}/loiodice`,
      manual: {},
    },
  },
];

// ----- Seeding ---------------------------------------------------

async function seed(turso) {
  // Schema esistente: leads + autopilot_pipeline.
  for (const f of ["lib/turso/schema.sql", "lib/autopilot/schema.sql"]) {
    await turso.executeMultiple(readFileSync(join(ROOT, f), "utf8"));
  }

  for (const row of LEADS) {
    const { manual, website, city, category, address, rating, reviews, ...core } = row.lead;
    const meta = {
      rating,
      reviews,
      address,
      category,
      city,
      website,
      has_website: Boolean(website),
      manual,
    };
    await turso.execute({
      sql: `insert or replace into leads
              (id, name, company, email, phone, source, status, value, probability,
               last_contact, next_action, notes, tags, meta)
            values (?, ?, ?, ?, ?, 'maps', 'todo', 0, 0, ?, ?, ?, ?, ?)`,
      args: [
        row.id,
        core.name,
        core.company,
        core.email,
        core.phone,
        new Date().toISOString(),
        "Factory: valutazione sito",
        `RECORD DI PROVA — harness factory-e2e. ${row.etichetta}`,
        JSON.stringify(["test-e2e", "factory"]),
        JSON.stringify(meta),
      ],
    });
    await turso.execute({
      sql: `insert or replace into autopilot_pipeline (lead_id, stage, tier, place_id, category, city)
            values (?, 'da_contattare', '', ?, ?, ?)`,
      args: [row.id, `e2e-place-${row.id}`, category, city],
    });
  }
}

// ----- Esecuzione ------------------------------------------------

async function main() {
  const sites = await startSitesServer();
  log(`Siti fixture serviti su ${SITES_BASE}`);

  const { turso } = await import(`${ROOT}/lib/turso.ts`);
  if (!turso) throw new Error("client libSQL non creato");

  const db = await import(`${ROOT}/lib/factory/db.ts`);
  const queue = await import(`${ROOT}/lib/factory/queue.ts`);
  const orch = await import(`${ROOT}/lib/factory/orchestrator.ts`);

  section("FASE 0 — seeding record di prova");
  await seed(turso);
  await db.ensureFactorySchema();
  log(`${LEADS.length} lead di prova inseriti (tag test-e2e) nel DB locale ${DB_PATH}`);
  for (const l of LEADS) log(`  · ${l.id}: ${l.etichetta} → atteso: ${l.atteso}`);

  section("FASE 1 — arruolamento e dry-run");
  for (const l of LEADS) {
    const res = await orch.enrollLead(l.id, `harness e2e: ${l.etichetta}`);
    log(`  ${l.id}: accodato=${res.enqueued}`);
  }
  const dry = await orch.runWorker({ dryRun: true, batch: 10 });
  log(`  dry-run: ${dry.details.length} job che verrebbero eseguiti, 0 eseguiti`);
  for (const d of dry.details) log(`    · ${d.outcome}`);

  section("FASE 2 — esecuzione reale della pipeline");
  const rounds = [];
  for (let i = 0; i < 12; i++) {
    const res = await orch.runWorker({ batch: 5 });
    if (res.claimed === 0) break;
    rounds.push(res);
    for (const d of res.details) {
      log(`  [giro ${i + 1}] ${d.kind} · ${d.lead_id}\n           → ${d.outcome}`);
    }
  }
  const totals = rounds.reduce(
    (acc, r) => ({
      claimed: acc.claimed + r.claimed,
      succeeded: acc.succeeded + r.succeeded,
      failed: acc.failed + r.failed,
    }),
    { claimed: 0, succeeded: 0, failed: 0 },
  );
  log(`\n  totale: ${totals.claimed} job presi, ${totals.succeeded} riusciti, ${totals.failed} falliti`);

  section("FASE 3 — esito per lead");
  const report = [];
  for (const l of LEADS) {
    const project = await db.getProjectByLead(l.id);
    const pipeline = await turso.execute({
      sql: `select website_status, website_opportunity_score, website_reasons, factory_stage
              from autopilot_pipeline where lead_id = ?`,
      args: [l.id],
    });
    const p = pipeline.rows[0] ?? {};
    const facts = await db.listFacts(l.id);
    const activities = await db.listActivities(l.id);
    const followups = await db.listFollowups({ leadId: l.id });
    const jobs = await queue.listJobs({ leadId: l.id, limit: 50 });

    const entry = {
      id: l.id,
      etichetta: l.etichetta,
      atteso: l.atteso,
      website_status: String(p.website_status ?? ""),
      score: Number(p.website_opportunity_score ?? 0),
      reasons: JSON.parse(String(p.website_reasons ?? "[]")),
      factory_stage: String(p.factory_stage ?? ""),
      project_stage: project?.stage ?? "(nessun progetto)",
      qa_score: project?.qa_score ?? 0,
      qa_passed: project?.qa_report?.passed ?? null,
      qa_failed_checks: (project?.qa_report?.checks ?? []).filter((c) => !c.passed),
      demo_url: project?.demo_url ?? "",
      slug: project?.slug ?? "",
      spec: project?.spec ?? null,
      facts: facts.map((f) => ({
        field: f.field, value: f.value, band: f.band, status: f.status,
        source_url: f.source_url, method: f.method,
      })),
      activities: activities.map((a) => ({ type: a.type, subject: a.subject, by: a.created_by })),
      followups: followups.map((f) => ({ title: f.title, due_at: f.due_at })),
      jobs: jobs.map((j) => ({ kind: j.kind, status: j.status, attempts: j.attempts, outcome: j.outcome, reason: j.reason })),
    };
    report.push(entry);

    log(`\n  ${l.id} — ${l.etichetta}`);
    log(`    sito: ${entry.website_status} · punteggio ${entry.score}/100`);
    log(`    motivazioni: ${entry.reasons.map((r) => `${r.code}(+${r.points}${r.measured ? ` ${r.measured}` : ""})`).join(", ")}`);
    log(`    fase Factory: ${entry.factory_stage} · progetto: ${entry.project_stage}`);
    log(`    QA: ${entry.qa_passed === null ? "non eseguito" : entry.qa_passed ? `superato ${entry.qa_score}/100` : `NON superato ${entry.qa_score}/100`}`);
    if (entry.qa_failed_checks.length) {
      for (const c of entry.qa_failed_checks) {
        log(`      · ${c.blocking ? "BLOCCA" : "minore"}: ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
      }
    }
    log(`    demo: ${entry.demo_url || "(nessuna)"}`);
    log(`    fatti: ${entry.facts.length} (${entry.facts.filter((f) => f.status === "applied").length} applicati, ${entry.facts.filter((f) => f.status === "proposed").length} proposti)`);
    log(`    servizi verificati nella spec: ${(entry.spec?.services ?? []).length}`);
    log(`    timeline: ${entry.activities.length} voci · promemoria: ${entry.followups.length}`);
    log(`    job: ${entry.jobs.map((j) => `${j.kind}=${j.status}`).join(", ")}`);
  }

  section("FASE 4 — controlli di comportamento");
  const checks = [];
  const check = (label, ok, detail = "") => {
    checks.push({ label, ok, detail });
    log(`  ${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  };

  const a = report.find((r) => r.id.includes("lead-a"));
  const b = report.find((r) => r.id.includes("lead-b"));
  const c = report.find((r) => r.id.includes("lead-c"));

  check("lead A senza sito: punteggio massimo", a.score === 100, `${a.score}/100`);
  check("lead A: demo pronta", ["ready", "outreach_ready"].includes(a.project_stage), a.project_stage);
  check("lead B sito debole: sopra soglia", b.score >= 40, `${b.score}/100`);
  check("lead B: demo pronta", ["ready", "outreach_ready"].includes(b.project_stage), b.project_stage);
  check("lead B: servizi presi dal JSON-LD del sito", (b.spec?.services ?? []).length >= 3, `${(b.spec?.services ?? []).length} servizi`);
  check("lead C sito valido: sotto soglia", c.score < 40, `${c.score}/100`);
  check("lead C: RESPINTO", c.factory_stage === "rejected", c.factory_stage);
  check("lead C: nessuna demo generata", !c.demo_url, c.demo_url || "nessuna");
  check(
    "lead C: nessun job di generazione accodato",
    !c.jobs.some((j) => j.kind === "generate_site"),
    c.jobs.map((j) => j.kind).join(",") || "nessuno",
  );
  check("nessun job fallito", totals.failed === 0, `${totals.failed} falliti`);
  check(
    "ogni fatto ha una fonte",
    report.every((r) => r.facts.every((f) => f.source_url || f.method)),
  );
  check(
    "i dati manuali hanno vinto sulle altre fonti",
    a.facts.some((f) => f.method.startsWith("manual/")),
    a.facts.filter((f) => f.method.startsWith("manual/")).map((f) => f.field).join(",") || "nessuno",
  );
  check(
    "promemoria creati per le demo pronte",
    a.followups.length > 0 && b.followups.length > 0,
    `A=${a.followups.length} B=${b.followups.length}`,
  );
  check("nessun promemoria per il lead respinto", c.followups.length === 0, `${c.followups.length}`);

  const outreachActs = [...a.activities, ...b.activities].filter((x) => x.type === "ai_action");
  check("bozze di contatto preparate", outreachActs.length >= 2, `${outreachActs.length}`);

  writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify({ report, checks, totals }, null, 2));
  log(`\nReport completo: ${join(OUT_DIR, "report.json")}`);

  const slugs = report.filter((r) => r.slug && r.demo_url).map((r) => ({ id: r.id, slug: r.slug, url: r.demo_url }));
  writeFileSync(join(OUT_DIR, "demos.json"), JSON.stringify(slugs, null, 2));
  log(`Slug demo per gli screenshot: ${join(OUT_DIR, "demos.json")}`);

  sites.close();
  const failed = checks.filter((x) => !x.ok);
  log(`\n${checks.length - failed.length}/${checks.length} controlli superati`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("\nHARNESS FALLITO:", err);
  process.exitCode = 1;
});
