import assert from "node:assert/strict";
import { test } from "node:test";

import {
  proponiImpaginazione, richiedeRegimeEffimero, SOGLIA_CONFIDENZA,
  type FotoDaAnalizzare,
} from "../../lib/demo/analisi-effimera";
import {
  CAMPI_SEMANTICI, puoPersistereSemantica, regimeDi, senzaSemantica,
} from "../../lib/demo/policy-media";
import {
  applicaCuratela, puoGenerare, revisioneManifest, validitaProposta,
  MAX_IN_PAGINA, type CuratelaProgetto,
} from "../../lib/demo/curatela";
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
  indice, rights_status: rights,
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
    indice: 7, rights_status: "provider_rendered", carica: async () => null,
  };
  const p = await proponiImpaginazione([rotta]);
  assert.ok(p.scelte.every((s) => s.stato !== "not_selected"));
  assert.ok(p.da_rivedere.some((r) => r.indice === 7));
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

// ----- La curatela salvata -------------------------------------------

const curatela = (over: Partial<CuratelaProgetto> = {}): CuratelaProgetto => ({
  scelte: [
    { indice: 2, ordine: 0, ruolo: "hero", object_position: "50% 30%", stato: "selected" },
    { indice: 5, ordine: 1, ruolo: "treatment", object_position: "40% 25%", stato: "selected" },
    { indice: 9, ordine: 9, ruolo: "detail", object_position: "50% 50%", stato: "not_selected" },
  ],
  da_rivedere: [], composta_il: "2026-09-18T12:00:00Z",
  media_manifest_revision: "x",
  ...over,
});

test("curatela: si conserva impaginazione, mai il perche", () => {
  const testo = JSON.stringify(curatela());
  for (const k of CAMPI_SEMANTICI) assert.ok(!testo.includes(k), k);
  // I quattro campi ammessi, e nessun altro.
  for (const s of curatela().scelte) {
    assert.deepEqual(Object.keys(s).sort(),
      ["indice", "object_position", "ordine", "ruolo", "stato"]);
  }
});

test("curatela: `unreviewed` non e un giudizio, e l'assenza di un giudizio", () => {
  // Il difetto che avevo introdotto: `exclude` come default. Dire
  // «esclusa» di un'immagine che nessuno ha guardato e la stessa specie
  // di errore che dire «non ha social» di un profilo mai aperto.
  const c = curatela({
    scelte: [{ indice: 0, ordine: 999, ruolo: "detail", object_position: "50% 50%", stato: "unreviewed" }],
  });
  assert.equal(applicaCuratela([], c).length, 0, "una foto mai vista non va in pagina");
  const g = puoGenerare(c, false);
  assert.equal(g.ok, false);
  assert.ok(/apertura|selezionata/i.test(g.motivo), g.motivo);
});

test("curatela: la generazione si ferma quando non sa, e dice quale non sa", () => {
  assert.equal(puoGenerare(null, false).ok, false);

  const senzaHero = curatela({
    scelte: [{ indice: 1, ordine: 0, ruolo: "treatment", object_position: "50% 50%", stato: "selected" }],
  });
  assert.equal(puoGenerare(senzaHero, false).ok, false);

  const heroDaRivedere = curatela({
    scelte: [{ indice: 1, ordine: 0, ruolo: "hero", object_position: "50% 50%", stato: "needs_review" }],
  });
  assert.equal(puoGenerare(heroDaRivedere, false).ok, false);

  // Brand inconcludente ferma anche una curatela perfetta.
  assert.equal(puoGenerare(curatela(), true).ok, false);
  assert.equal(puoGenerare(curatela(), false).ok, true);
});

test("curatela: al massimo cinque, e non si riempie per arrivarci", () => {
  const foto = Array.from({ length: 9 }, (_, i) => ({
    id: `f${i}`, indice: i, src: `/x/${i}`, larghezza: 1200, altezza: 1600,
    attribuzione: "Rosita", attribuzione_obbligatoria: true,
  }));
  const rev = revisioneManifest(foto);

  const molte = curatela({
    media_manifest_revision: rev,
    scelte: Array.from({ length: 9 }, (_, i) => ({
      indice: i, ordine: i, ruolo: "detail" as const,
      object_position: "50% 50%", stato: "selected" as const,
    })),
  });
  assert.equal(applicaCuratela(foto, molte).length, MAX_IN_PAGINA);

  // Tre selezionate restano tre: non si pesca fra le scartate.
  const tre = curatela({
    media_manifest_revision: rev,
    scelte: [0, 1, 2].map((i) => ({
      indice: i, ordine: i, ruolo: "detail" as const,
      object_position: "50% 50%", stato: "selected" as const,
    })).concat([{ indice: 8, ordine: 8, ruolo: "detail", object_position: "50% 50%", stato: "not_selected" }] as never),
  });
  assert.equal(applicaCuratela(foto, tre).length, 3);
});

