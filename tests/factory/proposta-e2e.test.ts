// L'ambiente PRIMA di tutto: vedi _ambiente-e2e.ts per il perche.
import { DIR_E2E } from "./_ambiente-e2e";

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { rmSync } from "node:fs";
import { createClient } from "@libsql/client";

import {
  ensureCollectorSchema, resetCollectorSchemaCache, salvaDossier,
} from "../../lib/collector/db";
import {
  ensureFactorySchema, getProject, resetFactorySchemaCache,
} from "../../lib/factory/db";
import {
  approvaSeAncoraValida, ensureProposteSchema, leggiProposta, leggiPubblicata,
  nuovaRevisioneProposta, resetProposteSchemaCache, rifiutaProposta,
  rilasciaAnalisi, rivendicaAnalisi, salvaProposta, salvaPubblicata,
} from "../../lib/demo/proposte-db";
import { analizzaProgetto } from "../../lib/demo/analisi-progetto";
import {
  componiSpec, risolviSpec, statoPubblicazione,
} from "../../lib/demo/pubblicazione";
import {
  revisioniNonEsplicite, selectionBasisRevision, validaProposta, type SceltaFoto,
} from "../../lib/demo/curatela";
import { fotoMostrabili } from "../../lib/demo/foto";
import { messaggioValidazione } from "../../lib/demo/messaggi";
import { componiIdentita } from "../../lib/collector/brand";
import {
  httpAnalisi, httpApprovazione, scriviHeroMancante,
} from "../../lib/demo/telemetria-proposta";
import { CAMPI_SEMANTICI } from "../../lib/demo/policy-media";
import {
  ANALYZER_VERSION, COMPOSER_VERSION, PROMPT_VERSION,
} from "../../lib/demo/versioni";
import type {
  BusinessDossier, FontiBrand, MediaCandidate,
} from "../../types/dossier";

// ============================================================
// Il ciclo «analizza → proponi → approva → pubblica», su un database
// VERO.
//
// `@libsql/client` parla anche a un file locale: stesso client, stesso
// schema, stesse query. Quello che si verifica qui non si vede nei
// test unitari, perche vive nelle condizioni di corsa e nelle UPDATE
// condizionate:
//
//   - il lucchetto regge due click contemporanei;
//   - l'idempotenza guarda il manifest e non l'esistenza della riga;
//   - l'approvazione su una base cambiata NON passa;
//   - la pubblicazione precedente sopravvive a tutto cio che fallisce.
//
// Il modello e la ricerca sono iniettati: qui si prova la macchina, non
// Gemini. Cio che NON e iniettato e il database.
// ============================================================

const db = createClient({ url: process.env.TURSO_DATABASE_URL as string });

const LEAD = "lead-proposta-e2e";

let projectId = "";
let slug = "";

// ----- Materiale -----------------------------------------------------

const foto = (id: string, attribuzione = "Rosita Buonsante"): MediaCandidate => ({
  id, source_url: "", source_page: "", platform: "google_maps",
  copyright_owner: "", attribution: attribuzione, observed_at: "", sha256: "",
  perceptual_hash: "", width: 1200, height: 1600, format: "", filesize: 0,
  orientation: "portrait", probable_role: "unknown", quality_score: 90,
  relevance_score: 80, duplicate_group: "", people_present: false,
  rights_status: "provider_rendered", allowed_scope: "preview_only",
  display_status: "display_allowed_with_attribution", storage_status: "do_not_store",
  expires_at: "", provider_reference: `places/P/photos/${id}`, rejected_reason: "",
});

const dossierCon = (candidates: MediaCandidate[]): BusinessDossier => ({
  dossier_version: 1, lead_id: LEAD, generated_at: new Date().toISOString(),
  place_id: "ChIJprova", official_site: "", official_host: "",
  verified: [{
    field: "name", value: "Collateral Beauty di Rosita Buonsante",
    source_type: "google_places", extraction_method: "places_details",
    source_url: "", evidence: "", confidence: 95, band: "verified",
    usage_scope: "public", observed_at: "",
  }],
  probable: [], conflicts: [], missing: [], identities: [],
  media: {
    lead_id: LEAD, generated_at: "", candidates, approved_ids: [], rejected: [],
    by_rights: {} as never, counts: {} as never,
  },
  sources: [], commercial_recommendation: "GO", social_readiness: "NONE",
  content_readiness: "PARTIAL", media_readiness: "DISPLAYABLE",
  decision_reasons: { commercial: [], content: [], media: [], social: [] },
  website_opportunity_score: 90, recommendation: "GO", recommendation_reasons: [],
  cost: { external_calls: 0, total_ms: 0 },
} as unknown as BusinessDossier);

