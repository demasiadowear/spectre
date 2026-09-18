import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EVENTO_LETTURA, EVENTO_RACCOLTA, classificaErrore, riepilogo,
  soloCampiAmmessi, statoDaFasi, statoHttp, type RiepilogoRaccolta,
} from "../../lib/collector/telemetria";
import type {
  BusinessDossier, DossierFact, IdentityCandidate, MediaCandidate, PhaseState,
} from "../../types/dossier";

// ============================================================
// Il log di esito.
//
// Il test che conta non e «i numeri sono giusti»: e che partendo da un
// dossier PIENO di dati reali — nome, telefono, email, indirizzo, URL
// del sito, profili social, foto — nella riga di log non ne finisca
// nemmeno un frammento.
//
// Per questo il dossier di prova qui sotto e volutamente carico di
// stringhe riconoscibili: se una di quelle compare nell'uscita, il
// test lo dice.
// ============================================================

const SEGRETI = [
  "Trattoria Da Michele",
  "michele.esposito@trattoria-esempio.it",
  "+39 080 555 0101",
  "0805550101",
  "Via Sparano 10",
  "70121 Bari",
  "trattoria-esempio.it",
  "https://trattoria-esempio.it/foto/sala.jpg",
  "instagram.com/trattoriadamichele",
  "ChIJxxxxxxxxxxxxxxxxxxxx",
  "Mario Rossi",
  "sk-chiave-segretissima-1234567890",
  "eyJhbGciOiJIUzI1NiJ9.token.finto",
];

const fatto = (field: string, value: string): DossierFact => ({
  field, value, source: "google_places", source_type: "google_places",
  source_url: "https://maps.google.com/?cid=1", method: "places_details",
  extraction_method: "places_details", observed_at: "2026-09-18T06:53:06Z",
  band: "verified", confidence: 90, evidence: value,
  conflict_group: field, usage_scope: "public", status: "proposed",
});

const profilo = (url: string, status: IdentityCandidate["status"]): IdentityCandidate => ({
  candidate_url: url, platform: "instagram", confidence: 70,
  positive_signals: ["declared_username"], negative_signals: [],
  status, rationale: `profilo ${url}`, discovered_via: "official_site",
});

const foto = (url: string): MediaCandidate => ({
  id: "m1", source_url: url, source_page: "https://trattoria-esempio.it/",
  platform: "website", copyright_owner: "Trattoria Da Michele",
  attribution: "Mario Rossi", observed_at: "2026-09-18T06:53:06Z",
  sha256: "abc", perceptual_hash: "def", width: 1600, height: 1200,
  format: "jpg", filesize: 1, orientation: "landscape",
  probable_role: "venue", quality_score: 80, relevance_score: 80,
  duplicate_group: "g1", people_present: false,
  rights_status: "official_public_pending_approval",
  allowed_scope: "preview_only", expires_at: "", provider_reference: "",
  rejected_reason: "",
});

