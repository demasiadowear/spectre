import assert from "node:assert/strict";
import { test } from "node:test";

import {
  booleano, frazione, interpretaRisposta, type FotoDaAnalizzare,
} from "../../lib/demo/analisi-effimera";
import { valutaProposta } from "../../lib/demo/curatela";

// ============================================================
// IL MODELLO OSSERVA, IL COMPOSITORE DECIDE.
//
// Tre corse reali per arrivarci, e ognuna ha tolto un pezzo di
// decisione al modello:
//
//  1. zero selezionate su dieci — la risposta non si leggeva;
//  2. dieci lette, zero selezionate — il marchio e le persone
//     escludevano tutto;
//  3. UNA selezionata, in apertura, ed erano asciugamani ammassati —
//     perche il modello poteva ancora dire `usable: false` sulle altre
//     nove, e il compositore non aveva niente da comporre.
//
// Adesso Gemini non emette ne `usable` ne `role`: descrive soltanto —
// genere, qualita, richiamo, disordine, leggibilita, fuoco, persona,
// marchio, confidenza. Il compositore vede TUTTI i candidati scaricati
// ed esclude solo per cause esplicite.
// ============================================================

const lotto = (n: number): FotoDaAnalizzare[] =>
  Array.from({ length: n }, (_, i) => ({
    candidate_id: `cand${String(i).padStart(2, "0")}`,
    indice: i * 3,            // di proposito NON contiguo: l'indice del
    rights_status: "provider_rendered" as const,  // manifest non e quello del lotto
    carica: async () => null,
  }));

const LOTTO = lotto(10);

/** Un'osservazione completa e sana: ambiente pulito, ben illuminato,
 *  soggetto leggibile, nessun marchio. Da qui si deroga campo per
 *  campo, cosi ogni test dice quale singola cosa sta cambiando.
 *
 *  Nota: NON c'e `usable` e NON c'e `role`. Il modello non ha piu un
 *  campo con cui chiudere la selezione. */
const voce = (i: number, o: Record<string, unknown> = {}) => ({
  image_index: i, content_kind: "clean_interior",
  commercial_appeal: 0.8, clutter: 0.2, quality: 0.8, subject_legible: true,
  focus_x: 0.5, focus_y: 0.4, confidence: 0.9,
  identifiable_person: false, brand_observation: "none", ...o,
});

const sel = (r: ReturnType<typeof interpretaRisposta>) =>
  r.scelte.filter((s) => s.stato === "selected");
const rev = (r: ReturnType<typeof interpretaRisposta>) =>
  r.scelte.filter((s) => s.stato === "needs_visual_review");
const motivo = (r: ReturnType<typeof interpretaRisposta>, id: string) =>
  r.da_rivedere.filter((x) => x.candidate_id === id).map((x) => x.motivo);

// ----- Il caso nominale ----------------------------------------------

test("compositore: cinque ambienti sani -> cinque in pagina, una apertura", () => {
  const testo = JSON.stringify([0, 1, 2, 3, 4].map((i) => voce(i)));
  const r = interpretaRisposta(testo, LOTTO);

  assert.equal(r.conti.model_items_returned, 5);
  assert.equal(r.conti.mapped_items, 5);
  assert.equal(r.conti.parse_failures, 0);
  assert.equal(sel(r).length, 5);
  assert.equal(r.hero_status, "OK");
  assert.equal(sel(r).filter((s) => s.layout_role === "hero").length, 1);
  assert.equal(sel(r).find((s) => s.layout_role === "hero")?.order, 0);
});

// ----- 1. Gemini marca solo i tessili: il compositore lo ignora -------

test("1. il modello descrive bene i tessili -> il compositore li esclude e sceglie gli ambienti", () => {
  // Il caso reale, ricostruito. Prima il modello marcava `usable` solo
  // sui tessili e vinceva; adesso non ha piu quel campo, e i tessili
  // escono per una causa esplicita mentre gli ambienti entrano.
  const testo = JSON.stringify([
    voce(5, { content_kind: "linen", commercial_appeal: 0.95, confidence: 0.99 }),
    voce(0, { content_kind: "clean_interior" }),
    voce(3, { content_kind: "clean_interior" }),
    voce(4, { content_kind: "clean_interior" }),
  ]);
  const r = interpretaRisposta(testo, LOTTO);

  assert.deepEqual(sel(r).map((s) => s.candidate_id).sort(), ["cand00", "cand03", "cand04"]);
  assert.equal(sel(r).some((s) => s.candidate_id === "cand05"), false, "i tessili restano fuori");
  assert.deepEqual(motivo(r, "cand05"), ["genere_non_utilizzabile"]);
  assert.equal(r.hero_status, "OK");
  assert.notEqual(sel(r).find((s) => s.layout_role === "hero")?.candidate_id, "cand05");
});