async function scrivi(candidates: MediaCandidate[]): Promise<void> {
  await salvaDossier({ dossier: dossierCon(candidates), phases: [] });
}

/** Un'analisi finta che sceglie le prime `n` fotografie. Non chiama
 *  niente: qui si prova il giro, non il modello. */
const analisiFinta = (n: number) => async (lotto: readonly { candidate_id: string }[]) => ({
  scelte: lotto.map((f, i): SceltaFoto => ({
    candidate_id: f.candidate_id,
    order: i < n ? i : 999,
    layout_role: (i === 0 ? "hero" : "detail") as SceltaFoto["layout_role"],
    object_position: "50% 30%",
    stato: (i < n ? "selected" : "not_selected") as SceltaFoto["stato"],
  })),
  da_rivedere: [],
  costo: { richieste: lotto.length, analizzate: lotto.length, fallite: 0, token: 120, ms: 5 },
  modello: "finto",
  esito: "ok" as const,
  guasto: null,
});

const marchioTrovatoNiente = async () => ({
  identita: componiIdentita([], {
    sito_ufficiale: "not_applicable", social_confermati: "not_applicable",
    foto_places: "not_applicable", ricerca_grounded: "success_no_results",
  } as FontiBrand),
  fonti: {} as FontiBrand,
  blocco: "" as const,
  costo: { pagine: 0, query: 1, token: 40, ms: 3 },
});

const opzioni = (n = 3, extra: Record<string, unknown> = {}) => ({
  analizza: analisiFinta(n) as never,
  marchio: marchioTrovatoNiente as never,
  scarica: (async () => ({ base64: "AA==", mime: "image/jpeg" })) as never,
  env: { GOOGLE_PLACES_API_KEY: "finta" } as unknown as NodeJS.ProcessEnv,
  ...extra,
});

async function fotoAttuali() {
  const rs = await db.execute({
    sql: "select dossier from business_dossiers where lead_id = ? limit 1",
    args: [LEAD],
  });
  const d = JSON.parse(String((rs.rows[0] as Record<string, unknown>).dossier)) as BusinessDossier;
  return fotoMostrabili(d, slug);
}

// ----- Preparazione ---------------------------------------------------

before(async () => {
  resetCollectorSchemaCache();
  resetFactorySchemaCache();
  resetProposteSchemaCache();
  await ensureCollectorSchema();
  await ensureFactorySchema();
  await ensureProposteSchema();

  slug = "AAAAAAAAAAAAAAAAAAAAAA";
  projectId = "proj-proposta-e2e";
  await db.execute({
    sql: `insert into forge_projects (id, lead_id, slug, stage, template, spec)
          values (?, ?, ?, 'ready', 'dossier-di-lato', '')`,
    args: [projectId, LEAD, slug],
  });
  await scrivi([foto("a"), foto("b"), foto("c"), foto("d")]);
});

after(() => {
  db.close();
  rmSync(DIR_E2E, { recursive: true, force: true });
});

// ----- 1. Analisi -> proposta ----------------------------------------

test("e2e: l'analisi produce una proposta salvata e rileggibile", async () => {
  const r = await analizzaProgetto(projectId, opzioni(3));
  assert.equal(r.esito, "completata", JSON.stringify(r));
  assert.equal(httpAnalisi(r.esito), 200);

  const salvata = await leggiProposta(projectId);
  assert.ok(salvata, "la proposta deve essere sul database");
  assert.equal(salvata.curatela.scelte.filter((s) => s.stato === "selected").length, 3);
  assert.equal(salvata.curatela.manifest_revision, "a|b|c|d");
  assert.ok(salvata.curatela.basis_revision.length > 0, "la base deve esserci");
  // L'analisi non approva: e una proposta, non una decisione.
  assert.equal(salvata.approvata_il, "");
  assert.equal(salvata.in_corso_da, "", "il lucchetto va rilasciato");
});

