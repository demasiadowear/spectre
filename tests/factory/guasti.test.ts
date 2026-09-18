import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classificaGuasto, guastoDaHttp, guastoDiConfigurazione,
} from "../../lib/collector/guasti";
import { componiIdentita, rimedioBlocco } from "../../lib/collector/brand";
import {
  EVENTO_ANALISI, digest, httpAnalisi, httpApprovazione, riepilogoVuoto,
  soloCampiAmmessi,
} from "../../lib/demo/telemetria-proposta";
import type { FontiBrand, MotivoBlocco } from "../../types/dossier";

// ============================================================
// La mappatura `permanent_error -> BLOCKED`.
//
// E la distinzione che decide se un lead ritenta all'infinito una
// chiave che non c'e, oppure viene dichiarato NOT_FOUND perche un
// server ha impiegato un secondo di troppo. Entrambi gli errori sono
// silenziosi: il primo si vede in fattura, il secondo non si vede mai.
// ============================================================

// ----- I casi dichiarati -----------------------------------------------

test("guasti: chiave mancante -> BLOCKED / configuration_missing", () => {
  const g = guastoDiConfigurazione();
  assert.equal(g.esito, "permanent_error");
  assert.equal(g.blocco, "configuration_missing");
});

test("guasti: chiave rifiutata dal provider -> configuration_missing", () => {
  for (const c of [
    { status: 401, testo: "" },
    { status: 400, testo: "API key not valid. Please pass a valid API key." },
    { status: 403, testo: "Requests from this device are not authorized: unauthenticated" },
  ]) {
    const g = guastoDaHttp(c.status, c.testo);
    assert.equal(g.esito, "permanent_error", JSON.stringify(c));
    assert.equal(g.blocco, "configuration_missing", JSON.stringify(c));
  }
});

test("guasti: modello inesistente -> provider_unsupported", () => {
  const g = classificaGuasto(new Error(
    "[404] models/gemini-inventato is not found for API version v1beta",
  ));
  assert.equal(g.esito, "permanent_error");
  assert.equal(g.blocco, "provider_unsupported");
});

test("guasti: richiesta vietata dalla policy -> policy_restricted", () => {
  const g = guastoDaHttp(403, "PERMISSION_DENIED: blocked by safety policy");
  assert.equal(g.esito, "permanent_error");
  assert.equal(g.blocco, "policy_restricted");
});

test("guasti: un timeout resta ritentabile", () => {
  for (const e of [
    new Error("ETIMEDOUT"), new Error("fetch failed"),
    new Error("The operation was aborted due to timeout"),
    { status: 503, message: "model is overloaded" },
    { status: 500, message: "internal" },
  ]) {
    const g = classificaGuasto(e);
    assert.equal(g.esito, "transient_error", JSON.stringify(e));
    assert.equal(g.blocco, "", "un guasto ritentabile non ha un motivo di blocco");
  }
});

test("guasti: 429 e un rate limit, non una quota finita", () => {
  // Due cose che rispondono con lo stesso numero e si risolvono in due
  // modi opposti: aspettare trenta secondi, oppure pagare.
  assert.equal(guastoDaHttp(429, "Too Many Requests").esito, "transient_error");
  const q = guastoDaHttp(429, "You exceeded your current quota, please check your billing");
  assert.equal(q.esito, "permanent_error");
  assert.equal(q.blocco, "quota_exhausted");
});

test("guasti: in dubbio si ritenta, non si blocca", () => {
  // Sbagliare verso il ritentabile costa una chiamata. Sbagliare verso
  // il blocco ferma un lead finche qualcuno non se ne accorge, e
  // nessuno se ne accorge.
  for (const e of [new Error("qualcosa di incomprensibile"), {}, null, undefined, 42]) {
    assert.equal(classificaGuasto(e).esito, "transient_error", JSON.stringify(e));
  }
});

// ----- Il rimedio non dice segreti ------------------------------------

test("guasti: il rimedio dice cosa fare e non nomina variabili ne valori", () => {
  const motivi: MotivoBlocco[] = [
    "configuration_missing", "provider_unsupported", "policy_restricted", "quota_exhausted",
  ];
  for (const m of motivi) {
    const r = rimedioBlocco(m);
    assert.ok(r.length > 10, `«${m}» deve avere un rimedio leggibile`);
    // Il nome di una variabile d'ambiente e meta di un segreto.
    assert.ok(!/[A-Z][A-Z0-9]*_[A-Z0-9_]+/.test(r), `«${m}» nomina una variabile: ${r}`);
    assert.ok(!/gemini|google|vercel_|token|chiave =/i.test(r.replace(/pannello Vercel/i, "")),
      `«${m}» nomina un fornitore o un valore: ${r}`);
  }
  assert.equal(rimedioBlocco(""), "", "nessun blocco, nessun rimedio");
});

