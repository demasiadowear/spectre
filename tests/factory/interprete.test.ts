import assert from "node:assert/strict";
import { test } from "node:test";

import {
  booleano, frazione, interpretaRisposta, type FotoDaAnalizzare,
} from "../../lib/demo/analisi-effimera";

// ============================================================
// L'interprete della risposta del modello.
//
// Questi test nascono da una corsa vera: dieci fotografie buone, 6.542
// token spesi, ZERO selezionate, nessun errore da nessuna parte. Il
// pulsante «Approva» era spento e la schermata non diceva perche.
//
// La causa non era una: erano sei. Rigiocando dieci forme plausibili
// della risposta attraverso il lettore di allora, sei finivano a zero
// selezioni e quattro lo facevano in SILENZIO — chiavi inglesi, un
// involucro con un altro nome, `adatta` come stringa, `adatta` omesso,
// ruoli in italiano, e la confidenza in percentuale che diventava zero.
//
// Ognuna di quelle sei ha un test qui sotto, con il suo nome.
// ============================================================

const lotto = (n: number): FotoDaAnalizzare[] =>
  Array.from({ length: n }, (_, i) => ({
    candidate_id: `cand${String(i).padStart(2, "0")}`,
    indice: i * 3,            // di proposito NON contiguo: l'indice del
    rights_status: "provider_rendered" as const,  // manifest non e quello del lotto
    carica: async () => null,
  }));

const LOTTO = lotto(10);

const voce = (i: number, o: Record<string, unknown> = {}) => ({
  image_index: i, role: "interior", usable: true,
  focus_x: 0.5, focus_y: 0.4, confidence: 0.9,
  identifiable_person: false, brand_visible: false, ...o,
});

const sel = (r: ReturnType<typeof interpretaRisposta>) =>
  r.scelte.filter((s) => s.stato === "selected");

// ----- Il caso nominale -----------------------------------------------

test("interprete: dieci voci buone producono cinque scelte con un'apertura", () => {
  const testo = JSON.stringify(LOTTO.map((_, i) => voce(i, i === 0 ? { role: "hero" } : {})));
  const r = interpretaRisposta(testo, LOTTO);

  assert.equal(r.conti.model_items_returned, 10);
  assert.equal(r.conti.mapped_items, 10);
  assert.equal(r.conti.invalid_indices, 0);
  assert.equal(r.conti.parse_failures, 0);
  assert.equal(sel(r).length, 5, "cinque in pagina, il tetto");
  assert.equal(sel(r).filter((s) => s.layout_role === "hero").length, 1, "una sola apertura");
  assert.equal(sel(r).find((s) => s.layout_role === "hero")?.order, 0, "l'apertura va in testa");
});

// ----- 1. L'indice 0 ---------------------------------------------------

test("interprete: l'indice 0 restituito dal modello viene MANTENUTO", () => {
  // `0` e falsy, e un controllo di verita al posto di un controllo di
  // intervallo lo butterebbe — e 0 e proprio l'apertura.
  const r = interpretaRisposta(JSON.stringify([voce(0, { role: "hero" })]), LOTTO);
  assert.equal(r.conti.mapped_items, 1);
  assert.equal(r.conti.invalid_indices, 0);
  assert.equal(sel(r).length, 1);
  assert.equal(sel(r)[0].candidate_id, "cand00");
  assert.equal(sel(r)[0].layout_role, "hero");
});

// ----- 2. La mappatura -------------------------------------------------