test("e2e: sul disco non finisce nessun campo semantico", async () => {
  const rs = await db.execute({
    sql: "select scelte, da_rivedere from demo_proposte where project_id = ?",
    args: [projectId],
  });
  const riga = JSON.stringify(rs.rows[0]);
  for (const campo of CAMPI_SEMANTICI) {
    assert.ok(!riga.includes(campo), `«${campo}» non deve esistere sul disco: ${riga}`);
  }
});

// ----- 2. Due click, una analisi sola --------------------------------

test("e2e: due comandi contemporanei producono UNA sola analisi", async () => {
  // Il primo prende il lucchetto e lo tiene finche non ha finito. Il
  // secondo non aspetta e non riesegue: dice che e gia in corso.
  const primo = rivendicaAnalisi(projectId, LEAD);
  const secondo = rivendicaAnalisi(projectId, LEAD);
  const [a, b] = await Promise.all([primo, secondo]);
  assert.equal(a && b, false, "due rivendicazioni non possono riuscire entrambe");
  assert.ok(a || b, "almeno una deve riuscire");

  // Con il lucchetto preso, il comando risponde 202 e non spende.
  const r = await analizzaProgetto(projectId, opzioni(3, { refresh: true }));
  assert.equal(r.esito, "gia_in_corso");
  assert.equal(httpAnalisi(r.esito), 202);
  assert.equal(r.costo.analizzate, 0, "un 202 non deve aver analizzato niente");

  await rilasciaAnalisi(projectId);
});

// ----- 4. Manifest riordinato: nessun costo nuovo --------------------

test("e2e: riordinare le stesse fotografie non ripaga l'analisi", async () => {
  // Places restituisce le stesse quattro immagini in un altro ordine.
  // `manifest_revision` e costruita sulle identita, quindi cambia solo
  // se cambia l'insieme — non se cambia la posizione.
  //
  // NOTA: l'ordine del manifest cambia gli INDICI, e quindi gli URL
  // delle fotografie. Cio che non cambia e la decisione: la proposta
  // resta valida e non si rispende.
  const prima = await leggiProposta(projectId);
  await scrivi([foto("a"), foto("b"), foto("c"), foto("d")]);

  const r = await analizzaProgetto(projectId, opzioni(3));
  assert.equal(r.esito, "invariata");
  assert.equal(httpAnalisi(r.esito), 200);
  assert.equal(r.costo.analizzate, 0, "non deve aver riletto nessuna immagine");
  assert.equal(r.costo.token, 0, "non deve aver speso token");

  const dopo = await leggiProposta(projectId);
  assert.equal(dopo?.curatela.basis_revision, prima?.curatela.basis_revision);
});

// ----- 5. Fotografie nuove: segnalano, non bloccano ------------------

test("e2e: una fotografia nuova rende la proposta «outdated», non «stale»", async () => {
  await scrivi([foto("a"), foto("b"), foto("c"), foto("d"), foto("e")]);
  const c = (await leggiProposta(projectId))!.curatela;
  const v = validaProposta(c, await fotoAttuali());

  assert.equal(v.stato, "valida");
  assert.equal(v.stato === "valida" && v.outdated, true);
  assert.equal(v.stato === "valida" && v.nuove, 1);

  const m = messaggioValidazione(v, c);
  assert.equal(m.bloccante, false, "materiale nuovo non blocca l'approvazione");
  assert.match(m.testo, /fotografia nuova/i);
});

// ----- 3. Approvazione valida -> nuova revisione pubblicata ----------

test("e2e: un'approvazione valida pubblica una revisione nuova", async () => {
  const c = (await leggiProposta(projectId))!.curatela;
  const attuali = await fotoAttuali();
  const scelte = c.scelte.filter((s) => s.stato === "selected");
  const base = selectionBasisRevision(c.scelte, attuali);
  assert.equal(base, c.basis_revision, "la base non deve essere cambiata");

  const revisione = nuovaRevisioneProposta();
  const ok = await approvaSeAncoraValida(projectId, {
    basis_attesa: c.basis_revision,
    scelte: c.scelte,
    basis_nuova: base,
    proposal_revision: revisione,
  });
  assert.equal(ok, true, "l'approvazione su una base intatta deve passare");

  const spec = componiSpec(
    { ...c, basis_revision: base, proposal_revision: revisione },
    "tipografia", "NOT_FOUND",
  );
  await salvaPubblicata(projectId, LEAD, spec);

  const letta = await leggiPubblicata(projectId);
  assert.equal(letta?.proposal_revision, revisione);
  assert.equal(letta?.foto.length, scelte.length);
  assert.equal(letta?.foto[0].layout_role, "hero");
  // Nessun indice nella spec: solo identita.
  assert.ok(!JSON.stringify(letta).includes('"indice"'), "la spec non deve contenere indici");

  const salvata = await leggiProposta(projectId);
  assert.ok(salvata!.approvata_il, "l'approvazione deve essere registrata");
});

