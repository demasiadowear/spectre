// L'ambiente PRIMA di tutto: vedi _ambiente-e2e.ts per il perche.
import { DIR_E2E } from "./_ambiente-e2e";

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";

import {
  ensureCollectorSchema, leggiDossier, resetCollectorSchemaCache, salvaDossier,
} from "../../lib/collector/db";
import { ensureFactorySchema, resetFactorySchemaCache } from "../../lib/factory/db";
import { claimSpecificJob, dedupKeyFor, enqueueJob, getJob } from "../../lib/factory/queue";
import { runJobNow } from "../../lib/factory/orchestrator";
import { raccogli, type ClientPlaces } from "../../lib/collector/collect";
import { diagnosticaDatabase } from "../../lib/collector/diagnostica";
import { DirectHtmlProvider, type BrowserWorkerProvider, type PaginaRaccolta } from "../../lib/collector/browser";
import type { EsitoPlaces, PlacesScheda } from "../../lib/collector/places";

// ============================================================
// Il ciclo di vita completo, su un database VERO.
//
// `@libsql/client` parla anche a un file locale, quindi qui gira lo
// stesso client, lo stesso schema e le stesse query dell'applicazione:
// cambia solo che l'URL e `file:` invece che remoto. Non e un mock del
// database, e un database.
//
// Quello che si verifica e la catena che nei test unitari non si vede:
// enqueue -> claim atomico -> running -> completed, dossier e manifest
// salvati e riletti, idempotenza del claim, e il fatto che un job di
// un altro lead non venga rubato.
// ============================================================

const db = createClient({ url: process.env.TURSO_DATABASE_URL as string });

const numeroJob = async (): Promise<number> => {
  const rs = await db.execute("select count(*) as n from agent_jobs");
  return Number((rs.rows[0] as Record<string, unknown>).n);
};

const LEAD = "lead-e2e-1";
const ALTRO = "lead-e2e-2";

before(async () => {
  await db.executeMultiple(readFileSync("lib/turso/schema.sql", "utf8"));
  // Anche lo schema Autopilot: contiene `wa_messages`, cioe la tabella
  // dei messaggi. Senza, il test «non si scrive nessun messaggio»
  // passerebbe perche la tabella non esiste — cioe non proverebbe niente.
  await db.executeMultiple(readFileSync("lib/autopilot/schema.sql", "utf8"));
  await ensureFactorySchema();
  await ensureCollectorSchema();
  for (const [id, nome] of [[LEAD, "Trattoria di Prova"], [ALTRO, "Altra Attività"]]) {
    await db.execute({
      sql: `insert or replace into leads (id, name, company, phone, status, meta)
            values (?, ?, ?, ?, 'todo', ?)`,
      args: [id, nome, nome, "080 555 0101", JSON.stringify({ city: "Bari", category: "ristorante" })],
    });
  }
});

after(() => { rmSync(DIR_E2E, { recursive: true, force: true }); });

// ----- Diagnostica su un database vero ---------------------------

test("e2e: la diagnostica riconosce un database pronto", async () => {
  const d = await diagnosticaDatabase();
  assert.equal(d.stato, "database_ready", `stato ${d.stato}: ${d.detail}`);
  assert.ok(d.lead >= 2);
  assert.deepEqual(d.tabelle_mancanti, []);
});

// ----- Ciclo di vita del job -------------------------------------