const DOSSIER: BusinessDossier = {
  dossier_version: 1,
  lead_id: "lead-42",
  generated_at: "2026-09-18T06:53:06Z",
  place_id: "ChIJxxxxxxxxxxxxxxxxxxxx",
  official_site: "https://trattoria-esempio.it/",
  official_host: "trattoria-esempio.it",
  verified: [
    fatto("name", "Trattoria Da Michele"),
    fatto("phone", "+39 080 555 0101"),
    fatto("address", "Via Sparano 10, 70121 Bari"),
    fatto("email", "michele.esposito@trattoria-esempio.it"),
  ],
  probable: [fatto("category", "Ristorante")],
  conflicts: [
    {
      field: "phone", conflict_group: "phone",
      kept: { value: "+39 080 555 0101", source_type: "google_places", confidence: 90 },
      others: [{ value: "0805550101", source_type: "site_structured", confidence: 88 }],
      blocking: true,
    },
    {
      field: "category", conflict_group: "category",
      kept: { value: "Ristorante", source_type: "google_places", confidence: 90 },
      others: [{ value: "Trattoria", source_type: "site_structured", confidence: 88 }],
      blocking: false,
    },
  ],
  missing: ["services"],
  identities: [
    profilo("https://instagram.com/trattoriadamichele", "verified"),
    profilo("https://facebook.com/trattoriadamichele", "browser_required"),
    profilo("https://tiktok.com/@altro", "ambiguous"),
  ],
  media: {
    lead_id: "lead-42", generated_at: "2026-09-18T06:53:06Z",
    candidates: [foto("https://trattoria-esempio.it/foto/sala.jpg")],
    approved_ids: ["m1"],
    rejected: [{ source_url: "https://cdn-esempio.it/x.jpg", reason: "provenienza ignota" }],
    by_rights: {
      customer_owned: 0, official_public_pending_approval: 1,
      provider_rendered: 0, unknown: 0, forbidden: 1,
    },
  },
  sources: [
    { source_type: "google_places", url: "https://maps.google.com/?cid=1", ok: true, outcome: "ok", detail: "Trattoria Da Michele", ms: 300 },
    { source_type: "official_site", url: "https://trattoria-esempio.it/", ok: true, outcome: "ok", detail: "", ms: 800 },
  ],
  recommendation: "REVIEW",
  recommendation_reasons: ["conflitto su phone", "1 profilo non letto"],
  cost: { external_calls: 4, total_ms: 4900 },
};

const FASI: PhaseState[] = [
  { phase: "places", status: "ok", detail: "", ms: 300 },
  { phase: "official_site", status: "ok", detail: "", ms: 800 },
  { phase: "social_discovery", status: "ok", detail: "", ms: 2000 },
  { phase: "media", status: "ok", detail: "", ms: 100 },
  { phase: "reconcile", status: "ok", detail: "", ms: 0 },
];

const riga = (r: RiepilogoRaccolta): string => JSON.stringify(soloCampiAmmessi(r));

// ----- Il test che conta -----------------------------------------

