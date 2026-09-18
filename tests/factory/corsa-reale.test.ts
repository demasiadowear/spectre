import assert from "node:assert/strict";
import { test } from "node:test";

import { interpretaRisposta, type FotoDaAnalizzare } from "../../lib/demo/analisi-effimera";
import { valutaProposta } from "../../lib/demo/curatela";

// ============================================================
// LA CORSA REALE, RIGIOCATA.
//
// Dieci fotografie di un centro estetico. La proposta prodotta in
// produzione: UNA fotografia in pagina, la n.5, in APERTURA, e il suo
// contenuto erano asciugamani ammassati.
//
// Le osservazioni vere non le ho: sono effimere e non si registrano,
// ed e una scelta di progetto, non una dimenticanza. Quello che ho e
// cio che si e visto in pagina e nel pannello — quali foto escluse, con
// quale motivo, quale in apertura — piu gli screenshot.
//
// Quindi qui non rigioco UNA ipotesi: rigioco la descrizione
// dichiarata degli screenshot, e poi la stessa serie con la n.5
// descritta nel modo PIU FAVOREVOLE possibile, compreso il caso in cui
// il modello la etichetti male. Se non apre nemmeno cosi, non e una
// soglia fortunata: e una proprieta.
// ============================================================

const LOTTO: FotoDaAnalizzare[] = Array.from({ length: 10 }, (_, i) => ({
  candidate_id: `n${i}`,
  indice: i,
  rights_status: "provider_rendered" as const,
  carica: async () => null,
}));

const sel = (r: ReturnType<typeof interpretaRisposta>) =>
  r.scelte.filter((s) => s.stato === "selected");
const rev = (r: ReturnType<typeof interpretaRisposta>) =>
  r.scelte.filter((s) => s.stato === "needs_visual_review");
const apertura = (r: ReturnType<typeof interpretaRisposta>) =>
  sel(r).find((s) => s.layout_role === "hero")?.candidate_id ?? "";

/**
 * La serie, descritta come sta negli screenshot:
 *
 *   n.0, n.3, n.4  ambienti
 *   n.1, n.2       ambienti con il marchio «Academy» in campo
 *   n.5            tessili ammassati
 *   n.6            dettaglio di trattamento
 *   n.7, n.8       trattamenti sul viso, persona riconoscibile
 *   n.9            inquadratura inclinata verso il soffitto
 */
const SERIE = [
  // n.0 porta un marchio INCIDENTALE, come nella corsa vera. E il caso
  // che ha smentito la mia prima regola: «nessun marchio in apertura»
  // avrebbe escluso proprio l'ambiente migliore.
  { image_index: 0, content_kind: "clean_interior", commercial_appeal: 0.72, clutter: 0.25,
    quality: 0.78, subject_legible: true, focus_x: 0.5, focus_y: 0.45,
    confidence: 0.88, identifiable_person: false, brand_observation: "incidental_mark" },
  { image_index: 1, content_kind: "clean_interior", commercial_appeal: 0.66, clutter: 0.3,
    quality: 0.75, subject_legible: true, focus_x: 0.5, focus_y: 0.5,
    confidence: 0.85, identifiable_person: false, brand_observation: "incidental_mark" },
  { image_index: 2, content_kind: "clean_interior", commercial_appeal: 0.64, clutter: 0.32,
    quality: 0.72, subject_legible: true, focus_x: 0.45, focus_y: 0.5,
    confidence: 0.84, identifiable_person: false, brand_observation: "incidental_mark" },
  { image_index: 3, content_kind: "clean_interior", commercial_appeal: 0.70, clutter: 0.28,
    quality: 0.76, subject_legible: true, focus_x: 0.5, focus_y: 0.48,
    confidence: 0.86, identifiable_person: false, brand_observation: "none" },
  { image_index: 4, content_kind: "clean_interior", commercial_appeal: 0.69, clutter: 0.3,
    quality: 0.74, subject_legible: true, focus_x: 0.52, focus_y: 0.47,
    confidence: 0.85, identifiable_person: false, brand_observation: "none" },
  { image_index: 5, content_kind: "linen", commercial_appeal: 0.95, clutter: 0.6,
    quality: 0.9, subject_legible: true, focus_x: 0.5, focus_y: 0.5,
    confidence: 0.99, identifiable_person: false, brand_observation: "none" },
  // n.6 e un DETTAGLIO ravvicinato — guanto, apparecchiatura, prodotto —
  // non una scena. E la distinzione che mancava: sostituire gli
  // asciugamani con un primo piano di guanto e sostituire un soggetto
  // sbagliato con un altro soggetto sbagliato.
  { image_index: 6, content_kind: "treatment_detail", commercial_appeal: 0.80, clutter: 0.2,
    quality: 0.82, subject_legible: true, focus_x: 0.5, focus_y: 0.45,
    confidence: 0.9, identifiable_person: false, brand_observation: "incidental_mark" },
  { image_index: 7, content_kind: "person_treatment", commercial_appeal: 0.85, clutter: 0.2,
    quality: 0.85, subject_legible: true, focus_x: 0.5, focus_y: 0.4,
    confidence: 0.92, identifiable_person: true, brand_observation: "none" },
  { image_index: 8, content_kind: "person_treatment", commercial_appeal: 0.84, clutter: 0.22,
    quality: 0.83, subject_legible: true, focus_x: 0.5, focus_y: 0.42,
    confidence: 0.91, identifiable_person: true, brand_observation: "none" },
  { image_index: 9, content_kind: "ceiling", commercial_appeal: 0.35, clutter: 0.4,
    quality: 0.6, subject_legible: false, focus_x: 0.5, focus_y: 0.85,
    confidence: 0.7, identifiable_person: false, brand_observation: "none" },
];