test("e2e: queued -> running -> completed, su coda vera", async () => {
  const accodato = await enqueueJob({
    lead_id: LEAD,
    kind: "collect_business_intelligence",
    reason: "prova end-to-end",
    budget: 2,
  });
  assert.ok(accodato.id);
  assert.equal(accodato.created, true);

  const inCoda = await getJob(accodato.id);
  assert.equal(inCoda?.status, "pending", "appena accodato deve essere pending");
  assert.equal(inCoda?.attempts, 0);

  const esito = await runJobNow(accodato.id);

  // Senza chiave Places la fase Places fallisce, ma il JOB arriva in
  // fondo: un dossier parziale con le lacune dichiarate e un esito
  // valido, non un errore.
  assert.ok(esito.stato === "completed" || esito.stato === "failed",
    `stato inatteso ${esito.stato}: ${esito.error}`);
  assert.equal(esito.lead_id, LEAD, "deve aver lavorato sul lead richiesto");

  const finito = await getJob(accodato.id);
  assert.ok(finito);
  assert.ok(finito.status === "succeeded" || finito.status === "failed",
    `il job deve essere concluso, invece ${finito.status}`);
  assert.equal(finito.attempts, 1, "un claim, un tentativo");
  assert.ok(finito.started_at, "started_at deve essere valorizzato dal claim");
  assert.ok(finito.finished_at, "finished_at deve essere valorizzato dalla chiusura");
});

test("e2e: il claim e idempotente — premere due volte non esegue due volte", async () => {
  const a = await enqueueJob({
    lead_id: LEAD, kind: "analyze_website", reason: "prova idempotenza", budget: 1,
  });
  const primo = await claimSpecificJob(a.id, "worker-1");
  assert.ok(primo, "il primo claim riesce");
  const secondo = await claimSpecificJob(a.id, "worker-2");
  assert.equal(secondo, null, "il secondo claim sullo stesso job non deve riuscire");

  const j = await getJob(a.id);
  assert.equal(j?.worker_id, "worker-1", "il job resta al primo worker");
  assert.equal(j?.attempts, 1, "un solo tentativo, non due");
});

test("e2e: runJobNow non tocca il job di un altro lead", async () => {
  const mio = await enqueueJob({
    lead_id: LEAD, kind: "run_site_qa", reason: "mio", budget: 1, priority: 1,
  });
  const suo = await enqueueJob({
    lead_id: ALTRO, kind: "run_site_qa", reason: "di un altro", budget: 1, priority: 99,
  });

  // `suo` ha priorita molto piu alta: un worker che sceglie per
  // priorita prenderebbe quello. `runJobNow` deve prendere il mio.
  const esito = await runJobNow(mio.id);
  assert.equal(esito.job_id, mio.id);
  assert.equal(esito.lead_id, LEAD);

  const altro = await getJob(suo.id);
  assert.equal(altro?.status, "pending", "il job dell'altro lead non deve essere stato toccato");
  assert.equal(altro?.attempts, 0);
});

test("e2e: FACTORY_PAUSED ferma anche l'esecuzione manuale", async () => {
  const a = await enqueueJob({
    lead_id: LEAD, kind: "prepare_outreach", reason: "prova pausa", budget: 1,
  });
  process.env.FACTORY_PAUSED = "1";
  try {
    const esito = await runJobNow(a.id);
    assert.equal(esito.stato, "paused");
    const j = await getJob(a.id);
    assert.equal(j?.status, "pending", "in pausa il job non viene nemmeno preso");
  } finally {
    delete process.env.FACTORY_PAUSED;
  }
});

// ----- Dossier completo con fonti sostituite ---------------------

const SCHEDA: PlacesScheda = {
  place_id: "PLACE-PROVA-1",
  name: "Trattoria di Prova",
  address: "Via Sparano 10, 70121 Bari BA",
  lat: 41.1216, lng: 16.8695,
  phone: "080 555 0101", phone_international: "+39 080 555 0101",
  website: "https://trattoriadiprova.example/",
  maps_url: "https://maps.google.com/?cid=42",
  category: "Ristorante", types: ["restaurant"],
  rating: 4.4, reviews: 218,
  business_status: "OPERATIONAL",
  hours: ["lunedì: chiuso", "martedì: 12:30–15:00, 19:30–23:00"],
  photos: [{ name: "places/PLACE-PROVA-1/photos/AAA", widthPx: 3000, heightPx: 2000, attributions: ["Mario Rossi"] }],
  summary: "",
};

const placesFinto: ClientPlaces = {
  async dettaglio(): Promise<EsitoPlaces> {
    return { ok: true, scheda: SCHEDA, candidati: [], error: "", calls: 1, ms: 5 };
  },
  async cerca(): Promise<EsitoPlaces> {
    return { ok: true, scheda: null, candidati: [SCHEDA], error: "", calls: 1, ms: 5 };
  },
};