test("telemetria: nessun dato personale nella riga di log", () => {
  const r = riepilogo(DOSSIER, FASI, {
    job_id: "job-1", lead_id: "lead-42", status: "completed", duration_ms: 4900,
  });
  const testo = riga(r);

  for (const s of SEGRETI) {
    assert.ok(!testo.includes(s), `«${s}» e finito nel log`);
  }
  // E nemmeno frammenti: nessuna @, nessun +39, nessun http.
  assert.ok(!testo.includes("@"), "una email o una chiocciola e uscita");
  assert.ok(!/https?:\/\//.test(testo), "un URL e uscito");
  assert.ok(!/\+?\d{6,}/.test(testo), "una sequenza lunga di cifre e uscita");
  assert.ok(!/\.(it|com|org|net)\b/.test(testo), "un dominio e uscito");
});

test("telemetria: la lista bianca esclude i campi aggiunti per sbaglio", () => {
  const r = riepilogo(DOSSIER, FASI, {
    job_id: "job-1", lead_id: "lead-42", status: "completed", duration_ms: 1,
  });
  // Qualcuno aggiunge un campo al riepilogo senza pensarci: non deve
  // uscire, perche la lista e bianca e non nera.
  const sporco = { ...r, nome_attivita: "Trattoria Da Michele", sito: "https://x.it" };
  const testo = JSON.stringify(soloCampiAmmessi(sporco as RiepilogoRaccolta));
  assert.ok(!testo.includes("Trattoria"), "un campo estraneo e passato");
  assert.ok(!testo.includes("nome_attivita"));
  assert.ok(!testo.includes("sito"));
});

test("telemetria: i numeri sono quelli del dossier", () => {
  const r = riepilogo(DOSSIER, FASI, {
    job_id: "job-1", lead_id: "lead-42", status: "completed", duration_ms: 4900,
  });
  assert.equal(r.event, EVENTO_RACCOLTA);
  assert.equal(r.status, "completed");
  assert.equal(r.recommendation, "REVIEW");
  assert.equal(r.duration_ms, 4900);
  assert.equal(r.verified_facts_count, 4);
  assert.equal(r.conflicts_count, 2);
  assert.equal(r.blocking_conflicts_count, 1);
  assert.equal(r.media_candidates_count, 1);
  assert.equal(r.media_approved_count, 1);
  assert.equal(r.social_confirmed_count, 1);
  assert.equal(r.social_browser_required_count, 1);
  assert.equal(r.error_code, "");
  assert.equal(r.error_phase, "");
  assert.deepEqual(r.phase_statuses, {
    places: "ok", official_site: "ok", social_discovery: "ok",
    media: "ok", reconcile: "ok",
  });
});

test("telemetria: senza dossier il riepilogo esce comunque, a zero", () => {
  const r = riepilogo(null, [{ phase: "places", status: "failed", detail: "GOOGLE_PLACES_API_KEY non configurata", ms: 5 }], {
    job_id: "job-2", lead_id: "lead-42", status: "failed", duration_ms: 12,
  });
  assert.equal(r.status, "failed");
  assert.equal(r.recommendation, "");
  assert.equal(r.verified_facts_count, 0);
  assert.equal(r.error_code, "places_not_configured");
  assert.equal(r.error_phase, "places");
});

test("telemetria: l'evento di lettura usa lo stesso schema", () => {
  const r = riepilogo(DOSSIER, FASI, {
    job_id: "job-1", lead_id: "lead-42", status: "completed", duration_ms: 4900,
  }, EVENTO_LETTURA);
  assert.equal(r.event, EVENTO_LETTURA);
  assert.equal(r.verified_facts_count, 4);
  assert.ok(!riga(r).includes("Trattoria"));
});

// ----- Classificazione degli errori ------------------------------

test("telemetria: il codice d'errore non contiene mai il dettaglio", () => {
  // Il dettaglio di una fase fallita contiene quasi sempre l'URL che ha
  // fallito, cioe il sito del prospect: per questo si classifica.
  const dettaglio = "https://trattoria-esempio.it/ non raggiungibile: ETIMEDOUT";
  const r = riepilogo(null, [{ phase: "official_site", status: "failed", detail: dettaglio, ms: 9 }], {
    job_id: "j", lead_id: "l", status: "failed", duration_ms: 9,
  });
  assert.equal(r.error_code, "site_unreachable");
  const testo = riga(r);
  assert.ok(!testo.includes("trattoria-esempio"), "l'host e uscito dal dettaglio");
  assert.ok(!testo.includes("ETIMEDOUT"));
});

test("telemetria: ogni causa ha un codice chiuso", () => {
  assert.equal(classificaErrore("places", "GOOGLE_PLACES_API_KEY non configurata"), "places_not_configured");
  assert.equal(classificaErrore("places", "corrispondenza non sicura: omonimi"), "places_no_match");
  assert.equal(classificaErrore("places", "Places Details HTTP 500"), "places_unavailable");
  assert.equal(classificaErrore("official_site", "nessun sito ufficiale dichiarato"), "site_not_declared");
  assert.equal(classificaErrore("official_site", "HTTP 403"), "site_blocked");
  assert.equal(classificaErrore("official_site", "serve un browser vero"), "browser_required");
  assert.equal(classificaErrore("official_site", "ECONNREFUSED"), "site_unreachable");
  assert.equal(classificaErrore("media", "qualcosa di inatteso"), "internal_error");
});

// ----- Esito del job contro esito delle fasi ---------------------

test("stato: una fase fallita su cinque resta un job COMPLETATO", () => {
  // E il caso reale visto in produzione: un'attivita senza sito web.
  // Places riesce, il sito no, e il dossier c'e lo stesso. Segnarlo
  // «failed» farebbe suonare l'allarme per il caso piu comune del
  // mestiere.
  const fasi: PhaseState[] = [
    { phase: "places", status: "ok", detail: "", ms: 270 },
    { phase: "official_site", status: "failed", detail: "nessun sito ufficiale dichiarato", ms: 0 },
    { phase: "social_discovery", status: "ok", detail: "", ms: 1 },
    { phase: "media", status: "ok", detail: "", ms: 2 },
    { phase: "reconcile", status: "ok", detail: "", ms: 0 },
  ];
  assert.equal(statoDaFasi(fasi), "completed");

  // E la parzialita resta leggibile dove deve stare.
  const r = riepilogo(null, fasi, {
    job_id: "j", lead_id: "l", status: statoDaFasi(fasi), duration_ms: 274,
  }, EVENTO_LETTURA);
  assert.equal(r.status, "completed");
  assert.equal(r.error_code, "site_not_declared");
  assert.equal(r.error_phase, "official_site");
  assert.equal(r.phase_statuses.official_site, "failed");
});

test("stato: se NESSUNA fase riesce, il job e fallito davvero", () => {
  assert.equal(statoDaFasi([
    { phase: "places", status: "failed", detail: "x", ms: 1 },
    { phase: "official_site", status: "failed", detail: "y", ms: 1 },
  ]), "failed");
});

test("stato: le fasi saltate non contano in nessuna direzione", () => {
  // Un rilancio parziale esegue una fase sola: se quella riesce, il
  // job e riuscito, anche se le altre quattro sono `skipped`.
  assert.equal(statoDaFasi([
    { phase: "places", status: "ok", detail: "", ms: 1 },
    { phase: "official_site", status: "skipped", detail: "", ms: 0 },
    { phase: "media", status: "skipped", detail: "", ms: 0 },
  ]), "completed");
  // E se l'unica eseguita fallisce, fallisce il job.
  assert.equal(statoDaFasi([
    { phase: "places", status: "failed", detail: "x", ms: 1 },
    { phase: "official_site", status: "skipped", detail: "", ms: 0 },
  ]), "failed");
  // Nessuna fase eseguita: non c'e niente da dichiarare riuscito.
  assert.equal(statoDaFasi([{ phase: "places", status: "skipped", detail: "", ms: 0 }]), "failed");
  assert.equal(statoDaFasi([]), "failed");
});

// ----- Semantica HTTP --------------------------------------------

test("http: completed e sempre 200, qualunque sia la raccomandazione", () => {
  assert.equal(statoHttp("completed", ""), 200);
});

test("http: un job gia in corso e 202, non un errore", () => {
  assert.equal(statoHttp("not_claimed", "job_not_claimed"), 202);
});

test("http: runtime non disponibile e 503", () => {
  assert.equal(statoHttp("paused", "factory_paused"), 503);
  assert.equal(statoHttp("no_db", "database_unavailable"), 503);
  assert.equal(statoHttp("failed", "places_not_configured"), 503,
    "una chiave mancante e configurazione, non un guasto");
  assert.equal(statoHttp("failed", "database_unavailable"), 503);
});

test("http: una dipendenza esterna che fallisce e 424, non 500", () => {
  for (const c of ["places_unavailable", "places_no_match", "site_unreachable", "site_blocked", "browser_required"] as const) {
    assert.equal(statoHttp("failed", c), 424, `${c} deve essere 424`);
  }
});

test("http: un conflitto sullo stato del job e 409", () => {
  assert.equal(statoHttp("failed", "job_not_claimed"), 409);
});

test("http: l'inatteso e 500, e nessun caso produce 502", () => {
  assert.equal(statoHttp("failed", "internal_error"), 500);
  assert.equal(statoHttp("failed", ""), 500);
  const codici = ["", "places_not_configured", "places_no_match", "places_unavailable",
    "site_not_declared", "site_unreachable", "site_blocked", "browser_required",
    "database_unavailable", "job_not_claimed", "factory_paused", "internal_error"] as const;
  for (const stato of ["completed", "failed", "not_claimed", "paused", "no_db"]) {
    for (const c of codici) {
      assert.notEqual(statoHttp(stato, c), 502, `${stato}/${c} non deve produrre 502`);
    }
  }
});