test("curatela: la revisione cambia se cambia quale foto sta a quale indice", () => {
  const a = [{ indice: 0, id: "x" }];
  const b = [{ indice: 0, id: "y" }];
  assert.notEqual(revisioneManifest(a), revisioneManifest(b));
  assert.equal(revisioneManifest(a), revisioneManifest(a.slice()));
  // La revisione non contiene niente dell'immagine: solo indice e id.
  assert.equal(revisioneManifest(a), "0:x");
});

// ----- IL TEST CRITICO: l'indice non e stabile ------------------------

test("stale: una proposta della revisione 1 non deve MAI applicarsi alla revisione 2", () => {
  // Il difetto che questo test esiste per impedire, ed e il piu
  // pericoloso di tutta la fase perche NON SEMBRA UN ERRORE: la pagina
  // si costruisce, le immagini si caricano, e in apertura c'e una
  // fotografia che nessuno ha scelto.
  //
  // Dopo una nuova raccolta, Places puo restituire le stesse dieci
  // fotografie in un altro ordine. «Indice 3» ieri era la foto A, oggi
  // e la foto B. Una proposta salvata come «indice 3 in posizione hero»
  // applicata al manifest nuovo mette in hero la B.
  const fotoDi = (id: string, indice: number) => ({
    id, indice, src: `/demo/S/foto/${indice}`, larghezza: 1200, altezza: 1600,
    attribuzione: "Rosita", attribuzione_obbligatoria: true,
  });

  // Revisione 1: all'indice 3 c'e la foto A.
  const rev1 = [fotoDi("foto-A", 3), fotoDi("foto-Z", 4)];
  // Revisione 2: all'indice 3 c'e la foto B. Stessa posizione, altra
  // immagine.
  const rev2 = [fotoDi("foto-B", 3), fotoDi("foto-Z", 4)];

  const r1 = revisioneManifest(rev1);
  const r2 = revisioneManifest(rev2);
  assert.notEqual(r1, r2, "due manifest diversi non possono avere la stessa revisione");

  const proposta: CuratelaProgetto = {
    media_manifest_revision: r1,
    scelte: [{ indice: 3, ordine: 0, ruolo: "hero", object_position: "50% 30%", stato: "selected" }],
    da_rivedere: [], composta_il: "2026-09-18T12:00:00Z",
  };

  // Sulla revisione su cui e stata composta, si applica e prende la A.
  const suRev1 = applicaCuratela(rev1, proposta);
  assert.equal(validitaProposta(proposta, r1), "valida");
  assert.equal(suRev1.length, 1);
  assert.equal(suRev1[0].id, "foto-A");

  // Sulla revisione nuova: STALE, e non si applica affatto.
  assert.equal(validitaProposta(proposta, r2), "stale");
  const suRev2 = applicaCuratela(rev2, proposta);
  // La garanzia che conta davvero: la foto B non compare MAI.
  assert.ok(!suRev2.some((f) => f.id === "foto-B"),
    "la proposta della revisione 1 ha raggiunto la fotografia della revisione 2");
  assert.equal(suRev2.length, 0, "una proposta stale non si applica nemmeno in parte");
});

test("stale: si scarta tutta, non «per quel che si puo»", () => {
  // Applicarne la meta sarebbe peggio del rifiuto: la pagina si
  // costruirebbe con alcune fotografie scelte e altre no, e nessuno
  // saprebbe quali.
  const f = (id: string, indice: number) => ({
    id, indice, src: "", larghezza: 1200, altezza: 1600,
    attribuzione: "", attribuzione_obbligatoria: false,
  });
  const vecchio = [f("A", 0), f("B", 1), f("C", 2)];
  const nuovo = [f("A", 0), f("B", 1), f("D", 2)];  // solo l'ultima cambia

  const proposta: CuratelaProgetto = {
    media_manifest_revision: revisioneManifest(vecchio),
    scelte: [
      { indice: 0, ordine: 0, ruolo: "hero", object_position: "50% 50%", stato: "selected" },
      { indice: 1, ordine: 1, ruolo: "treatment", object_position: "50% 50%", stato: "selected" },
    ],
    da_rivedere: [], composta_il: "",
  };
  // Le prime due fotografie sono identiche, ma la proposta si scarta
  // lo stesso: la revisione e dell'intero manifest, non per immagine.
  assert.deepEqual(applicaCuratela(nuovo, proposta), []);
});

test("stale: senza proposta, `assente` e non `stale`", () => {
  // Sono due cose diverse: una va composta, l'altra va ricomposta.
  assert.equal(validitaProposta(null, "qualunque"), "assente");
});