// ----- BLOCKED nella composizione dell'identita -----------------------

const FONTI = (r: FontiBrand["ricerca_grounded"]): FontiBrand => ({
  sito_ufficiale: "not_applicable",
  social_confermati: "not_applicable",
  foto_places: "not_applicable",
  ricerca_grounded: r,
});

test("brand: una fonte bloccata produce BLOCKED, non NOT_FOUND", () => {
  const b = componiIdentita([], FONTI("permanent_error"));
  assert.equal(b.brand_status, "BLOCKED");
  // BLOCKED non entra nella revisione umana: non c'e niente da
  // decidere guardando, c'e da aggiungere una credenziale.
  assert.equal(b.requires_operator_approval, false);
});

test("brand: un timeout produce RETRY_REQUIRED e ha la precedenza sul blocco", () => {
  const b = componiIdentita([], {
    ...FONTI("permanent_error"), sito_ufficiale: "transient_error",
  });
  // Prima si riprova cio che si puo riprovare: dichiarare BLOCKED
  // mentre una fonte e ancora ritentabile fa intervenire una persona
  // su un guasto che si sarebbe risolto da solo.
  assert.equal(b.brand_status, "RETRY_REQUIRED");
});

test("brand: zero candidati dopo un'esecuzione valida e NOT_FOUND, e si pubblica", () => {
  const b = componiIdentita([], FONTI("success_no_results"));
  assert.equal(b.brand_status, "NOT_FOUND");
  assert.equal(b.requires_operator_approval, false);
});

// ----- La mappa HTTP ---------------------------------------------------

test("http: nessun 200 con un errore dentro", () => {
  assert.equal(httpAnalisi("completata"), 200);
  assert.equal(httpAnalisi("invariata"), 200);
  assert.equal(httpAnalisi("nessuna_immagine"), 200);
  assert.equal(httpAnalisi("gia_in_corso"), 202);
  assert.equal(httpAnalisi("progetto_assente"), 422);
  assert.equal(httpAnalisi("dossier_assente"), 422);
  assert.equal(httpAnalisi("dipendenza_fallita"), 424);
  assert.equal(httpAnalisi("bloccata"), 503);
  assert.equal(httpAnalisi("database_non_disponibile"), 503);

  assert.equal(httpApprovazione("approvata"), 200);
  assert.equal(httpApprovazione("rifiutata"), 200);
  assert.equal(httpApprovazione("input_non_valido"), 422);
  assert.equal(httpApprovazione("stale"), 409);
  assert.equal(httpApprovazione("concorrenza"), 409);
  assert.equal(httpApprovazione("marchio_non_risolto"), 409);
  assert.equal(httpApprovazione("marchio_bloccato"), 503);
});

// ----- La telemetria non perde campi e non stampa nomi ----------------

test("telemetria: ogni campo del riepilogo sopravvive alla lista bianca", () => {
  // Il difetto gia visto una volta: un campo calcolato e filtrato via
  // dalla lista bianca. Il conto si fa qui, non rileggendo l'elenco.
  const r = riepilogoVuoto(EVENTO_ANALISI, "p", "l");
  const uscita = soloCampiAmmessi(r);
  const persi = Object.keys(r).filter((k) => !(k in uscita));
  assert.deepEqual(persi, [], `campi calcolati e poi buttati: ${persi.join(", ")}`);
});

test("telemetria: la base non esce in chiaro, perche contiene nomi di persone", () => {
  // `condizioniDi()` ci mette dentro l'attribuzione, e l'attribuzione
  // di una fotografia di Places e il nome di chi l'ha scattata.
  const base = "abc123~display_allowed_with_attribution~provider_rendered~Rosita Buonsante";
  const d = digest(base);
  assert.equal(d.length, 12);
  assert.ok(!d.includes("Rosita"), "il digest non deve contenere il nome");
  assert.notEqual(d, digest(`${base}x`), "deve cambiare quando cambia la base");
  assert.equal(digest(""), "");
});