test("interprete: gli indici 6, 7 e 8 finiscono sui tre candidate_id giusti", () => {
  const testo = JSON.stringify([
    voce(6, { role: "hero" }), voce(7, { role: "treatment" }), voce(8, { role: "interior" }),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.deepEqual(sel(r).map((s) => s.candidate_id).sort(), ["cand06", "cand07", "cand08"]);
});

test("interprete: il modello parla per posizione nel LOTTO, non per indice di manifest", () => {
  // Gli indici del manifest qui sono 0,3,6,9,... — se l'interprete li
  // confondesse con `image_index`, la fotografia 1 del lotto diventerebbe
  // quella del manifest 1, che non esiste.
  const r = interpretaRisposta(JSON.stringify([voce(1, { role: "hero" })]), LOTTO);
  assert.equal(sel(r)[0].candidate_id, "cand01");
});

test("interprete: il modello non puo restituire un candidate_id", () => {
  // Se lo facesse, non verrebbe nemmeno letto: l'unica cosa che si
  // guarda e un intero nell'intervallo del lotto.
  const testo = JSON.stringify([
    { ...voce(0), candidate_id: "cand09", image_index: "cand09" },
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(r.conti.mapped_items, 0);
  assert.equal(r.conti.invalid_indices, 1);
  assert.equal(sel(r).length, 0);
});

// ----- 3. I ruoli ------------------------------------------------------

test("interprete: hero, treatment e interior NON vengono eliminati dal sanitizzatore", () => {
  const testo = JSON.stringify([
    voce(0, { role: "hero" }), voce(1, { role: "treatment" }), voce(2, { role: "interior" }),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.deepEqual(
    sel(r).sort((a, b) => a.order - b.order).map((s) => s.layout_role),
    ["hero", "treatment", "interior"],
  );
});

test("interprete: il ruolo proposto si RISPETTA, non si riassegna per classifica", () => {
  // Prima i ruoli venivano assegnati per posizione in classifica: il
  // modello diceva «ambiente» e la fotografia diventava l'apertura.
  const testo = JSON.stringify([
    voce(0, { role: "interior", confidence: 0.99 }),
    voce(1, { role: "hero", confidence: 0.70 }),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  const apertura = sel(r).find((s) => s.layout_role === "hero");
  assert.equal(apertura?.candidate_id, "cand01", "l'apertura e quella che l'ha chiesta");
  assert.equal(sel(r).find((s) => s.candidate_id === "cand00")?.layout_role, "interior");
});

test("interprete: senza nessuna apertura proposta, la prende la piu sicura", () => {
  // Non la piu grande e non la prima di Places: la classifica del
  // modello. E comunque una scelta che una persona puo cambiare.
  const testo = JSON.stringify([
    voce(0, { role: "detail", confidence: 0.70 }),
    voce(1, { role: "interior", confidence: 0.95 }),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(sel(r).find((s) => s.layout_role === "hero")?.candidate_id, "cand01");
});

// ----- 4. Cinque scelte valide -> cinque scelte -----------------------

test("interprete: cinque voci valide producono una proposta di cinque scelte", () => {
  const testo = JSON.stringify([
    voce(0, { role: "hero" }), voce(1, { role: "treatment" }), voce(2, { role: "interior" }),
    voce(3, { role: "detail" }), voce(4, { role: "closing" }),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(sel(r).length, 5);
  assert.deepEqual(sel(r).map((s) => s.order), [0, 1, 2, 3, 4]);
  assert.equal(r.conti.selected_count, 5);
});

// ----- 5. Un indice invalido non distrugge i validi -------------------

test("interprete: un indice invalido non elimina gli altri", () => {
  const testo = JSON.stringify([
    voce(0, { role: "hero" }), voce(99), voce(1), voce(-1), voce(2),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(r.conti.invalid_indices, 2, "99 e -1");
  assert.equal(r.conti.mapped_items, 3);
  assert.equal(sel(r).length, 3, "i tre validi restano");
});

// ----- 6. Duplicati ----------------------------------------------------

test("interprete: un duplicato si deduplica senza azzerare il resto", () => {
  const testo = JSON.stringify([
    voce(0, { role: "hero" }), voce(0, { role: "detail" }), voce(1), voce(2),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(r.conti.duplicate_indices, 1);
  assert.equal(r.conti.mapped_items, 3);
  assert.equal(sel(r).length, 3);
  assert.equal(new Set(sel(r).map((s) => s.candidate_id)).size, 3, "nessuna fotografia due volte");
});

// ----- Le sei forme che avevano prodotto zero -------------------------

test("interprete: la confidenza in percentuale non diventa zero", () => {
  // Il difetto piu istruttivo: `frazione(v, 0)` rifiutava 90 perche
  // fuori da [0,1] e ripiegava su ZERO, cioe «per niente sicuro». Un
  // valore non letto non e un valore basso.
  const testo = JSON.stringify(LOTTO.map((_, i) => voce(i, { confidence: 90 })));
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(r.conti.needs_review_count, 0, "nessuna deve finire in revisione");
  assert.equal(sel(r).length, 5);
});

test("interprete: una confidenza non dichiarata non manda in revisione", () => {
  const testo = JSON.stringify([{ image_index: 0, role: "hero", usable: true }]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(r.conti.needs_review_count, 0);
  assert.equal(sel(r).length, 1);
});

test("interprete: una confidenza DICHIARATA e bassa manda in revisione", () => {
  // La regola resta: cio che cambia e che ora vale solo su un numero
  // che il modello ha davvero detto.
  const testo = JSON.stringify([voce(0, { confidence: 0.2 })]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(r.conti.needs_review_count, 1);
  assert.equal(sel(r).length, 0);
});

test("interprete: chiavi inglesi, italiane o miste vengono lette tutte", () => {
  const forme = [
    [{ image_index: 0, role: "hero", usable: true, confidence: 0.9 }],
    [{ index: 0, role: "hero", suitable: true, confidence: 0.9 }],
    [{ indice: 0, ruolo: "hero", adatta: true, confidenza: 0.9 }],
  ];
  for (const f of forme) {
    const r = interpretaRisposta(JSON.stringify(f), LOTTO);
    assert.equal(sel(r).length, 1, JSON.stringify(f));
  }
});

test("interprete: un involucro con un nome qualunque non azzera la risposta", () => {
  for (const chiave of ["immagini", "risultati", "images", "data", "items"]) {
    const testo = JSON.stringify({ [chiave]: [voce(0, { role: "hero" }), voce(1)] });
    const r = interpretaRisposta(testo, LOTTO);
    assert.equal(r.conti.model_items_returned, 2, chiave);
    assert.equal(sel(r).length, 2, chiave);
  }
});

test("interprete: «si», «true» e 1 sono tutti modi di dire di si", () => {
  for (const v of [true, "true", "si", "sì", "yes", 1, "1"]) {
    const r = interpretaRisposta(JSON.stringify([voce(0, { usable: v })]), LOTTO);
    assert.equal(sel(r).length, 1, `«${String(v)}» doveva valere si`);
  }
  // E il no resta un no.
  for (const v of [false, "false", "no", 0]) {
    const r = interpretaRisposta(JSON.stringify([voce(0, { usable: v })]), LOTTO);
    assert.equal(sel(r).length, 0, `«${String(v)}» doveva valere no`);
  }
});

test("interprete: «usable» omesso non esclude, se un ruolo c'e", () => {
  // Il silenzio del modello non e un giudizio negativo: se ha dato un
  // ruolo, la vuole in pagina.
  const testo = JSON.stringify([{ image_index: 0, role: "hero", confidence: 0.9 }]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(sel(r).length, 1);
});

test("interprete: i ruoli detti in italiano si riconoscono", () => {
  const testo = JSON.stringify([
    voce(0, { role: "apertura" }), voce(1, { role: "ambiente" }), voce(2, { role: "dettaglio" }),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(sel(r).length, 3);
  assert.equal(sel(r).find((s) => s.layout_role === "hero")?.candidate_id, "cand00");
});

// ----- Cio che DEVE restare escluso -----------------------------------

test("interprete: «none» e un no, e resta un no", () => {
  const r = interpretaRisposta(JSON.stringify([voce(0, { role: "none" })]), LOTTO);
  assert.equal(sel(r).length, 0);
  // Per identita, non per posizione: nell'elenco vengono prima le
  // fotografie che il modello non ha nemmeno nominato.
  const scartata = r.scelte.find((s) => s.candidate_id === "cand00");
  assert.equal(scartata?.stato, "not_selected", "giudicata e scartata, non «non guardata»");
});

test("interprete: persona riconoscibile e marchio vanno a una persona", () => {
  const testo = JSON.stringify([
    voce(0, { identifiable_person: true }), voce(1, { brand_visible: true }), voce(2),
  ]);
  const r = interpretaRisposta(testo, LOTTO);
  assert.equal(r.conti.needs_review_count, 2);
  assert.deepEqual(
    r.da_rivedere.filter((x) => x.candidate_id === "cand00").map((x) => x.motivo),
    ["possibile_persona_identificabile"],
  );
  assert.deepEqual(
    r.da_rivedere.filter((x) => x.candidate_id === "cand01").map((x) => x.motivo),
    ["possibile_marchio"],
  );
});

test("interprete: una risposta illeggibile non inventa scelte", () => {
  for (const testo of ["", "non e json", "{}", "null", "42"]) {
    const r = interpretaRisposta(testo, LOTTO);
    assert.equal(sel(r).length, 0, testo);
    assert.equal(r.conti.parse_failures, 1, testo);
    // Tutte restano «non guardate», non «scartate»: un giudizio che non
    // c'e stato non si registra come giudizio.
    assert.ok(r.scelte.every((s) => s.stato === "unreviewed"), testo);
  }
});

test("interprete: una fotografia che il modello non nomina resta «non guardata»", () => {
  const r = interpretaRisposta(JSON.stringify([voce(0, { role: "hero" })]), LOTTO);
  const nonViste = r.scelte.filter((s) => s.stato === "unreviewed");
  assert.equal(nonViste.length, 9);
  assert.equal(r.da_rivedere.filter((x) => x.motivo === "analisi_non_disponibile").length, 9);
});

// ----- Le due normalizzazioni, da sole --------------------------------

test("frazione: percentuali convertite, valori illeggibili a null", () => {
  assert.equal(frazione(0.9), 0.9);
  assert.equal(frazione(0), 0);
  assert.equal(frazione(1), 1);
  assert.equal(frazione(90), 0.9);
  assert.equal(frazione(100), 1);
  assert.equal(frazione("0.75"), 0.75);
  // `null`, non `0`: e la differenza fra «non l'ha detto» e «ha detto
  // che non e per niente sicuro».
  for (const v of [undefined, null, "", "boh", NaN, -1, 1000]) {
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