const HTML = `<!doctype html><html lang="it"><head>
<title>Trattoria di Prova — Bari</title>
<meta name="description" content="Cucina pugliese di stagione, sala interna e giardino.">
<meta property="og:image" content="https://trattoriadiprova.example/foto/sala.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Restaurant",
"name":"Trattoria di Prova","telephone":"+39 080 555 0101",
"address":{"@type":"PostalAddress","streetAddress":"Via Sparano 10","addressLocality":"Bari"},
"email":"info@trattoriadiprova.example",
"sameAs":["https://www.instagram.com/trattoriadiprova","https://www.facebook.com/trattoriadiprova"]}</script>
</head><body>
<h1>Trattoria di Prova</h1>
<p>${"Cucina pugliese di stagione, pasta fatta a mano ogni mattina. ".repeat(12)}</p>
<a href="https://www.instagram.com/trattoriadiprova">Instagram</a>
<a href="https://www.facebook.com/trattoriadiprova">Facebook</a>
<img src="/foto/sala.jpg" alt="la sala del locale" width="1800" height="1200">
<img src="/foto/piatto-orecchiette.jpg" alt="orecchiette" width="1600" height="1200">
<img src="/foto/logo.svg" alt="logo">
</body></html>`;

/** Provider a fixture: restituisce l'HTML sopra per il sito ufficiale e
 *  dichiara `browser_required` per i social, che e cio che fa davvero
 *  DirectHtmlProvider su Instagram e Facebook. */
class ProviderFinto implements BrowserWorkerProvider {
  readonly nome = "ProviderFinto";
  readonly esegueJavaScript = false;
  private readonly diretto = new DirectHtmlProvider();
  async apri(url: string): Promise<PaginaRaccolta> {
    if (url.includes("trattoriadiprova.example")) {
      return { url, final_url: url, esito: "ok", status: 200, html: HTML, detail: "", ssrf: "", ms: 3 };
    }
    return this.diretto.apri(url);
  }
}

test("e2e: dossier e manifest completi, salvati e riletti dal database", async () => {
  const { dossier, phases } = await raccogli({
    lead_id: LEAD,
    name: "Trattoria di Prova", city: "Bari", address: "Via Sparano 10",
    phone: "080 555 0101", email: "", website: "", place_id: "PLACE-PROVA-1",
    manual: {}, linked_pages: [], media_forniti: [],
  }, { places: placesFinto, provider: new ProviderFinto() });

  // Le fasi sono andate.
  const ok = phases.filter((p) => p.status === "ok").map((p) => p.phase);
  assert.ok(ok.includes("places"), `places non riuscita: ${JSON.stringify(phases)}`);
  assert.ok(ok.includes("official_site"), "official_site non riuscita");

  // Fatti con provenienza completa.
  const nome = dossier.verified.find((f) => f.field === "name");
  assert.ok(nome, "il nome deve essere un fatto verificato");
  assert.equal(nome?.source_type, "google_places");
  assert.ok(nome && nome.confidence >= 80);
  assert.ok(dossier.place_id === "PLACE-PROVA-1");
  assert.equal(dossier.official_host, "trattoriadiprova.example");

  // I social linkati dal sito sono stati valutati, e non leggibili senza
  // browser: `browser_required`, non «inesistenti».
  assert.ok(dossier.identities.length >= 2, "i due profili linkati vanno valutati");
  for (const c of dossier.identities) {
    assert.notEqual(c.status, "rejected", `${c.candidate_url} non va scartato senza averlo letto`);
  }

  // Media: la foto Places resta provider_rendered, quelle del sito
  // restano in attesa di approvazione, nessuna e approvata.
  const places = dossier.media.candidates.filter((m) => m.rights_status === "provider_rendered");
  assert.equal(places.length, 1, "la foto Places deve esserci, come riferimento");
  assert.equal(places[0].allowed_scope, "preview_only");
  assert.ok(places[0].attribution.includes("Mario Rossi"), "l'attribuzione va conservata");
  const delSito = dossier.media.candidates.filter((m) => m.rights_status === "official_public_pending_approval");
  assert.ok(delSito.length >= 1, "le foto del sito devono entrare come candidate");
  for (const m of delSito) assert.equal(m.allowed_scope, "preview_only");
  assert.deepEqual(dossier.media.approved_ids, [], "nessuna immagine nasce approvata");

  // La raccomandazione non e GO: ci sono profili non letti e media da
  // approvare, e il sistema lo dice invece di tirare a indovinare.
  assert.equal(dossier.recommendation, "REVIEW");
  assert.ok(dossier.recommendation_reasons.length > 0);

  // Salvataggio e rilettura: il giro completo sul database vero.
  await salvaDossier({ dossier, phases, job_id: "job-e2e" });
  const riletto = await leggiDossier(LEAD);
  assert.ok(riletto, "il dossier deve essere rileggibile");
  assert.equal(riletto?.dossier.place_id, "PLACE-PROVA-1");
  assert.equal(riletto?.dossier.media.candidates.length, dossier.media.candidates.length);
  assert.equal(riletto?.recommendation, "REVIEW");
  assert.equal(riletto?.phases.length, phases.length);
});