test("e2e: la stessa approvazione due volte non passa la seconda", async () => {
  const c = (await leggiProposta(projectId))!.curatela;
  // La base, dopo l'approvazione, e quella nuova: riapprovare con
  // quella VECCHIA e esattamente il caso della seconda scheda aperta.
  const ok = await approvaSeAncoraValida(projectId, {
    basis_attesa: "base-che-non-esiste-piu",
    scelte: c.scelte,
    basis_nuova: c.basis_revision,
    proposal_revision: nuovaRevisioneProposta(),
  });
  assert.equal(ok, false);
  assert.equal(httpApprovazione("concorrenza"), 409);
});

// ----- 9. NOT_FOUND: trattamento tipografico, e si pubblica ----------

test("e2e: NOT_FOUND sul marchio non blocca, e non si chiama logo", async () => {
  const spec = await leggiPubblicata(projectId);
  assert.equal(spec?.brand_status, "NOT_FOUND");
  assert.equal(spec?.uso_marchio, "tipografia");
  // `tipografia` NON e `logo_originale`: la pagina non deve poter
  // chiamare logo il nome disegnato bene.
  assert.notEqual(spec?.uso_marchio, "logo_originale");
});

// ----- 6. Apertura sparita fra analisi e approvazione -> 409 ---------

test("e2e: se l'apertura sparisce fra analisi e approvazione, non si approva", async () => {
  const c = (await leggiProposta(projectId))!.curatela;
  const hero = c.scelte.find((s) => s.layout_role === "hero" && s.stato === "selected")!;

  // Places non restituisce piu quella fotografia.
  const restanti = ["a", "b", "c", "d", "e"].filter((x) => x !== hero.candidate_id);
  await scrivi(restanti.map((x) => foto(x)));

  const attuali = await fotoAttuali();
  const v = validaProposta(c, attuali);
  assert.equal(v.stato, "stale");
  assert.equal(v.stato === "stale" && v.motivo, "foto_scomparsa");

  const m = messaggioValidazione(v, c);
  assert.equal(m.bloccante, true);
  assert.match(m.testo, /apertura non è più disponibile/i);
  assert.equal(httpApprovazione("stale"), 409);

  // E il controllo atomico non passa nemmeno se qualcuno provasse.
  const base = selectionBasisRevision(c.scelte, attuali);
  assert.notEqual(base, c.basis_revision, "la base deve essere cambiata");
});

// ----- 11. La demo precedente resta viva ------------------------------

test("e2e: una pubblicazione mancata non tocca quella che regge", async () => {
  // Nessuno ha scritto `demo_pubblicazioni` dopo l'approvazione andata
  // male: cio che e online e ancora la revisione di prima.
  const spec = await leggiPubblicata(projectId);
  assert.ok(spec, "la revisione precedente deve essere ancora li");

  // E la pagina si compone comunque: la fotografia sparita viene
  // SALTATA, non sostituita.
  const attuali = await fotoAttuali();
  const r = risolviSpec(spec, attuali);
  assert.equal(r.apertura_mancante, true, "l'apertura manca e si dice");
  assert.equal(r.mancanti.length, 1);
  assert.ok(
    r.foto.every((f) => f.layout_role !== "hero"),
    "nessuna fotografia deve essere promossa ad apertura al posto di quella sparita",
  );
});

// ----- 7 e 8. transient -> RETRY_REQUIRED, permanent -> BLOCKED ------

test("e2e: un guasto ritentabile diventa RETRY_REQUIRED, non NOT_FOUND", async () => {
  const b = componiIdentita([], {
    sito_ufficiale: "not_applicable", social_confermati: "not_applicable",
    foto_places: "not_applicable", ricerca_grounded: "transient_error",
  });
  assert.equal(b.brand_status, "RETRY_REQUIRED");
  // Non entra nella revisione umana: non c'e niente da decidere.
  assert.equal(b.requires_operator_approval, false);
  assert.equal(httpApprovazione("marchio_non_risolto"), 409);
});