test("corsa reale: la n.5 non e in pagina e non e l'apertura", () => {
  const r = interpretaRisposta(JSON.stringify(SERIE), LOTTO);

  assert.equal(sel(r).some((s) => s.candidate_id === "n5"), false, "i tessili restano fuori");
  assert.notEqual(apertura(r), "n5");
  assert.deepEqual(
    r.da_rivedere.filter((x) => x.candidate_id === "n5").map((x) => x.motivo),
    ["genere_non_utilizzabile"],
  );
});

test("corsa reale: la n.9 esce come soffitto", () => {
  const r = interpretaRisposta(JSON.stringify(SERIE), LOTTO);
  assert.equal(sel(r).some((s) => s.candidate_id === "n9"), false);
  assert.deepEqual(
    r.da_rivedere.filter((x) => x.candidate_id === "n9").map((x) => x.motivo),
    ["genere_non_utilizzabile"],
  );
});

test("corsa reale: n.0, n.3 e n.4 sono considerate come ambiente", () => {
  const r = interpretaRisposta(JSON.stringify(SERIE), LOTTO);
  const dentro = sel(r).map((s) => s.candidate_id);
  for (const id of ["n0", "n3", "n4"]) {
    assert.ok(dentro.indexOf(id) !== -1, `${id} doveva essere considerata`);
  }
});

test("corsa reale: n.6 entra in galleria e NON apre", () => {
  const r = interpretaRisposta(JSON.stringify(SERIE), LOTTO);
  assert.equal(sel(r).some((s) => s.candidate_id === "n6"), true, "va in galleria");
  assert.notEqual(apertura(r), "n6", "un dettaglio ravvicinato non e l'immagine identitaria");
});

test("corsa reale: apre la n.0, ambiente pulito, marchio incidentale compreso", () => {
  // n.1 e n.2 sono ambienti anche loro, con lo stesso marchio
  // incidentale: sono alternative legittime, e n.0 le batte sul
  // richiamo. Un marchio incidentale non toglie e non aggiunge.
  const r = interpretaRisposta(JSON.stringify(SERIE), LOTTO);
  assert.equal(apertura(r), "n0");
});

test("corsa reale: n.3 e n.4 sono le alternative di ambiente", () => {
  // Tolta la n.0, l'apertura passa alla successiva per richiamo — non
  // a un dettaglio e non a una foto con un marchio in campo.
  const senzaZero = SERIE.filter((v) => v.image_index !== 0);
  const r = interpretaRisposta(JSON.stringify(senzaZero), LOTTO);
  assert.equal(apertura(r), "n3");
});

test("corsa reale: n.7 e n.8 sono marcate per revisione persona, non escluse", () => {
  const r = interpretaRisposta(JSON.stringify(SERIE), LOTTO);
  const inRevisione = rev(r).map((s) => s.candidate_id);
  assert.ok(inRevisione.indexOf("n7") !== -1);
  assert.ok(inRevisione.indexOf("n8") !== -1);
  for (const id of ["n7", "n8"]) {
    assert.deepEqual(
      r.da_rivedere.filter((x) => x.candidate_id === id).map((x) => x.motivo),
      ["possibile_persona_identificabile"],
      id,
    );
  }
});

