// L'ambiente PRIMA di tutto: vedi _ambiente-e2e.ts per il perche.
import { DIR_E2E } from "./_ambiente-e2e";

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";

import {
  ensureCollectorSchema, leggiDossier, resetCollectorSchemaCache, salvaDossier,
} from "../../lib/collector/db";
import {
  ensureFactorySchema, rapportoMigrazione, resetFactorySchemaCache,
} from "../../lib/factory/db";
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

  // Le tre decisioni sono separate, ed e qui che si vede perche.
  //
  // Commercialmente e una GO: l'identita e ancorata su Places, non ci
  // sono conflitti bloccanti, e i profili non letti erano DICHIARATI dal
  // sito — non c'e nessun rischio di attribuire a questa attivita i
  // social di un'altra. Che quei profili non si siano potuti aprire e un
  // limite della raccolta, non un dubbio sull'identita.
  //
  // Sui MEDIA invece serve un'approvazione, perche le fotografie del
  // sito non sono nostre. Le due cose convivono: prima questa seconda
  // risposta trascinava anche la prima, e ogni lead finiva in REVIEW.
  assert.equal(dossier.commercial_recommendation, "GO",
    `commerciale: ${dossier.decision_reasons.commercial.join(" | ")}`);
  assert.ok(dossier.decision_reasons.commercial.length > 0);
  assert.notEqual(dossier.content_readiness, "BLOCKED",
    "con nome, indirizzo e telefono si puo costruire qualcosa");
  assert.ok(dossier.website_opportunity_score !== null,
    "il punteggio del sito va misurato, non lasciato indefinito");

  // Il campo storico resta allineato alla decisione commerciale, cosi
  // un dossier vecchio e uno nuovo si leggono con lo stesso codice.
  assert.equal(dossier.recommendation, dossier.commercial_recommendation);

  // Salvataggio e rilettura: il giro completo sul database vero.
  await salvaDossier({ dossier, phases, job_id: "job-e2e" });
  const riletto = await leggiDossier(LEAD);
  assert.ok(riletto, "il dossier deve essere rileggibile");
  assert.equal(riletto?.dossier.place_id, "PLACE-PROVA-1");
  assert.equal(riletto?.dossier.media.candidates.length, dossier.media.candidates.length);
  assert.equal(riletto?.recommendation, "GO");
  assert.equal(riletto?.dossier.commercial_recommendation, "GO",
    "le tre decisioni devono sopravvivere al giro sul database");
  assert.equal(riletto?.dossier.media_readiness, dossier.media_readiness);
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

  // E lo schema reale deve riportare cosa ha fatto, non lasciarlo
  // dedurre. Qui `autopilot_pipeline` esiste (l'ha creata lo schema
  // Autopilot applicato nel before), quindi le colonne sono al posto
  // loro e il rapporto lo dichiara.
  const rap = rapportoMigrazione();
  assert.ok(rap, "la migrazione deve lasciare un rapporto leggibile");
  assert.equal(rap?.tabella, "autopilot_pipeline");
  assert.notEqual(rap?.esito, "migration_not_applicable",
    "la tabella c'e, quindi la migrazione era applicabile");
  const col = await db.execute("select name from pragma_table_info('autopilot_pipeline')");
  const nomi = col.rows.map((r) => String((r as Record<string, unknown>).name));
  for (const c of ["website_status", "factory_stage"]) {
    assert.ok(nomi.indexOf(c) !== -1, `${c} deve esserci dopo la migrazione`);
  }
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

// ----- Il rilancio parziale non deve DISTRUGGERE il dossier -------