test("e2e: un guasto permanente diventa BLOCKED, e si pubblica il rimedio", async () => {
  const marchioBloccato = async () => ({
    identita: componiIdentita([], {
      sito_ufficiale: "not_applicable", social_confermati: "not_applicable",
      foto_places: "not_applicable", ricerca_grounded: "permanent_error",
    } as FontiBrand),
    fonti: {} as FontiBrand,
    blocco: "configuration_missing" as const,
    costo: { pagine: 0, query: 0, token: 0, ms: 1 },
  });

  await scrivi([foto("a"), foto("b"), foto("c"), foto("d")]);
  const r = await analizzaProgetto(projectId, opzioni(3, {
    refresh: true, marchio: marchioBloccato as never,
  }));

  assert.equal(r.esito, "bloccata");
  assert.equal(httpAnalisi(r.esito), 503);
  assert.equal(r.blocco, "configuration_missing");
  assert.equal(r.brand.status, "BLOCKED");
  assert.ok(r.rimedio.length > 0, "un blocco deve dire cosa fare");
  // Il rimedio non nomina variabili ne valori.
  assert.ok(!/GEMINI|API_KEY|GOOGLE_/.test(r.rimedio), `il rimedio non deve nominare variabili: ${r.rimedio}`);

  // BLOCKED non pubblica, e quindi non tocca cio che e online.
  assert.equal(httpApprovazione("marchio_bloccato"), 503);
  const spec = await leggiPubblicata(projectId);
  assert.ok(spec, "la demo precedente deve essere ancora online");
});

test("e2e: senza chiave Places l'analisi e bloccata, non «nessuna foto»", async () => {
  const r = await analizzaProgetto(projectId, {
    refresh: true,
    marchio: marchioTrovatoNiente as never,
    env: {} as unknown as NodeJS.ProcessEnv,
  });
  assert.equal(r.esito, "bloccata");
  assert.equal(r.blocco, "configuration_missing");
  assert.equal(httpAnalisi(r.esito), 503);
});

// ----- 10. Nessun outreach --------------------------------------------

test("e2e: analisi e approvazione non mandano niente a nessuno", async () => {
  const conta = async (tabella: string): Promise<number> => {
    try {
      const rs = await db.execute(`select count(*) as n from ${tabella}`);
      return Number((rs.rows[0] as Record<string, unknown>).n);
    } catch {
      // La tabella non esiste in questo database: zero e la risposta
      // giusta, e vale come prova quanto una tabella vuota.
      return 0;
    }
  };
  for (const t of ["outreach_messages", "outreach_queue", "followups"]) {
    assert.equal(await conta(t), 0, `${t} non deve avere righe`);
  }

  // E lo stage del progetto non si muove: pubblicare una demo non e
  // averla mandata.
  const p = await getProject(projectId);
  assert.equal(p?.stage, "ready");
});

// ----- Rifiuto ---------------------------------------------------------

test("e2e: il rifiuto registra la decisione e lascia online cio che c'e", async () => {
  const prima = await leggiPubblicata(projectId);
  const c = (await leggiProposta(projectId))!.curatela;

  const ok = await rifiutaProposta(projectId, c.basis_revision);
  assert.equal(ok, true);

  const dopo = await leggiProposta(projectId);
  assert.equal(
    dopo!.curatela.scelte.filter((s) => s.stato === "selected").length, 0,
    "dopo un rifiuto non resta niente di selezionato",
  );
  assert.equal(dopo!.approvata_il, "", "l'approvazione precedente e revocata");

  const online = await leggiPubblicata(projectId);
  assert.equal(online?.proposal_revision, prima?.proposal_revision,
    "il rifiuto non tocca la pagina online");
});

// ----- La pubblicazione degradata --------------------------------------
//
// Cosa fa la pagina quando una fotografia PUBBLICATA non c'e piu. Sta
// qui e non fra i test di resa perche le due cose che contano — che la
// demo resti raggiungibile e che NON parta nessuna analisi — si vedono
// solo sul database.

