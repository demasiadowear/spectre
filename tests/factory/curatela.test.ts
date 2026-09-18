import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applicaCuratela, condizioniDi, manifestRevision, puoGenerare,
  selectionBasisRevision, validaProposta, MAX_IN_PAGINA,
  type CuratelaProgetto, type SceltaFoto,
} from "../../lib/demo/curatela";
import { CAMPI_SEMANTICI } from "../../lib/demo/policy-media";
import type { FotoDemo } from "../../lib/demo/foto";

// ============================================================
// L'identita di una fotografia e `candidate_id`, non l'indice.
//
// L'indice e una POSIZIONE nell'elenco che Places restituisce, e non e
// una proprieta della fotografia: e una proprieta di come Google ce
// l'ha consegnata quel giorno. Legarci una proposta significa che «la
// foto in apertura» cambia da sola, senza che niente sembri rotto.
//
// E la validazione guarda SOLO le fotografie scelte. Invalidare tutto
// perche Places ha aggiunto un'immagine che non usiamo vorrebbe dire
// rifare — e ripagare — l'analisi per un fatto che non ci riguarda.
// ============================================================

const f = (id: string, indice: number, over: Partial<FotoDemo> = {}): FotoDemo => ({
  id, indice, src: `/demo/S/foto/${indice}`,
  larghezza: 1200, altezza: 1600,
  attribuzione: "Rosita Buonsante", attribuzione_obbligatoria: true,
  display_status: "display_allowed_with_attribution",
  rights_status: "provider_rendered",
  ...over,
});

const scelta = (
  candidate_id: string, order: number,
  over: Partial<SceltaFoto> = {},
): SceltaFoto => ({
  candidate_id, order,
  layout_role: order === 0 ? "hero" : "interior",
  object_position: "50% 30%", stato: "selected", ...over,
});

function proposta(foto: readonly FotoDemo[], scelte: SceltaFoto[]): CuratelaProgetto {
  return {
    basis_revision: selectionBasisRevision(scelte, foto),
    manifest_revision: manifestRevision(foto),
    proposal_revision: "p1",
    scelte, da_rivedere: [], composta_il: "2026-09-18T12:00:00Z",
  };
}

// ----- A: stesso insieme, ordine diverso ------------------------------

test("A: Places riordina le stesse foto -> proposta valida e rimappata", () => {
  // Il caso che rende l'indice inservibile come identita. Le immagini
  // sono le stesse; e cambiata solo la posizione in cui Google le
  // elenca. Nessun costo nuovo, nessuna analisi da rifare.
  const prima = [f("A", 0), f("B", 1), f("C", 2)];
  const p = proposta(prima, [scelta("C", 0), scelta("A", 1)]);

  const dopo = [f("C", 0), f("B", 1), f("A", 2)];
  const v = validaProposta(p, dopo);
  assert.equal(v.stato, "valida");
  assert.equal(v.stato === "valida" && v.outdated, false);

  const inPagina = applicaCuratela(dopo, p);
  assert.equal(inPagina.length, 2);
  // La hero resta la C, e prende il suo NUOVO percorso pubblico.
  assert.equal(inPagina[0].id, "C");
  assert.equal(inPagina[0].layout_role, "hero");
  assert.equal(inPagina[0].src, "/demo/S/foto/0");
  assert.equal(inPagina[1].id, "A");
  assert.equal(inPagina[1].src, "/demo/S/foto/2", "il percorso segue la posizione nuova");
});

// ----- B, C: cambia il contorno, non la sostanza ----------------------

test("B: rimossa una foto NON selezionata -> valida", () => {
  const prima = [f("A", 0), f("B", 1), f("C", 2)];
  const p = proposta(prima, [scelta("A", 0)]);
  const dopo = [f("A", 0), f("C", 1)];   // B sparisce, non era usata
  const v = validaProposta(p, dopo);
  assert.equal(v.stato, "valida");
  assert.equal(applicaCuratela(dopo, p)[0].id, "A");
});