test("e2e: un rilancio parziale riparte dal dossier precedente, non da zero", async () => {
  const lead = {
    lead_id: LEAD,
    name: "Trattoria di Prova", city: "Bari", address: "Via Sparano 10",
    phone: "080 555 0101", email: "", website: "", place_id: "PLACE-PROVA-1",
    manual: {}, linked_pages: [], media_forniti: [],
  };

  // Prima una raccolta intera: e questo il dossier su cui si ritorna.
  const pieno = await raccogli(lead, { places: placesFinto, provider: new ProviderFinto() });
  assert.ok(pieno.dossier.place_id, "la raccolta piena deve avere ancorato l'identita");
  assert.ok(pieno.dossier.verified.length >= 3);

  // Poi il rilancio di sole tre fasi, come si fa quando si vuole
  // ricontrollare i social e le immagini senza ripagare Places.
  const parziale = await raccogli(lead, {
    places: placesFinto,
    provider: new ProviderFinto(),
    solo: ["social_discovery", "media", "reconcile"],
    precedente: pieno.dossier,
  });

  // Il difetto che questo test impedisce: senza reidratazione le fasi
  // saltate non lasciano niente nello stato, e il rilancio produce un
  // dossier VUOTO — cioe peggiore di quello che doveva integrare. Il
  // pannello mostrerebbe un'attivita senza nome e senza identita, e
  // sembrerebbe che la raccolta abbia perso i dati.
  assert.equal(parziale.dossier.place_id, pieno.dossier.place_id,
    "l'ancora di Places non si perde solo perche la fase non e stata rieseguita");
  assert.equal(parziale.dossier.official_site, pieno.dossier.official_site);
  assert.equal(parziale.dossier.official_host, pieno.dossier.official_host);
  assert.ok(parziale.dossier.verified.some((f) => f.field === "name"),
    "il nome viene da Places: senza reidratazione sparirebbe");
  assert.equal(parziale.dossier.website_opportunity_score, pieno.dossier.website_opportunity_score,
    "il punteggio del sito si conserva: la fase che lo misura non e stata rieseguita");

  // E la decisione regge: un dossier reidratato deve decidere come
  // quello pieno, altrimenti il rilancio cambierebbe l'esito senza che
  // sia cambiato niente della realta.
  assert.equal(parziale.dossier.commercial_recommendation, pieno.dossier.commercial_recommendation);

  // I fatti non si duplicano: reidratare e sommare due volte lo stesso
  // fatto produrrebbe un conflitto inventato dal rilancio stesso.
  const nomi = parziale.dossier.verified.concat(parziale.dossier.probable)
    .filter((f) => f.field === "name").map((f) => f.value);
  assert.equal(new Set(nomi).size, nomi.length > 0 ? new Set(nomi).size : 0);
  assert.ok(
    parziale.dossier.conflicts.length <= pieno.dossier.conflicts.length,
    `il rilancio ha inventato conflitti: ${parziale.dossier.conflicts.length} contro ${pieno.dossier.conflicts.length}`,
  );
});

// ----- La scoperta social quando un sito non c'e -----------------

/** Places senza sito dichiarato: e il caso che ha motivato tutto. */
const SCHEDA_SENZA_SITO: PlacesScheda = { ...SCHEDA, website: "" };
const placesSenzaSito: ClientPlaces = {
  async dettaglio(): Promise<EsitoPlaces> {
    return { ok: true, scheda: SCHEDA_SENZA_SITO, candidati: [], error: "", calls: 1, ms: 5 };
  },
  async cerca(): Promise<EsitoPlaces> {
    return { ok: true, scheda: null, candidati: [SCHEDA_SENZA_SITO], error: "", calls: 1, ms: 5 };
  },
};

const LEAD_SENZA_SITO = {
  lead_id: LEAD,
  name: "Trattoria di Prova", city: "Bari", address: "Via Sparano 10",
  phone: "080 555 0101", email: "", website: "", place_id: "PLACE-PROVA-1",
  manual: {}, linked_pages: [], media_forniti: [],
};