test("e2e: una demo degradata resta disponibile e non fa partire nessuna analisi", async () => {
  // Stato dichiarato, non ereditato dai test precedenti.
  await scrivi([foto("g1"), foto("g2"), foto("g3")]);
  const revisione = nuovaRevisioneProposta();
  await salvaPubblicata(projectId, LEAD, {
    proposal_revision: revisione,
    basis_revision: "base-nota",
    hero_status: "OK",
    foto: [
      { candidate_id: "g1", order: 0, layout_role: "hero", object_position: "50% 30%" },
      { candidate_id: "g2", order: 1, layout_role: "treatment", object_position: "50% 50%" },
      { candidate_id: "g3", order: 2, layout_role: "interior", object_position: "50% 50%" },
    ],
    brand_status: "NOT_FOUND",
    uso_marchio: "tipografia",
    pubblicata_il: new Date().toISOString(),
  });

  const primaDellaVisita = await leggiProposta(projectId);

  // Places non serve piu l'apertura.
  await scrivi([foto("g2"), foto("g3")]);
  const attuali = await fotoAttuali();
  const spec = await leggiPubblicata(projectId);

  // Questo e esattamente cio che fa la pagina: legge, risolve, e basta.
  const r = risolviSpec(spec, attuali);
  assert.equal(r.apertura_mancante, true);
  assert.equal(r.stato, "degraded");
  assert.equal(statoPubblicazione(spec, attuali), "degraded");
  // Raggiungibile: la pagina ha ancora due fotografie e tutti i fatti.
  assert.equal(r.foto.length, 2);
  assert.ok(r.foto.every((f) => f.layout_role !== "hero"));

  // E NIENTE e partito. Una pagina pubblica che innesca una fase a
  // pagamento e un modo di far spendere a chiunque abbia lo slug.
  const dopoLaVisita = await leggiProposta(projectId);
  assert.equal(dopoLaVisita?.in_corso_da, "", "nessun lucchetto preso");
  assert.deepEqual(dopoLaVisita?.costo, primaDellaVisita?.costo, "nessun costo nuovo");
  assert.equal(
    dopoLaVisita?.curatela.manifest_revision,
    primaDellaVisita?.curatela.manifest_revision,
    "la proposta non e stata ricalcolata da sola",
  );
});

test("e2e: la revisione pubblicata sopravvive alla visita degradata", async () => {
  // Nessuno l'ha riscritta, nessuno l'ha cancellata: cio che e stato
  // approvato resta cio che e stato approvato, anche mentre una delle
  // sue fotografie non e servibile.
  const spec = await leggiPubblicata(projectId);
  assert.ok(spec);
  assert.equal(spec.foto.length, 3, "la spec conserva anche la foto sparita");
  assert.equal(spec.foto[0].candidate_id, "g1");

  // Se la fotografia ricompare, la pagina torna intera da sola.
  await scrivi([foto("g1"), foto("g2"), foto("g3")]);
  const r = risolviSpec(spec, await fotoAttuali());
  assert.equal(r.stato, "ok");
  assert.equal(r.apertura_mancante, false);
  assert.equal(r.foto[0].layout_role, "hero");
});

test("e2e: la riga di telemetria della hero mancante non contiene dati personali", async () => {
  const righe: string[] = [];
  const vero = console.log;
  // eslint-disable-next-line no-console
  console.log = (...a: unknown[]) => { righe.push(String(a[0])); };
  try {
    scriviHeroMancante({
      project_id: projectId, lead_id: LEAD,
      proposal_revision: "rev-abc", foto_in_pagina: 2, foto_mancanti: 1,
    });
  } finally {
    // eslint-disable-next-line no-console
    console.log = vero;
  }

  assert.equal(righe.length, 1, "una riga sola, JSON");
  const riga = righe[0];
  const j = JSON.parse(riga) as Record<string, unknown>;
  assert.equal(j.event, "published_hero_unavailable");
  assert.equal(j.stato_pubblicazione, "degraded");
  assert.equal(j.apertura_testuale, true);
  assert.equal(j.foto_mancanti, 1);

  // Cio che NON ci deve essere: il nome di chi ha scattato, il
  // riferimento del provider, lo slug — che e la credenziale della demo
  // — e qualunque URL.
  // `http` da solo no: e il nome del campo con il codice di stato.
  for (const proibito of ["Rosita", "Buonsante", "places/", "photos/", slug, "http://", "https://"]) {
    assert.ok(!riga.includes(proibito), `la riga contiene «${proibito}»: ${riga}`);
  }
});

// ----- 7. Le versioni dell'algoritmo -----------------------------------