test("C: aggiunta una foto nuova -> valida ma outdated", () => {
  // La demo esistente non si blocca: si segnala che c'e materiale che
  // nessuno ha ancora guardato.
  const prima = [f("A", 0), f("B", 1)];
  const p = proposta(prima, [scelta("A", 0)]);
  const dopo = [f("A", 0), f("B", 1), f("NUOVA", 2)];

  const v = validaProposta(p, dopo);
  assert.equal(v.stato, "valida");
  assert.equal(v.stato === "valida" && v.outdated, true);
  assert.equal(v.stato === "valida" && v.nuove, 1);
  assert.equal(applicaCuratela(dopo, p).length, 1, "la demo resta in piedi");
});

// ----- D, E, F: cambia una foto SCELTA --------------------------------

test("D: la hero scompare -> stale", () => {
  const prima = [f("A", 0), f("B", 1)];
  const p = proposta(prima, [scelta("A", 0), scelta("B", 1)]);
  const dopo = [f("B", 0)];   // la hero non c'e piu

  const v = validaProposta(p, dopo);
  assert.equal(v.stato, "stale");
  assert.equal(v.stato === "stale" && v.motivo, "foto_scomparsa");
  assert.equal(v.stato === "stale" && v.candidate_id, "A", "si dice QUALE, non solo che");
  assert.deepEqual(applicaCuratela(dopo, p), []);
});

test("E: una foto scelta non e piu mostrabile -> stale", () => {
  const prima = [f("A", 0), f("B", 1)];
  const p = proposta(prima, [scelta("A", 0), scelta("B", 1)]);
  // I diritti su B sono cambiati: ora serve un'approvazione.
  const dopo = [f("A", 0), f("B", 1, { display_status: "display_after_approval" })];

  const v = validaProposta(p, dopo);
  assert.equal(v.stato, "stale");
  assert.equal(v.stato === "stale" && v.motivo, "non_piu_mostrabile");
  assert.equal(v.stato === "stale" && v.candidate_id, "B");
});

test("F: cambia l'attribuzione di una foto scelta -> stale", () => {
  // E la riga che nessuno rilegge: l'immagine e la stessa, ma sotto
  // c'e scritto il nome di un altro autore. Pubblicarla cosi e
  // un'attribuzione sbagliata, non un dettaglio di impaginazione.
  const prima = [f("A", 0)];
  const p = proposta(prima, [scelta("A", 0)]);
  const dopo = [f("A", 0, { attribuzione: "Giovanna Calderone" })];

  const v = validaProposta(p, dopo);
  assert.equal(v.stato, "stale");
  assert.equal(v.stato === "stale" && v.motivo, "attribuzione_cambiata");
});

test("E-bis: cambia il regime dei diritti -> stale, con il motivo giusto", () => {
  const prima = [f("A", 0)];
  const p = proposta(prima, [scelta("A", 0)]);
  const dopo = [f("A", 0, { rights_status: "customer_owned" })];
  const v = validaProposta(p, dopo);
  assert.equal(v.stato, "stale");
  assert.equal(v.stato === "stale" && v.motivo, "regime_diritti_cambiato");
});

// ----- G: nessuna sostituzione silenziosa -----------------------------

test("G: l'indice 3 punta a un'altra foto -> nessuna sostituzione", () => {
  // Il difetto che tutta questa astrazione esiste per impedire. Prima
  // la proposta diceva «indice 3 in hero»; dopo il riordino l'indice 3
  // e un'altra immagine, e la pagina si costruiva mostrandola.
  //
  // Ora la proposta dice «la foto ORIGINALE in hero», e quella foto
  // viene ritrovata per identita — oppure non viene usata affatto.
  const prima = [f("ORIGINALE", 3)];
  const p = proposta(prima, [scelta("ORIGINALE", 0)]);

  // Stesso indice, altra fotografia, e l'originale non c'e piu.
  const dopo = [f("INTRUSA", 3)];
  const inPagina = applicaCuratela(dopo, p);

  assert.ok(!inPagina.some((x) => x.id === "INTRUSA"),
    "la proposta ha raggiunto una fotografia che nessuno aveva scelto");
  assert.equal(validaProposta(p, dopo).stato, "stale");

  // E se l'originale sopravvive a un altro indice, si ritrova.
  const riordinato = [f("ALTRA", 0), f("ORIGINALE", 3)];
  const v2 = validaProposta(p, riordinato);
  assert.equal(v2.stato, "valida");
  assert.equal(applicaCuratela(riordinato, p)[0].id, "ORIGINALE");
});