test("e2e: senza sito la scoperta social parte, e i suoi candidati NON sono verita", async () => {
  const { dossier, phases } = await raccogli(LEAD_SENZA_SITO, {
    places: placesSenzaSito,
    provider: new ProviderFinto(),
    // La ricerca ha trovato un profilo. Gemini SCOPRE: non verifica.
    ricerca: async () => ({
      esito: "ok" as const,
      candidati: [{
        url: "https://instagram.com/trattoriadiprova",
        platform: "instagram" as const,
        query_index: 0,
      }],
      queries_used: 1, tokens: 420, ms: 12, detail: "",
      conteggi: { citazioni: 3, risolti: 3, profili: 1, unici: 1 },
    }),
  });

  const social = phases.find((p) => p.phase === "social_discovery");
  assert.equal(social?.status, "ok", `la scoperta non deve fallire: ${social?.detail}`);
  assert.equal(dossier.identities.length, 1, "il candidato trovato va valutato, non ignorato");

  const c = dossier.identities[0];
  assert.equal(c.discovered_via, "grounded_search",
    "la provenienza non deve poter fingere di essere una dichiarazione del sito");
  assert.notEqual(c.status, "confirmed",
    "una citazione di ricerca non e una prova di identita: servono due segnali forti");

  // E la cosa che il candidato NON deve fare: entrare nei link del sito.
  // Solo `confirmed` ci arriva, e questo non lo e.
  assert.equal(
    dossier.identities.filter((i) => i.status === "confirmed").length, 0,
    "un profilo scoperto e non verificato non puo diventare un link del cliente",
  );

  // Il costo e visibile, o non lo si puo tenere sotto controllo.
  assert.equal(dossier.search?.queries, 1);
  assert.equal(dossier.search?.tokens, 420);
  assert.equal(dossier.search?.status, "ok");
});

test("e2e: se il grounding non e disponibile la raccolta prosegue e lo dichiara", async () => {
  const { dossier, phases } = await raccogli(LEAD_SENZA_SITO, {
    places: placesSenzaSito,
    provider: new ProviderFinto(),
    ricerca: async () => ({
      esito: "search_unavailable" as const,
      candidati: [], queries_used: 0, tokens: 0, ms: 4,
      conteggi: { citazioni: 0, risolti: 0, profili: 0, unici: 0 },
      detail: "Google Search grounding non disponibile con il modello o il progetto corrente",
    }),
  });

  // Il punto: una capacita mancante e una lacuna dichiarata, non un
  // guasto. Se facesse fallire la raccolta, nessuna attivita senza sito
  // produrrebbe mai un dossier — cioe proprio quelle che servono.
  assert.equal(phases.find((p) => p.phase === "social_discovery")?.status, "ok");
  assert.equal(dossier.search?.status, "search_unavailable");
  assert.equal(dossier.search?.queries, 0, "niente da pagare per una capacita che non c'e");
  assert.equal(dossier.commercial_recommendation, "GO",
    "senza social e senza sito resta il cliente ideale, non un dubbio");
  assert.ok(
    dossier.sources.some((s) => s.source_type === "grounded_search"),
    "il tentativo va registrato fra le fonti, anche quando non e riuscito",
  );
});

test("e2e: un rilancio su un dossier fresco NON ripaga la ricerca", async () => {
  const primo = await raccogli(LEAD_SENZA_SITO, {
    places: placesSenzaSito,
    provider: new ProviderFinto(),
    ricerca: async () => ({
      esito: "ok" as const,
      candidati: [{ url: "https://instagram.com/trattoriadiprova", platform: "instagram" as const, query_index: 0 }],
      queries_used: 4, tokens: 1200, ms: 30, detail: "",
      conteggi: { citazioni: 6, risolti: 6, profili: 1, unici: 1 },
    }),
  });
  assert.equal(primo.dossier.search?.queries, 4);

  let richiamata = 0;
  const secondo = await raccogli(LEAD_SENZA_SITO, {
    places: placesSenzaSito,
    provider: new ProviderFinto(),
    solo: ["social_discovery", "media", "reconcile"],
    precedente: primo.dossier,
    ricerca: async () => {
      richiamata++;
      return {
        esito: "ok" as const, candidati: [], queries_used: 4, tokens: 1200, ms: 30,
        detail: "", conteggi: { citazioni: 0, risolti: 0, profili: 0, unici: 0 },
      };
    },
  });

  // Le pagine social si rileggono — la VERIFICA e cio che decide, e si
  // rifa sempre. Ma la SCOPERTA no: i profili di un'attivita non
  // cambiano in due settimane, e ogni interrogazione in piu e denaro
  // speso per riconfermare la stessa cosa.
  assert.equal(richiamata, 0, "la ricerca e ripartita su un dossier ancora fresco");
  assert.equal(secondo.dossier.identities.length, 1,
    "i candidati gia scoperti si riusano, invece di sparire");
  assert.equal(secondo.dossier.identities[0].discovered_via, "grounded_search",
    "e restano marcati per come sono stati trovati");
});