test("e2e: cambiare composer_version rifa la proposta anche a manifest identico", async () => {
  // Il difetto che questo test esiste per non avere piu: fra una corsa
  // e l'altra e cambiato TRE VOLTE l'algoritmo, e con il manifest fermo
  // l'idempotenza avrebbe restituito il risultato vecchio dicendo
  // «invariata». Cioe: correggo il compositore, e il lead continua a
  // vedere la proposta sbagliata.
  await scrivi([foto("v1"), foto("v2"), foto("v3"), foto("v4")]);
  const prima = await analizzaProgetto(projectId, opzioni(3, { refresh: true }));
  assert.equal(prima.esito, "completata");

  // Stesse fotografie, stesso algoritmo: non si rispende.
  const uguale = await analizzaProgetto(projectId, opzioni(3));
  assert.equal(uguale.esito, "invariata");

  // Stesse fotografie, compositore diverso: si rifa.
  await db.execute({
    sql: "update demo_proposte set composer_version = ? where project_id = ?",
    args: ["c-vecchio", projectId],
  });
  const dopo = await analizzaProgetto(projectId, opzioni(3));
  assert.equal(dopo.esito, "completata", "una versione diversa NON e un cache hit");

  // E lo stesso per le altre due.
  for (const colonna of ["analyzer_version", "prompt_version"]) {
    await db.execute({
      sql: `update demo_proposte set ${colonna} = 'vecchia' where project_id = ?`,
      args: [projectId],
    });
    const r = await analizzaProgetto(projectId, opzioni(3));
    assert.equal(r.esito, "completata", colonna);
  }
});

test("e2e: le versioni finiscono sulla proposta salvata", async () => {
  const p = await leggiProposta(projectId);
  assert.equal(p?.versioni.analyzer_version, ANALYZER_VERSION);
  assert.equal(p?.versioni.prompt_version, PROMPT_VERSION);
  assert.equal(p?.versioni.composer_version, COMPOSER_VERSION);
});

// ----- 4. Una foto in revisione non entra con l'approvazione generale --

test("e2e: una needs_visual_review non entra approvando l'insieme", async () => {
  await scrivi([foto("r1"), foto("r2"), foto("r3"), foto("r4")]);
  // Una proposta con tre scelte e una in revisione.
  await salvaProposta({
    project_id: projectId, lead_id: LEAD,
    curatela: {
      basis_revision: "", manifest_revision: "r1|r2|r3|r4", proposal_revision: "",
      scelte: [
        { candidate_id: "r1", order: 0, layout_role: "hero", object_position: "50% 50%", stato: "selected" },
        { candidate_id: "r2", order: 1, layout_role: "interior", object_position: "50% 50%", stato: "selected" },
        { candidate_id: "r3", order: 2, layout_role: "detail", object_position: "50% 50%", stato: "selected" },
        { candidate_id: "r4", order: 999, layout_role: "detail", object_position: "50% 50%", stato: "needs_visual_review" },
      ],
      da_rivedere: [{ candidate_id: "r4", motivo: "possibile_persona_identificabile" }],
      composta_il: "",
    },
    brand_status: "NOT_FOUND", brand_blocco: "",
    costo: { immagini: 4, token: 0, durata_ms: 0, modello: "finto" },
  });

  const salvata = await leggiProposta(projectId);
  const scelte = salvata!.curatela.scelte;

  // L'invio che include la quarta SENZA averla guardata.
  const senzaRevisione = ["r1", "r2", "r3", "r4"].map((id, i) => ({
    candidate_id: id, order: i, layout_role: "detail" as const,
    object_position: "50% 50%", rivisto: false,
  }));
  assert.deepEqual(
    revisioniNonEsplicite(senzaRevisione, scelte), ["r4"],
    "la fotografia in revisione va nominata, non trascinata dentro con le altre",
  );

  // Lo stesso invio, con l'atto esplicito.
  const conRevisione = senzaRevisione.map((s) => (
    s.candidate_id === "r4" ? { ...s, rivisto: true } : s
  ));
  assert.deepEqual(revisioniNonEsplicite(conRevisione, scelte), []);

  // E le tre gia selezionate non chiedono niente: approvarle e
  // approvare cio che la proposta aveva gia messo in pagina.
  assert.deepEqual(revisioniNonEsplicite(senzaRevisione.slice(0, 3), scelte), []);
});