// ----- Le tre revisioni ----------------------------------------------

test("revisioni: la validita dipende dalla base, non dal manifest intero", () => {
  const prima = [f("A", 0), f("B", 1)];
  const p = proposta(prima, [scelta("A", 0)]);
  const dopo = [f("A", 0), f("B", 1), f("C", 2)];

  // Il manifest e cambiato...
  assert.notEqual(manifestRevision(prima), manifestRevision(dopo));
  // ...ma le condizioni della foto scelta no.
  assert.equal(selectionBasisRevision(p.scelte, prima), selectionBasisRevision(p.scelte, dopo));
  assert.equal(validaProposta(p, dopo).stato, "valida");
});

test("revisioni: riordinare la PAGINA non invalida, cambiare una condizione si", () => {
  const foto = [f("A", 0), f("B", 1)];
  const ordineUno = [scelta("A", 0), scelta("B", 1)];
  const ordineDue = [scelta("B", 0), scelta("A", 1)];
  // La base e ordinata per id: come impaginiamo e affar nostro.
  assert.equal(selectionBasisRevision(ordineUno, foto), selectionBasisRevision(ordineDue, foto));

  const alterata = [f("A", 0, { attribuzione: "Altro" }), f("B", 1)];
  assert.notEqual(selectionBasisRevision(ordineUno, foto), selectionBasisRevision(ordineUno, alterata));
});

test("revisioni: le condizioni non contengono niente dell'immagine", () => {
  const c = condizioniDi(f("A", 0));
  for (const k of CAMPI_SEMANTICI) assert.ok(!c.includes(k), k);
  assert.ok(c.startsWith("A~"), c);
});

// ----- Generazione ----------------------------------------------------

test("generazione: una proposta stale non genera, e dice perche", () => {
  const prima = [f("A", 0)];
  const p = proposta(prima, [scelta("A", 0)]);
  const g = puoGenerare(p, [f("B", 0)], false);
  assert.equal(g.ok, false);
  assert.ok(/foto_scomparsa/.test(g.motivo), g.motivo);
});

test("generazione: valida con hero decisa e brand non bloccante -> si genera", () => {
  const foto = [f("A", 0), f("B", 1)];
  const p = proposta(foto, [scelta("A", 0), scelta("B", 1)]);
  assert.equal(puoGenerare(p, foto, false).ok, true);
  // Il brand bloccante ferma anche una curatela perfetta.
  assert.equal(puoGenerare(p, foto, true).ok, false);
});

test("generazione: senza hero si genera lo stesso, con l'apertura testuale", () => {
  // Prima questo test pretendeva un'apertura fotografica. La regola e
  // cambiata guardando una proposta reale: quando nessuna fotografia
  // merita l'apertura, la pagina si apre con il nome — che e una
  // composizione progettata, non un buco. Pretendere una fotografia
  // significa accettarne una qualunque, ed e cosi che in copertina e
  // finito un mucchio di asciugamani.
  const foto = [f("A", 0), f("B", 1)];
  const p = proposta(foto, [
    scelta("A", 0, { layout_role: "interior" }),
    scelta("B", 1, { layout_role: "detail" }),
  ]);
  const r = puoGenerare(p, foto, false);
  assert.equal(r.ok, true, r.motivo);
});

test("curatela: al massimo cinque in pagina", () => {
  const foto = Array.from({ length: 9 }, (_, i) => f(`f${i}`, i));
  const p = proposta(foto, foto.map((x, i) => scelta(x.id, i)));
  assert.equal(applicaCuratela(foto, p).length, MAX_IN_PAGINA);
});

test("curatela: si conserva impaginazione, mai il perche", () => {
  const foto = [f("A", 0)];
  const p = proposta(foto, [scelta("A", 0)]);
  const testo = JSON.stringify(p);
  for (const k of CAMPI_SEMANTICI) assert.ok(!testo.includes(k), k);
  assert.deepEqual(Object.keys(p.scelte[0]).sort(),
    ["candidate_id", "layout_role", "object_position", "order", "stato"]);
});