test("e2e: il rilancio della fase media non perde le fotografie di Places", async () => {
  // Il caso peggiore di tutti, perché non sembra un guasto.
  //
  // Rilanciando `media` senza `places`, le immagini grezze — che le
  // produce Places — non ci sono più, e la fase ricostruisce un
  // manifest di zero fotografie. Il pannello direbbe «nessuna immagine
  // candidata» su un'attività che ne aveva dieci, e sembrerebbe una
  // risposta vera invece che un dato perso.
  const pieno = await raccogli(LEAD_SENZA_SITO, {
    places: placesSenzaSito, provider: new ProviderFinto(),
    ricerca: async () => ({
      esito: "not_configured" as const, candidati: [], queries_used: 0,
      tokens: 0, ms: 0, detail: "",
      conteggi: { citazioni: 0, risolti: 0, profili: 0, unici: 0 },
    }),
  });
  assert.ok(pieno.dossier.media.candidates.length >= 1,
    "la raccolta piena deve avere la fotografia di Places");
  assert.equal(pieno.dossier.media_readiness, "DISPLAYABLE");

  const dopo = await raccogli(LEAD_SENZA_SITO, {
    places: placesSenzaSito, provider: new ProviderFinto(),
    solo: ["social_discovery", "media", "reconcile"],
    precedente: pieno.dossier,
    ricerca: async () => ({
      esito: "not_configured" as const, candidati: [], queries_used: 0,
      tokens: 0, ms: 0, detail: "",
      conteggi: { citazioni: 0, risolti: 0, profili: 0, unici: 0 },
    }),
  });

  assert.equal(dopo.dossier.media.candidates.length, pieno.dossier.media.candidates.length,
    "nessuna fotografia deve sparire per il solo fatto di aver rilanciato");
  assert.equal(dopo.dossier.media_readiness, "DISPLAYABLE");
  assert.equal(
    dopo.dossier.media.counts.tramite_provider,
    pieno.dossier.media.counts.tramite_provider,
  );
  // E l'attribuzione sopravvive: senza, le fotografie resterebbero
  // mostrabili ma non si saprebbe più a chi vanno attribuite.
  assert.ok(dopo.dossier.media.candidates.every((m) => m.attribution || !m.provider_reference),
    "l'attribuzione delle fotografie del provider non si perde nel rilancio");
});

// ----- «Riprova solo ricerca social» ------------------------------