// ----- Idempotenza dell'accodamento ------------------------------

test("e2e: due richieste CONCORRENTI sullo stesso lead creano UN job solo", async () => {
  const chiave = dedupKeyFor("collect_business_intelligence", ALTRO);
  const prima = await numeroJob();

  // Partono insieme, come due clic ravvicinati o due schede aperte.
  const [a, b] = await Promise.all([
    enqueueJob({ lead_id: ALTRO, kind: "collect_business_intelligence",
      reason: "clic 1", budget: 2, dedup_key: chiave }),
    enqueueJob({ lead_id: ALTRO, kind: "collect_business_intelligence",
      reason: "clic 2", budget: 2, dedup_key: chiave }),
  ]);

  assert.equal(await numeroJob(), prima + 1, "deve esistere un job solo");
  // Entrambe devono avere in mano lo STESSO id, e un id che esiste
  // davvero: prima la seconda riceveva un UUID mai inserito.
  assert.equal(a.id, b.id, "le due richieste devono puntare allo stesso job");
  assert.ok(a.id, "l'id non puo essere vuoto");
  assert.ok(await getJob(a.id), "l'id restituito deve esistere nel database");
  assert.equal([a.created, b.created].filter(Boolean).length, 1,
    "una sola delle due lo ha creato");

  // E una sola esecuzione: la seconda trova il job gia preso.
  const [x, y] = await Promise.all([runJobNow(a.id), runJobNow(b.id)]);
  const eseguiti = [x, y].filter((r) => r.stato === "completed" || r.stato === "failed");
  assert.equal(eseguiti.length, 1, "una sola esecuzione");
  assert.equal([x, y].filter((r) => r.stato === "not_claimed").length, 1,
    "l'altra deve dichiarare di non aver preso niente");

  const j = await getJob(a.id);
  assert.equal(j?.attempts, 1, "un solo tentativo");
});

test("e2e: una raccolta completa e un rilancio parziale sono due richieste diverse", async () => {
  const piena = dedupKeyFor("collect_business_intelligence", LEAD);
  const parziale = dedupKeyFor("collect_business_intelligence", LEAD, ["places"]);
  assert.notEqual(piena, parziale, "ambiti diversi, chiavi diverse");

  // L'ordine dell'ambito non conta: e la stessa richiesta scritta in
  // due modi.
  assert.equal(
    dedupKeyFor("collect_business_intelligence", LEAD, ["media", "places"]),
    dedupKeyFor("collect_business_intelligence", LEAD, ["places", "media"]),
  );
  assert.match(piena, /^collect_business_intelligence:.+:full$/);
});