test("corsa reale: n.1 e n.2 non sono bloccate dal marchio incidentale", () => {
  const r = interpretaRisposta(JSON.stringify(SERIE), LOTTO);
  for (const id of ["n1", "n2"]) {
    assert.equal(
      r.da_rivedere.some((x) => x.candidate_id === id), false,
      `${id}: «Academy» incidentale non e un motivo`,
    );
  }
});

test("corsa reale: la proposta e completa, 3-5 fotografie", () => {
  const r = interpretaRisposta(JSON.stringify(SERIE), LOTTO);
  const v = valutaProposta(r.scelte);
  assert.ok(v.selezionate >= 3 && v.selezionate <= 5, `selezionate: ${v.selezionate}`);
  assert.equal(v.proposal_status, "complete");
  assert.equal(v.codice, "");
  assert.equal(v.apertura, true);
});

// ----- La prova che non dipende da come viene descritta ---------------

test("corsa reale: la n.5 non apre NEMMENO se il modello la descrive nel modo migliore", () => {
  // Tutti i numeri al massimo. Se il gate fosse solo soglie, passerebbe.
  const massima = {
    ...SERIE[5], commercial_appeal: 1, clutter: 0, quality: 1,
    subject_legible: true, focus_x: 0.5, focus_y: 0.5, confidence: 1,
  };
  const r = interpretaRisposta(
    JSON.stringify(SERIE.map((v) => (v.image_index === 5 ? massima : v))), LOTTO,
  );
  assert.equal(sel(r).some((s) => s.candidate_id === "n5"), false);
  assert.notEqual(apertura(r), "n5");
});

test("corsa reale: un genere sbagliato e il limite del sistema, e si dice", () => {
  // IL PUNTO IN CUI QUESTO SISTEMA NON PUO ARRIVARE.
  //
  // Il gate legge un'osservazione. Se il modello chiama `clean_interior`
  // un mucchio di asciugamani E gli da il richiamo piu alto, niente a
  // valle puo saperlo: ogni campo su cui deciderei viene dalla stessa
  // fonte che ha mentito. Non esiste una soglia che salvi da una
  // descrizione coerente e falsa.
  //
  // Questo test non finge il contrario: fissa cosa RESTA garantito.
  const travestita = {
    ...SERIE[5], content_kind: "clean_interior", clutter: 0.2, commercial_appeal: 0.95,
  };
  const r = interpretaRisposta(
    JSON.stringify(SERIE.map((v) => (v.image_index === 5 ? travestita : v))), LOTTO,
  );

  // Cio che il modello NON puo piu fare: escludere le altre. La pagina
  // ha comunque la sua sequenza, e l'operatore ha davanti tutto il
  // materiale buono per cambiare l'apertura con un click.
  const dentro = sel(r).map((s) => s.candidate_id);
  for (const id of ["n0", "n3"]) {
    assert.ok(dentro.indexOf(id) !== -1, `${id} deve restare disponibile`);
  }
  assert.ok(sel(r).length >= 3, "la proposta resta una pagina");

  // E basta che UNA delle tre descrizioni sia onesta perche il danno
  // non avvenga: se il disordine e dichiarato per quello che e, il gate
  // la ferma comunque.
  const conDisordineVero = { ...travestita, clutter: 0.6 };
  const r2 = interpretaRisposta(
    JSON.stringify(SERIE.map((v) => (v.image_index === 5 ? conDisordineVero : v))), LOTTO,
  );
  assert.equal(apertura(r2), "n0", "un solo campo onesto basta a fermarla");
});

test("corsa reale: nessun ordine di risposta cambia il risultato", () => {
  // Il compositore non dipende dall'ordine in cui il modello elenca.
  const atteso = interpretaRisposta(JSON.stringify(SERIE), LOTTO);
  const rovesciata = interpretaRisposta(JSON.stringify(SERIE.slice().reverse()), LOTTO);
  assert.equal(apertura(rovesciata), apertura(atteso));
  assert.deepEqual(
    sel(rovesciata).map((s) => s.candidate_id).sort(),
    sel(atteso).map((s) => s.candidate_id).sort(),
  );
});