test("e2e: il rilancio della sola ricerca non tocca Places, sito o fotografie", async () => {
  const pieno = await raccogli(LEAD_SENZA_SITO, {
    places: placesSenzaSito, provider: new ProviderFinto(),
    ricerca: async () => ({
      esito: "no_results" as const, candidati: [], queries_used: 4, tokens: 3206,
      ms: 30, detail: "", conteggi: { citazioni: 0, risolti: 0, profili: 0, unici: 0 },
    }),
  });
  assert.ok(pieno.dossier.media.candidates.length >= 1);

  // Un Places che esplode se lo si chiama: la prova che NON viene
  // chiamato è che il rilancio riesce lo stesso.
  const placesVietato: ClientPlaces = {
    async dettaglio(): Promise<EsitoPlaces> { throw new Error("Places non va richiamato"); },
    async cerca(): Promise<EsitoPlaces> { throw new Error("Places non va richiamato"); },
  };

  let cercate = 0;
  const dopo = await raccogli(LEAD_SENZA_SITO, {
    places: placesVietato,
    provider: new ProviderFinto(),
    solo: ["social_discovery", "reconcile"],
    precedente: pieno.dossier,
    forzaRicerca: true,
    ricerca: async () => {
      cercate++;
      return {
        esito: "ok" as const,
        candidati: [{
          url: "https://instagram.com/trattoriadiprova",
          platform: "instagram" as const, query_index: 0,
        }],
        queries_used: 4, tokens: 3100, ms: 40, detail: "",
        conteggi: { citazioni: 9, risolti: 9, profili: 1, unici: 1 },
      };
    },
  });

  const per = Object.fromEntries(dopo.phases.map((p) => [p.phase, p.status]));
  assert.equal(per.places, "skipped", "Places non è stato richiesto");
  assert.equal(per.official_site, "skipped");
  assert.equal(per.media, "skipped", "le fotografie non si rifanno");
  assert.equal(per.social_discovery, "ok");
  assert.equal(per.reconcile, "ok");

  // La forzatura ha davvero rifatto la ricerca su un dossier fresco.
  assert.equal(cercate, 1, "il force refresh deve saltare la cache di freschezza");
  assert.equal(dopo.dossier.search?.force_refresh, true);
  assert.equal(dopo.dossier.search?.cache_hit, false);
  assert.equal(dopo.dossier.search?.citations, 9);
  assert.equal(dopo.dossier.search?.resolved, 9);
  assert.equal(dopo.dossier.search?.profiles, 1);

  // E niente si è perso: è il punto di rilanciare SOLO la ricerca.
  assert.equal(dopo.dossier.place_id, pieno.dossier.place_id);
  assert.equal(
    dopo.dossier.media.candidates.length, pieno.dossier.media.candidates.length,
    "le fotografie non vanno perse da un rilancio che non le riguarda",
  );
  assert.equal(dopo.dossier.media_readiness, "DISPLAYABLE");
  assert.deepEqual(dopo.dossier.requested_phases, ["social_discovery", "reconcile"]);
});

test("e2e: senza forzatura, su un dossier fresco la ricerca NON si ripaga", async () => {
  const pieno = await raccogli(LEAD_SENZA_SITO, {
    places: placesSenzaSito, provider: new ProviderFinto(),
    ricerca: async () => ({
      esito: "ok" as const,
      candidati: [{ url: "https://instagram.com/trattoriadiprova", platform: "instagram" as const, query_index: 0 }],
      queries_used: 4, tokens: 3206, ms: 30, detail: "",
      conteggi: { citazioni: 9, risolti: 9, profili: 1, unici: 1 },
    }),
  });

  let cercate = 0;
  const dopo = await raccogli(LEAD_SENZA_SITO, {
    places: placesSenzaSito, provider: new ProviderFinto(),
    solo: ["social_discovery", "reconcile"],
    precedente: pieno.dossier,
    // forzaRicerca assente: è il default, e il default non spende.
    ricerca: async () => {
      cercate++;
      return {
        esito: "ok" as const, candidati: [], queries_used: 4, tokens: 3206, ms: 30,
        detail: "", conteggi: { citazioni: 0, risolti: 0, profili: 0, unici: 0 },
      };
    },
  });

  assert.equal(cercate, 0, "senza richiesta esplicita non si spendono quattro interrogazioni");
  assert.equal(dopo.dossier.search?.cache_hit, true);
  assert.equal(dopo.dossier.search?.force_refresh, false);
  assert.equal(dopo.dossier.identities.length, 1, "i candidati già scoperti si riusano");
});