test("e2e: dopo la chiusura un rilancio esplicito e consentito", async () => {
  const chiave = dedupKeyFor("analyze_website", ALTRO);
  const primo = await enqueueJob({
    lead_id: ALTRO, kind: "analyze_website", reason: "primo giro",
    budget: 1, dedup_key: chiave,
  });
  assert.equal(primo.created, true);

  // Finche e vivo, non se ne crea un altro.
  const durante = await enqueueJob({
    lead_id: ALTRO, kind: "analyze_website", reason: "doppione",
    budget: 1, dedup_key: chiave,
  });
  assert.equal(durante.created, false);
  assert.equal(durante.id, primo.id);

  await runJobNow(primo.id);

  // Chiuso: la chiave si libera e un rilancio esplicito passa.
  const dopo = await enqueueJob({
    lead_id: ALTRO, kind: "analyze_website", reason: "rilancio voluto",
    budget: 1, dedup_key: chiave,
  });
  assert.equal(dopo.created, true, "dopo la chiusura si puo rifare");
  assert.notEqual(dopo.id, primo.id);
});

test("e2e: due POST concorrenti lasciano UNA sola revisione del dossier", async () => {
  const chiave = dedupKeyFor("collect_business_intelligence", LEAD, ["reconcile"]);
  const [a, b] = await Promise.all([
    enqueueJob({ lead_id: LEAD, kind: "collect_business_intelligence",
      reason: "concorrente 1", budget: 2, dedup_key: chiave,
      payload: { solo: ["reconcile"] } }),
    enqueueJob({ lead_id: LEAD, kind: "collect_business_intelligence",
      reason: "concorrente 2", budget: 2, dedup_key: chiave,
      payload: { solo: ["reconcile"] } }),
  ]);
  await Promise.all([runJobNow(a.id), runJobNow(b.id)]);

  // Un lead ha UN dossier corrente: la raccolta successiva sostituisce
  // la precedente, quindi qui deve esserci una riga sola.
  const rs = await db.execute({
    sql: "select count(*) as n from business_dossiers where lead_id = ?",
    args: [LEAD],
  });
  assert.equal(Number((rs.rows[0] as Record<string, unknown>).n), 1,
    "un solo dossier per lead, non uno per clic");
});

// ----- Migrazioni concorrenti ------------------------------------

test("e2e: due avvii concorrenti delle migrazioni non si pestano i piedi", async () => {
  resetFactorySchemaCache();
  resetCollectorSchemaCache();

  // Due processi che partono insieme: e cio che succede quando due
  // lambda si svegliano nello stesso istante.
  const esiti = await Promise.allSettled([
    Promise.all([ensureFactorySchema(), ensureCollectorSchema()]),
    Promise.all([ensureFactorySchema(), ensureCollectorSchema()]),
  ]);
  for (const e of esiti) {
    assert.equal(e.status, "fulfilled",
      `una migrazione concorrente ha fallito: ${e.status === "rejected" ? e.reason : ""}`);
  }

  // Nessun duplicato: le tabelle e gli indici sono uno per nome.
  const tab = await db.execute(
    "select name, count(*) as n from sqlite_master where type in ('table','index') group by name having n > 1",
  );
  assert.equal(tab.rows.length, 0, "nessun oggetto di schema duplicato");

  // E le colonne aggiunte sono una sola ciascuna.
  const col = await db.execute("select name from pragma_table_info('agent_jobs')");
  const nomi = col.rows.map((r) => String((r as Record<string, unknown>).name));
  assert.equal(new Set(nomi).size, nomi.length, "nessuna colonna duplicata");
});