// ----- 2. Il compositore valuta comunque tutti -------------------------

test("2. il modello non seleziona niente — non puo — e il compositore valuta tutti", () => {
  // Dieci descrizioni, nessuna «scelta»: il campo non esiste. Tutte e
  // dieci passano dal giudizio del compositore.
  const testo = JSON.stringify(LOTTO.map((_, i) => voce(i)));
  const r = interpretaRisposta(testo, LOTTO);

  assert.equal(r.conti.mapped_items, 10, "tutte e dieci valutate");
  assert.equal(
    r.scelte.filter((s) => s.stato === "unreviewed").length, 0,
    "nessuna resta senza giudizio",
  );
  assert.equal(sel(r).length, 5, "cinque in pagina, il tetto");
  assert.equal(
    r.scelte.filter((s) => s.stato === "not_selected").length, 5,
    "le altre cinque escluse dal tetto, non da un capriccio del modello",
  );
});

// ----- 3. Tessili con confidenza 0,99: mai apertura -------------------

test("3. tessili con confidence 0.99 non aprono, e non entrano nemmeno", () => {
  const testo = JSON.stringify([
    voce(5, { content_kind: "linen", commercial_appeal: 0.99, clutter: 0.1,
      quality: 0.95, confidence: 0.99 }),
    voce(0), voce(3),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(sel(r).some((s) => s.candidate_id === "cand05"), false);
  assert.notEqual(sel(r).find((s) => s.layout_role === "hero")?.candidate_id, "cand05");
});

test("3b. deposito e soffitto escono per la stessa causa", () => {
  for (const genere of ["storage", "ceiling"]) {
    const r = interpretaRisposta(
      JSON.stringify([voce(0, { content_kind: genere, confidence: 0.99 })]), LOTTO,
    );
    assert.equal(sel(r).length, 0, genere);
    assert.deepEqual(motivo(r, "cand00"), ["genere_non_utilizzabile"], genere);
  }
});

test("3c. macchinario, mani e prodotto restano in galleria ma non aprono", () => {
  // Non sono difetti: sono fotografie che funzionano in mezzo alle
  // altre e non in cima.
  const testo = JSON.stringify([
    voce(0, { content_kind: "equipment" }),
    voce(1, { content_kind: "hands_at_work" }),
    voce(2, { content_kind: "product" }),
    voce(3, { content_kind: "clean_interior" }),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(sel(r).length, 4, "tutte in galleria");
  assert.equal(sel(r).find((s) => s.layout_role === "hero")?.candidate_id, "cand03",
    "apre l'ambiente, non il macchinario");
});

// ----- 1. treatment_detail non apre MAI ------------------------------

test("1. un treatment_detail con tutti i punteggi a 1 non puo essere apertura", () => {
  // Il difetto che questo test esiste per non avere piu: sostituire gli
  // asciugamani con un primo piano di guanto e sostituire un soggetto
  // sbagliato con un altro soggetto sbagliato.
  const testo = JSON.stringify([
    voce(0, {
      content_kind: "treatment_detail", commercial_appeal: 1, clutter: 0,
      quality: 1, confidence: 1,
    }),
    voce(1, { content_kind: "clean_interior", commercial_appeal: 0.66 }),
    voce(2, { content_kind: "clean_interior", commercial_appeal: 0.66 }),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(sel(r).some((s) => s.candidate_id === "cand00"), true, "in galleria si");
  assert.notEqual(sel(r).find((s) => s.layout_role === "hero")?.candidate_id, "cand00");
});

test("2. un clean_interior con punteggio piu basso batte un treatment_detail perfetto", () => {
  const testo = JSON.stringify([
    voce(0, { content_kind: "treatment_detail", commercial_appeal: 1, clutter: 0, quality: 1 }),
    voce(1, { content_kind: "clean_interior", commercial_appeal: 0.66, quality: 0.62 }),
    voce(2, { content_kind: "clean_interior", commercial_appeal: 0.7 }),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  const apre = sel(r).find((s) => s.layout_role === "hero")?.candidate_id;
  assert.ok(apre === "cand01" || apre === "cand02", `ha aperto ${apre}`);
  assert.notEqual(apre, "cand00");
});

test("3. se ci sono SOLO dettagli, l'apertura e testuale", () => {
  const testo = JSON.stringify([
    voce(0, { content_kind: "treatment_detail" }),
    voce(1, { content_kind: "hands_at_work" }),
    voce(2, { content_kind: "equipment" }),
    voce(3, { content_kind: "product" }),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(r.hero_status, "NEEDS_REVIEW");
  assert.equal(sel(r).length, 4, "restano tutte in galleria");
  assert.equal(sel(r).filter((s) => s.layout_role === "hero").length, 0);
});

test("3d. un ambiente con marchio incidentale sta in galleria, non in apertura", () => {
  // L'apertura e l'immagine identitaria: un logo altrui, anche
  // incidentale, e nel posto peggiore possibile.
  const testo = JSON.stringify([
    voce(0, { brand_observation: "incidental_mark", commercial_appeal: 0.95 }),
    voce(1, { commercial_appeal: 0.7 }),
    voce(2, { commercial_appeal: 0.7 }),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(sel(r).some((s) => s.candidate_id === "cand00"), true);
  assert.notEqual(sel(r).find((s) => s.layout_role === "hero")?.candidate_id, "cand00");
});

// ----- 4. Persona riconoscibile: revisione, mai consenso --------------

test("4. una persona riconoscibile va in revisione: non esclusa, e non consentita", () => {
  const testo = JSON.stringify([
    voce(7, { content_kind: "person_treatment", identifiable_person: true }),
    voce(0), voce(3),
  ]);
  const r = interpretaRisposta(testo, LOTTO);

  assert.equal(rev(r).some((s) => s.candidate_id === "cand07"), true, "in revisione");
  assert.equal(sel(r).some((s) => s.candidate_id === "cand07"), false,
    "NON entra in pagina da sola: il consenso non si acquisisce per default");
  assert.deepEqual(motivo(r, "cand07"), ["possibile_persona_identificabile"]);
  assert.notEqual(sel(r).find((s) => s.layout_role === "hero")?.candidate_id, "cand07");
});

// ----- 5. Una sola valida -> proposta incompleta ----------------------

test("5. una sola fotografia valida -> proposta incompleta, e non si pubblica", () => {
  const testo = JSON.stringify([
    voce(0, { content_kind: "clean_interior" }),
    voce(1, { content_kind: "linen" }),
    voce(2, { content_kind: "storage" }),
    voce(3, { content_kind: "ceiling" }),
    voce(4, { content_kind: "clean_interior", quality: 0.1 }),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(sel(r).length, 1);

  const v = valutaProposta(r.scelte);
  assert.equal(v.proposal_status, "incomplete");
  assert.equal(v.codice, "insufficient_usable_media");
  // E l'unica rimasta NON diventa l'apertura.
  assert.equal(r.hero_status, "NEEDS_REVIEW");
  assert.equal(sel(r)[0].layout_role !== "hero", true);
});

test("5b. due valide su dieci restano insufficienti", () => {
  const testo = JSON.stringify([
    voce(0), voce(1),
    voce(2, { content_kind: "linen" }), voce(3, { content_kind: "linen" }),
    voce(4, { content_kind: "storage" }),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(sel(r).length, 2);
  assert.equal(valutaProposta(r.scelte).codice, "insufficient_usable_media");
});

test("5c. tre valide bastano: la proposta e completa", () => {
  const r = interpretaRisposta(JSON.stringify([voce(0), voce(1), voce(2)]), LOTTO);
  assert.equal(sel(r).length, 3);
  assert.equal(valutaProposta(r.scelte).proposal_status, "complete");
});

test("5d. un manifest piccolo non e una proposta incompleta", () => {
  // Due fotografie in tutto, due scelte: non manca niente.
  const due = lotto(2);
  const r = interpretaRisposta(JSON.stringify([voce(0), voce(1)]), due);
  assert.equal(valutaProposta(r.scelte).proposal_status, "complete");
});

// ----- 6. Nessuna apertura valida -> apertura testuale ----------------

test("6. nessuna candidata supera il gate -> apertura testuale, nessuna promossa", () => {
  const testo = JSON.stringify([
    voce(0, { content_kind: "equipment" }),
    voce(1, { content_kind: "product" }),
    voce(2, { content_kind: "hands_at_work" }),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(r.hero_status, "NEEDS_REVIEW");
  assert.equal(sel(r).length, 3, "restano in galleria");
  assert.equal(sel(r).filter((s) => s.layout_role === "hero").length, 0);
});

test("6b. il gate vuole PROVE: un valore non dichiarato non apre", () => {
  // Prima il gate escludeva sui difetti: se il disordine non era
  // dichiarato, il disordine non c'era. Adesso ogni condizione va
  // dimostrata.
  for (const mancante of ["commercial_appeal", "clutter", "quality"]) {
    const o: Record<string, unknown> = { content_kind: "treatment_room" };
    o[mancante] = null;
    const r = interpretaRisposta(
      JSON.stringify([voce(0, o), voce(1, { content_kind: "product" })]), LOTTO,
    );
    assert.equal(r.hero_status, "NEEDS_REVIEW", mancante);
  }
});

test("6c. disordine, luce, richiamo e ritaglio fermano l'apertura", () => {
  for (const o of [
    { clutter: 0.5 }, { quality: 0.5 }, { commercial_appeal: 0.6 },
    { focus_y: 0.9 }, { focus_x: 0.1 }, { subject_legible: null },
  ]) {
    const testo = JSON.stringify([
      voce(0, { content_kind: "treatment_room", ...o }),
      voce(1, { content_kind: "product" }),
    ]);
    assert.equal(interpretaRisposta(testo, LOTTO).hero_status, "NEEDS_REVIEW", JSON.stringify(o));
  }
});

test("6d. l'unica selezionata non diventa mai l'apertura", () => {
  const r = interpretaRisposta(JSON.stringify([voce(0, { content_kind: "treatment_room" })]), LOTTO);
  assert.equal(sel(r).length, 1);
  assert.equal(r.hero_status, "NEEDS_REVIEW");
});

// ----- Il marchio, sull'altro asse -----------------------------------

test("marchio: incidentale non esclude e non segnala, ma non apre", () => {
  const testo = JSON.stringify([
    voce(0, { content_kind: "treatment_room", brand_observation: "incidental_mark" }),
    voce(1), voce(2),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(sel(r).length, 3, "resta in galleria");
  assert.deepEqual(motivo(r, "cand00"), [], "e non e nemmeno un motivo da spiegare");
  assert.notEqual(sel(r).find((s) => s.layout_role === "hero")?.candidate_id, "cand00");
});

test("marchio: un logo estraneo DOMINANTE manda a una persona", () => {
  const testo = JSON.stringify([
    voce(0, { brand_observation: "dominant_third_party_mark" }), voce(1), voce(2),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(sel(r).some((s) => s.candidate_id === "cand00"), false);
  assert.deepEqual(motivo(r, "cand00"), ["marchio_estraneo_dominante"]);
});

test("marchio: «forse e l'insegna» segnala e resta in pagina", () => {
  const testo = JSON.stringify([
    voce(0, { brand_observation: "possible_business_mark" }), voce(1), voce(2),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(sel(r).some((s) => s.candidate_id === "cand00"), true);
  assert.deepEqual(motivo(r, "cand00"), ["marchio_attivita_possibile"]);
});

test("marchio: il vecchio booleano vale incidentale, non blocco", () => {
  const testo = JSON.stringify([
    { image_index: 0, content_kind: "clean_interior", quality: 0.8, subject_legible: true,
      confidence: 0.9, brand_visible: true },
    voce(1), voce(2),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(sel(r).length, 3);
  assert.deepEqual(motivo(r, "cand00"), []);
});

// ----- Mappatura e lettura -------------------------------------------

test("mappatura: l'indice 0 viene mantenuto", () => {
  const r = interpretaRisposta(JSON.stringify([voce(0), voce(1), voce(2)]), LOTTO);
  assert.equal(r.conti.invalid_indices, 0);
  assert.equal(sel(r).some((s) => s.candidate_id === "cand00"), true);
});

test("mappatura: 6, 7 e 8 finiscono sui candidate_id giusti", () => {
  const testo = JSON.stringify([
    voce(6, { content_kind: "treatment_room" }),
    voce(7, { content_kind: "person_treatment", identifiable_person: true }),
    voce(8, { content_kind: "clean_interior" }),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.deepEqual(sel(r).map((s) => s.candidate_id).sort(), ["cand06", "cand08"]);
  assert.deepEqual(rev(r).map((s) => s.candidate_id), ["cand07"]);
  // `clean_interior` viene prima di `treatment_room` nell'elenco delle
  // aperture ammesse: apre l'ambiente.
  assert.equal(sel(r).find((s) => s.layout_role === "hero")?.candidate_id, "cand08");
});

test("mappatura: il modello parla per posizione nel LOTTO", () => {
  const r = interpretaRisposta(JSON.stringify([voce(1), voce(2), voce(3)]), LOTTO);
  assert.deepEqual(sel(r).map((s) => s.candidate_id).sort(), ["cand01", "cand02", "cand03"]);
});

test("mappatura: un indice invalido non elimina gli altri", () => {
  const testo = JSON.stringify([voce(0), voce(99), voce(1), voce(-1), voce(2)]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(r.conti.invalid_indices, 2);
  assert.equal(r.conti.mapped_items, 3);
  assert.equal(sel(r).length, 3);
});

test("mappatura: un duplicato si deduplica senza azzerare il resto", () => {
  const testo = JSON.stringify([voce(0), voce(0), voce(1), voce(2)]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(r.conti.duplicate_indices, 1);
  assert.equal(new Set(sel(r).map((s) => s.candidate_id)).size, 3);
});

test("lettura: chiavi inglesi, italiane o involucri qualunque", () => {
  for (const chiave of ["immagini", "risultati", "images", "data"]) {
    const testo = JSON.stringify({ [chiave]: [voce(0), voce(1), voce(2)] });
    assert.equal(interpretaRisposta(testo, LOTTO).conti.model_items_returned, 3, chiave);
  }
  const italiane = JSON.stringify([
    { indice: 0, genere: "interior", qualita: 0.8, soggetto_leggibile: true, confidenza: 0.9 },
  ]);
  assert.equal(interpretaRisposta(italiane, LOTTO).conti.mapped_items, 1);
});

test("lettura: la confidenza in percentuale non diventa zero", () => {
  const testo = JSON.stringify([voce(0, { confidence: 90 }), voce(1), voce(2)]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(r.conti.needs_review_count, 0);
  assert.equal(sel(r).length, 3);
});

test("lettura: una risposta illeggibile non inventa scelte", () => {
  for (const testo of ["", "non e json", "{}", "null", "42"]) {
    const r = interpretaRisposta(testo, LOTTO);
    assert.equal(sel(r).length, 0, testo);
    assert.equal(r.conti.parse_failures, 1, testo);
    assert.ok(r.scelte.every((s) => s.stato === "unreviewed"), testo);
  }
});

test("lettura: una fotografia che il modello non nomina resta «non guardata»", () => {
  const r = interpretaRisposta(JSON.stringify([voce(0), voce(1), voce(2)]), LOTTO);
  assert.equal(r.scelte.filter((s) => s.stato === "unreviewed").length, 7);
});

// ----- I normalizzatori ----------------------------------------------

test("frazione: percentuali convertite, valori illeggibili a null", () => {
  assert.equal(frazione(0.9), 0.9);
  assert.equal(frazione(0), 0);
  assert.equal(frazione(90), 0.9);
  assert.equal(frazione("0.75"), 0.75);
  for (const v of [undefined, null, "", "boh", NaN, -1, 1000, true]) {
    assert.equal(frazione(v), null, String(v));
  }
});

test("booleano: si, no, e non l'ha detto", () => {
  for (const v of [true, "true", "SI", "sì", "yes", 1, "1", "vero"]) {
    assert.equal(booleano(v), true, String(v));
  }
  for (const v of [false, "false", "no", 0, "0", "falso"]) {
    assert.equal(booleano(v), false, String(v));
  }
  for (const v of [undefined, null, "forse", 7, {}]) {
    assert.equal(booleano(v), null, String(v));
  }
});
