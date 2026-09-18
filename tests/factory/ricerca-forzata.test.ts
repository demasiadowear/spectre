import assert from "node:assert/strict";
import { test } from "node:test";

import { ricercaForzataAmmessa } from "../../lib/factory/orchestrator";
import { esitoRicerca, riepilogo, soloCampiAmmessi } from "../../lib/collector/telemetria";
import { MAX_QUERY_PER_LEAD } from "../../types/dossier";
import type { BusinessDossier, PhaseState } from "../../types/dossier";

// ============================================================
// Il rifacimento forzato della ricerca social, e come si legge.
//
// Due difetti concreti stanno dietro a questo file.
//
// Il primo: al rilancio reale ho creduto fosse partito il rilancio
// mirato, e invece era partita la raccolta completa. Me ne sono accorto
// solo perche `places` diceva `ok` invece di `skipped` — cioe per caso.
// `requested_phases` e `executed_phases` tolgono di mezzo il caso.
//
// Il secondo: la ricerca costa. Rifarla deve essere una decisione di
// una persona, e la garanzia non puo essere «nessun percorso
// automatico scrive quel campo»: dev'essere che scriverlo non basta.
// ============================================================

// ----- Chi puo forzare ---------------------------------------------

test("forzatura: serve la marca dell'operatore, non basta il campo", () => {
  // Il caso che conta: un job accodato da un percorso automatico che
  // per qualunque motivo portasse `force_search` non deve poter
  // spendere quattro interrogazioni.
  assert.equal(ricercaForzataAmmessa({ force_search: true }), false,
    "senza origine dichiarata non si spende niente");
  assert.equal(ricercaForzataAmmessa({ force_search: true, origine: "cron" }), false);
  assert.equal(ricercaForzataAmmessa({ force_search: true, origine: "worker" }), false);
  assert.equal(ricercaForzataAmmessa({ origine: "operator" }), false,
    "la marca da sola non e una richiesta");
  assert.equal(ricercaForzataAmmessa({}), false);
});

test("forzatura: con la marca dell'operatore si concede", () => {
  assert.equal(ricercaForzataAmmessa({ force_search: true, origine: "operator" }), true);
});

test("forzatura: nessuna verita approssimata", () => {
  // `"true"` non e `true`, e `1` nemmeno: un payload che arriva da JSON
  // puo contenere qualunque cosa.
  assert.equal(ricercaForzataAmmessa({ force_search: "true", origine: "operator" }), false);
  assert.equal(ricercaForzataAmmessa({ force_search: 1, origine: "operator" }), false);
});

test("forzatura: il tetto resta quattro, ovunque lo si legga", () => {
  assert.equal(MAX_QUERY_PER_LEAD, 4);
});

// ----- Come si legge l'esito ---------------------------------------

const dossierCon = (
  search: BusinessDossier["search"],
  identities: BusinessDossier["identities"] = [],
): BusinessDossier => ({ search, identities } as unknown as BusinessDossier);

const confermato = {
  candidate_url: "https://instagram.com/x", platform: "instagram" as const,
  confidence: 90, positive_signals: [], negative_signals: [],
  status: "confirmed" as const, rationale: "", discovered_via: "grounded_search" as const,
};

test("esito: ogni anello della catena si rompe in modo riconoscibile", () => {
  const casi: [BusinessDossier["search"], number, string][] = [
    // Google Search non ha trovato fonti.
    [{ status: "no_results", queries: 4, tokens: 3206, citations: 0, resolved: 0, profiles: 0 }, 0, "no_sources"],
    // Ha citato, ma i reindirizzamenti non si sono risolti: e il guasto
    // silenzioso, quello che senza questi numeri sembrerebbe «non ha
    // trovato niente».
    [{ status: "no_results", queries: 4, tokens: 3206, citations: 7, resolved: 0, profiles: 0 }, 0, "redirects_broken"],
    // Fonti trovate, ma nessuna era un profilo social.
    [{ status: "no_results", queries: 4, tokens: 3206, citations: 7, resolved: 7, profiles: 0 }, 0, "sources_not_social"],
    // Profili candidati, identita non verificata.
    [{ status: "ok", queries: 4, tokens: 3206, citations: 7, resolved: 7, profiles: 2 }, 0, "candidates_unverified"],
    // Riuscita end-to-end.
    [{ status: "ok", queries: 4, tokens: 3206, citations: 7, resolved: 7, profiles: 2 }, 1, "confirmed"],
    // Il grounding non c'e: e un'altra cosa ancora.
    [{ status: "search_unavailable", queries: 0, tokens: 0 }, 0, "search_unavailable"],
    // Nessuna chiave: la ricerca non e stata tentata.
    [{ status: "not_configured", queries: 0, tokens: 0 }, 0, ""],
  ];
  for (const [search, confermati, atteso] of casi) {
    assert.equal(
      esitoRicerca(dossierCon(search), confermati), atteso,
      `citations=${search?.citations} resolved=${search?.resolved} profiles=${search?.profiles} confirmed=${confermati}`,
    );
  }
});

