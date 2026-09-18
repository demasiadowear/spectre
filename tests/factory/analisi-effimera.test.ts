import assert from "node:assert/strict";
import { test } from "node:test";

import {
  proponiImpaginazione, richiedeRegimeEffimero, SOGLIA_CONFIDENZA,
  type FotoDaAnalizzare,
} from "../../lib/demo/analisi-effimera";
import {
  CAMPI_SEMANTICI, puoPersistereSemantica, regimeDi, senzaSemantica,
} from "../../lib/demo/policy-media";
import type { RightsStatus } from "../../types/dossier";

// ============================================================
// Due regimi, e una regola che deve reggere anche quando nessuno la
// sta guardando.
//
// Google Maps Platform ToS §3.2.3(c) vieta di «create content based on
// Google Maps Content», con l'esempio «construct an index of tree
// locations within a city from Street View imagery». Costruire un
// indice di soggetti e marchi rilevati nelle fotografie di un Place e
// la stessa operazione con un altro sostantivo.
//
// La difesa non e la revisione del codice: e che per `provider_rendered`
// il tipo restituito NON contiene campi semantici. Questi test
// verificano il risultato vero, perche fra un tipo e il disco c'e
// `JSON.stringify`, che i tipi non li vede.
//
// La modalita NON e dichiarata conforme: e in attesa di risposta
// scritta — docs/GOOGLE-MAPS-PHOTO-CLARIFICATION.md.
// ============================================================

const foto = (indice: number, rights: RightsStatus = "provider_rendered"): FotoDaAnalizzare => ({
  candidate_id: `cand-${indice}`, indice, rights_status: rights,
  carica: async () => ({ base64: "AAAA", mime: "image/jpeg" }),
});

// ----- I due regimi ---------------------------------------------------

test("policy: solo il materiale del cliente consente di conservare la semantica", () => {
  const places: RightsStatus[] = [
    "provider_rendered", "official_public_pending_approval", "unknown", "forbidden",
  ];
  for (const r of places) {
    assert.equal(puoPersistereSemantica(r), false, r);
    assert.equal(regimeDi(r), "provider_rendered", r);
    assert.equal(richiedeRegimeEffimero(r), true, r);
  }
  assert.equal(puoPersistereSemantica("customer_owned"), true);
  assert.equal(regimeDi("customer_owned"), "customer_owned");
  assert.equal(richiedeRegimeEffimero("customer_owned"), false);
});

test("policy: la rete toglie i campi semantici a qualunque profondita", () => {
  const sporco = {
    indice: 3, ordine: 0, object_position: "50% 30%",
    observed_subjects: ["postazione"], ocr: "COLLATERAL BEAUTY",
    annidato: { reasons: ["bella luce"], palette: ["#AABBCC"], ruolo: "hero" },
    lista: [{ description: "x", indice: 4 }],
  };
  const pulito = senzaSemantica(sporco) as Record<string, unknown>;
  const testo = JSON.stringify(pulito);

  for (const k of CAMPI_SEMANTICI) {
    assert.ok(!testo.includes(`"${k}"`), `«${k}» e sopravvissuto: ${testo}`);
  }
  // E quello che serve all'impaginazione resta.
  assert.equal(pulito.indice, 3);
  assert.equal(pulito.object_position, "50% 30%");
  assert.equal((pulito.annidato as Record<string, unknown>).ruolo, "hero");
});

// ----- Cio che esce dall'analisi --------------------------------------

test("analisi: dalla proposta non esce NESSUN campo semantico", async () => {
  // Il test che conta. Senza chiave il modello non gira, ma la forma
  // del risultato e la stessa — ed e la forma che finisce nel database.
  const p = await proponiImpaginazione([foto(0), foto(1)]);
  const testo = JSON.stringify(p);
  for (const k of CAMPI_SEMANTICI) {
    assert.ok(!testo.includes(k), `«${k}» e uscito dalla proposta`);
  }
  // Nemmeno le parole che un modello userebbe per descrivere.
  for (const k of ["soggetto", "descriz", "leggibil", "disordine", "insegna"]) {
    assert.ok(!testo.toLowerCase().includes(k), `«${k}» e uscito: ${testo.slice(0, 200)}`);
  }
});

test("analisi: senza chiave nessuna decisione, e le foto restano unreviewed", async () => {
  const p = await proponiImpaginazione([foto(0), foto(1), foto(2)]);
  assert.equal(p.esito, "non_configurato");
  assert.deepEqual(p.scelte, [], "nessuna scelta inventata");
  assert.equal(p.da_rivedere.length, 3);
  for (const r of p.da_rivedere) assert.equal(r.motivo, "analisi_non_disponibile");
});

test("analisi: una foto che non si scarica resta unreviewed, non not_selected", async () => {
  // Non e stata giudicata inadatta: non e stata giudicata affatto.
  // Trattare un errore di rete come un verdetto estetico e il modo piu
  // silenzioso di buttare via una buona fotografia.
  const rotta: FotoDaAnalizzare = {
    candidate_id: "cand-7", indice: 7, rights_status: "provider_rendered",
    carica: async () => null,
  };
  const p = await proponiImpaginazione([rotta]);
  assert.ok(p.scelte.every((s) => s.stato !== "not_selected"));
  assert.ok(p.da_rivedere.some((r) => r.candidate_id === "cand-7"));
});

test("analisi: nessuna immagine -> nessuna decisione", async () => {
  const p = await proponiImpaginazione([]);
  assert.equal(p.esito, "nessuna_immagine");
  assert.deepEqual(p.scelte, []);
});

test("analisi: il costo si registra, il contenuto no", async () => {
  const p = await proponiImpaginazione([foto(0), foto(1)]);
  assert.equal(p.costo.richieste, 2);
  assert.equal(typeof p.costo.token, "number");
  assert.equal(typeof p.costo.ms, "number");
  assert.ok(p.modello.length > 0);
  // Il costo non porta con se niente dell'immagine.
  assert.deepEqual(Object.keys(p.costo).sort(),
    ["analizzate", "fallite", "ms", "richieste", "token"]);
});

test("analisi: la soglia di confidenza manda a una persona, non a un verdetto", () => {
  assert.ok(SOGLIA_CONFIDENZA > 0 && SOGLIA_CONFIDENZA < 1);
});