test("e2e: la migrazione inghiotte SOLO duplicate-column, non ogni errore", async () => {
  // Un catch vuoto attorno a un ALTER nasconde anche «no such table» e
  // «syntax error», e la migrazione sembra riuscita mentre non ha fatto
  // niente. Qui si verifica che l'errore riconosciuto sia quello giusto.
  let messaggio = "";
  try {
    await db.execute("alter table agent_jobs add column kind text");
  } catch (e) {
    messaggio = (e as Error).message;
  }
  assert.match(messaggio, /duplicate column/i,
    "e questo il solo errore che la migrazione ha il diritto di ignorare");

  let altro = "";
  try {
    await db.execute("alter table tabella_inesistente add column x text");
  } catch (e) {
    altro = (e as Error).message;
  }
  assert.ok(altro && !/duplicate column/i.test(altro),
    "un errore diverso deve restare distinguibile da duplicate-column");

  // E la migrazione deve RILANCIARE tutto cio che non e previsto: un
  // catch vuoto farebbe sembrare riuscita una migrazione che non ha
  // fatto niente, e il difetto uscirebbe mesi dopo.
  const sorgente = readFileSync("lib/factory/db.ts", "utf8");
  assert.match(sorgente, /if \(!previsto\) throw e;/,
    "il catch delle migrazioni deve rilanciare gli errori non previsti");
});

// ----- Nessun outreach ------------------------------------------

test("e2e: la raccolta non accoda NIENTE, quindi non puo portare a un contatto", async () => {
  const numero = async (sql: string) => {
    const rs = await db.execute(sql);
    return Number((rs.rows[0] as Record<string, unknown>).n);
  };
  const prima = await numero("select count(*) as n from agent_jobs");
  // Si misura la DIFFERENZA, non il totale: altri test di questo file
  // accodano job apposta, e contarli sarebbe contare le proprie tracce.
  const outreachPrima = await numero(
    "select count(*) as n from agent_jobs where kind = 'prepare_outreach'",
  );

  const a = await enqueueJob({
    lead_id: LEAD, kind: "collect_business_intelligence",
    reason: "prova assenza outreach", budget: 2,
    idempotent: false,
  });
  await runJobNow(a.id);

  const dopo = await numero("select count(*) as n from agent_jobs");
  assert.equal(dopo, prima + 1,
    "la raccolta deve aggiungere solo il proprio job: se ne comparissero altri, la catena porterebbe a prepare_outreach");

  const outreachDopo = await numero(
    "select count(*) as n from agent_jobs where kind = 'prepare_outreach'",
  );
  assert.equal(outreachDopo, outreachPrima,
    "la raccolta non deve accodare nessun prepare_outreach");
});

test("e2e: la raccolta non scrive messaggi da nessuna parte", async () => {
  // wa_messages e la tabella dei messaggi. Se la raccolta ne scrivesse
  // uno, sarebbe un contatto preparato senza che nessuno l'abbia chiesto.
  const rs = await db.execute("select count(*) as n from wa_messages");
  assert.equal(Number((rs.rows[0] as Record<string, unknown>).n), 0,
    "nessun messaggio scritto in wa_messages");

  const att = await db.execute({
    sql: `select count(*) as n from activities
           where lead_id = ? and type in ('whatsapp','email','call')`,
    args: [LEAD],
  });
  assert.equal(Number((att.rows[0] as Record<string, unknown>).n), 0,
    "nessuna attivita di contatto deve comparire in timeline");

  // Le attivita che la raccolta SCRIVE sono di tipo `research` e `note`:
  // registrare cosa si e fatto non e contattare nessuno.
  const ricerca = await db.execute({
    sql: "select count(*) as n from activities where lead_id = ? and type = 'research'",
    args: [LEAD],
  });
  assert.ok(Number((ricerca.rows[0] as Record<string, unknown>).n) > 0,
    "la raccolta deve pero lasciare traccia di se in timeline");
});

test("e2e: rilanciare una sola fase non rifa le altre", async () => {
  const { phases } = await raccogli({
    lead_id: LEAD, name: "Trattoria di Prova", city: "Bari", address: "",
    phone: "", email: "", website: "", place_id: "PLACE-PROVA-1",
    manual: {}, linked_pages: [], media_forniti: [],
  }, { places: placesFinto, provider: new ProviderFinto(), solo: ["places"] });

  const perFase = Object.fromEntries(phases.map((p) => [p.phase, p.status]));
  assert.equal(perFase.places, "ok");
  assert.equal(perFase.official_site, "skipped", "non richiesta, quindi saltata");
  assert.equal(perFase.social_discovery, "skipped");
  assert.equal(perFase.media, "skipped");
});