test("esito: senza ricerca non si inventa un esito", () => {
  assert.equal(esitoRicerca(null, 0), "");
  assert.equal(esitoRicerca(dossierCon(undefined), 0), "");
});

// ----- Completa o parziale, senza ambiguita ------------------------

const FASI_PARZIALI: PhaseState[] = [
  { phase: "places", status: "skipped", detail: "", ms: 0 },
  { phase: "official_site", status: "skipped", detail: "", ms: 0 },
  { phase: "social_discovery", status: "ok", detail: "", ms: 900 },
  { phase: "media", status: "skipped", detail: "", ms: 0 },
  { phase: "reconcile", status: "ok", detail: "", ms: 2 },
];

test("telemetria: una raccolta completa e un rilancio mirato non si confondono", () => {
  const d = dossierCon(
    { status: "ok", queries: 4, tokens: 3206, citations: 7, resolved: 7, profiles: 2,
      cache_hit: false, force_refresh: true },
    [confermato],
  );
  (d as { requested_phases?: string[] }).requested_phases = ["social_discovery", "reconcile"];

  const r = riepilogo(d, FASI_PARZIALI, {
    job_id: "j", lead_id: "l", status: "completed", duration_ms: 900,
  });

  assert.equal(r.requested_phases, "social_discovery+reconcile");
  assert.equal(r.executed_phases, "social_discovery+reconcile");
  assert.equal(r.search_force_refresh, true);
  assert.equal(r.search_cache_hit, false);
  assert.equal(r.search_outcome, "confirmed");
  assert.equal(r.search_queries, 4);
  assert.equal(r.search_citations, 7);
  assert.equal(r.search_resolved, 7);
  assert.equal(r.search_profiles, 2);
});

test("telemetria: su un dossier vecchio le fasi chieste si deducono, non si inventano", () => {
  // Nessun `requested_phases` salvato: si ricava da cio che non e stato
  // saltato. E un ripiego dichiarato, non la fonte.
  const d = dossierCon({ status: "", queries: 0, tokens: 0 });
  const r = riepilogo(d, FASI_PARZIALI, {
    job_id: "j", lead_id: "l", status: "completed", duration_ms: 1,
  });
  assert.equal(r.requested_phases, "social_discovery+reconcile");
  assert.equal(r.search_outcome, "");
  assert.equal(r.search_force_refresh, false);
});

// ----- La lista bianca non deve inghiottire in silenzio -------------

test("telemetria: ogni campo del riepilogo esce davvero nella riga di log", () => {
  // La lista bianca serve a impedire che un campo nuovo del dossier
  // finisca nei log per distrazione. Ma taglia anche i campi che si
  // VOLEVANO nei log e che ci si e dimenticati di aggiungere — e
  // quello non si vede: i numeri si calcolano, la riga esce, e
  // semplicemente non li contiene.
  //
  // E successo con i cinque conteggi social: calcolati, filtrati via,
  // e me ne sono accorto rileggendo la lista a mano.
  const d = dossierCon(
    { status: "ok", queries: 4, tokens: 2368, citations: 13, resolved: 13, profiles: 4,
      cache_hit: false, force_refresh: true },
    [confermato],
  );
  const r = riepilogo(d, FASI_PARZIALI, {
    job_id: "j", lead_id: "l", status: "completed", duration_ms: 1,
  });
  const riga = JSON.parse(JSON.stringify(soloCampiAmmessi(r))) as Record<string, unknown>;

  for (const k of Object.keys(r)) {
    assert.ok(k in riga, `«${k}» si calcola ma non esce: manca dalla lista bianca`);
  }
});
