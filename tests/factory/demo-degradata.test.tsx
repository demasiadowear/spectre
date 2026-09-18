// I CSS Module PRIMA del componente: vedi _ambiente-css.ts.
import { CSS_PRONTO } from "./_ambiente-css";

import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import DiLato from "@/components/demo/DiLato";
import { componiSpec, risolviSpec, statoPubblicazione } from "@/lib/demo/pubblicazione";
import type { CuratelaProgetto, SceltaFoto } from "@/lib/demo/curatela";
import type { FotoDemo } from "@/lib/demo/foto";
import type { Brief } from "@/lib/factory/brief";

// ============================================================
// Cosa succede quando una fotografia PUBBLICATA sparisce.
//
// I riferimenti di Places scadono e le fotografie di una scheda
// cambiano: non e un caso limite, e il funzionamento normale del
// provider. La demo, pero, e gia stata mandata a qualcuno.
//
// DUE POSIZIONI, DUE REGOLE DIVERSE.
//
//  - Una fotografia di GALLERIA che sparisce si salta. La composizione
//    regge: quattro immagini invece di cinque non sono una pagina
//    rotta.
//  - L'APERTURA no. E l'unica posizione in cui saltare significherebbe
//    far salire un'altra fotografia al suo posto, e quella scelta —
//    sulla prima cosa che il prospect vede — non la prende un
//    programma. Quindi la pagina si apre con il NOME.
//
// In entrambi i casi la demo resta raggiungibile. Un 404 o una pagina
// vuota sarebbero peggio del guasto che stanno segnalando.
// ============================================================

assert.equal(CSS_PRONTO, true);

const foto = (id: string, indice: number): FotoDemo => ({
  id, indice, src: `/demo/SLUG/foto/${indice}?w=1200`,
  larghezza: 1200, altezza: 1600,
  attribuzione: "Rosita Buonsante", attribuzione_obbligatoria: true,
  display_status: "display_allowed_with_attribution",
  rights_status: "provider_rendered",
});

const TUTTE = [foto("a", 0), foto("b", 1), foto("c", 2)];

const sel = (id: string, ruolo: SceltaFoto["layout_role"], order: number): SceltaFoto => ({
  candidate_id: id, order, layout_role: ruolo,
  object_position: "50% 30%", stato: "selected",
});

const curatela: CuratelaProgetto = {
  basis_revision: "b", manifest_revision: "a|b|c", proposal_revision: "rev-1",
  scelte: [sel("a", "hero", 0), sel("b", "treatment", 1), sel("c", "interior", 2)],
  da_rivedere: [], composta_il: "",
};

const SPEC = componiSpec(curatela, "tipografia", "NOT_FOUND");

const brief: Brief = {
  lead_id: "lead-1",
  nome: "Collateral Beauty di Rosita Buonsante",
  categoria: "Centro estetico",
  luogo: {
    indirizzo: "Via Prova 12, 70121 Bari BA",
    citta: "Bari",
    maps_url: "https://www.google.com/maps/place/?q=place_id:ChIJprova",
  },
  contatti: { telefono: "080 1234567", email: "" },
  orari: ["Lunedì: 09:00–19:00", "Domenica: chiuso"],
  servizi: [], descrizione: "", social: [], fotografie: [],
  stato: {
    commerciale: "GO", contenuto: "PARTIAL", media: "DISPLAYABLE",
    social: "NONE", opportunita_sito: 90,
  },
  lacune: [],
};

const apertura = { stato: "aperto", fino: "19:00", riapre: "" } as const;
const recensioni = { punteggio: 4.8, totale: 93 };

const rendi = (foto: Parameters<typeof DiLato>[0]["foto"], aperturaTestuale: boolean) =>
  renderToStaticMarkup(
    <DiLato
      brief={brief}
      foto={foto}
      apertura={apertura as never}
      recensioni={recensioni}
      aperturaTestuale={aperturaTestuale}
    />,
  );

// ----- 1. Una fotografia di galleria sparisce ------------------------

test("degradata: una foto di galleria indisponibile viene omessa, la pagina resta valida", () => {
  // «c» non c'e piu. «a» e l'apertura e c'e ancora.
  const disponibili = [foto("a", 0), foto("b", 1)];
  const r = risolviSpec(SPEC, disponibili);

  assert.deepEqual(r.mancanti, ["c"]);
  assert.equal(r.apertura_mancante, false);
  assert.equal(r.foto.length, 2, "la composizione regge con cio che resta");
  // I ruoli NON si riassegnano: «b» resta trattamento, non diventa
  // ambiente perche si e liberato un posto.
  assert.deepEqual(r.foto.map((f) => f.layout_role), ["hero", "treatment"]);

  const html = rendi(r.foto, false);
  assert.match(html, /Collateral Beauty/);
  assert.match(html, /080 1234567/, "la pagina e completa, non un errore");
  assert.ok(html.includes("/demo/SLUG/foto/0"), "l'apertura c'e");
  assert.ok(!html.includes("/demo/SLUG/foto/2"), "la fotografia sparita non compare");
});

// ----- 2. L'apertura sparisce ----------------------------------------

test("degradata: se sparisce l'apertura non ne sale un'altra, e si apre con il nome", () => {
  // «a» — l'apertura — non c'e piu.
  const disponibili = [foto("b", 0), foto("c", 1)];
  const r = risolviSpec(SPEC, disponibili);

  assert.deepEqual(r.mancanti, ["a"]);
  assert.equal(r.apertura_mancante, true);
  assert.ok(
    r.foto.every((f) => f.layout_role !== "hero"),
    "NESSUNA fotografia deve ereditare il ruolo di apertura",
  );

  const html = rendi(r.foto, true);

  // La variante testuale e dichiarata nel markup, non dedotta.
  assert.match(html, /class="hero soloTesto"/);
  // I cinque fatti che l'apertura deve portare.
  assert.match(html, /Collateral Beauty/, "nome");
  assert.match(html, /Centro estetico/, "categoria");
  assert.match(html, /4,8 su/, "punteggio");
  assert.match(html, /93 recensioni/, "recensioni");
  assert.match(html, /Aperto ora, fino alle 19:00/, "stato di apertura");
  assert.match(html, /href="tel:0801234567"/, "CTA telefonica");
  assert.match(html, /Indicazioni su Google Maps/, "CTA mappa");

  // E la demo e comunque raggiungibile e piena: le fotografie rimaste
  // stanno in galleria, non sparisce la pagina.
  assert.ok(html.includes("/demo/SLUG/foto/0"));
  assert.ok(html.includes("/demo/SLUG/foto/1"));
});

test("degradata: nell'apertura testuale non c'e nessuna lastra fotografica", () => {
  const r = risolviSpec(SPEC, [foto("b", 0)]);
  const html = rendi(r.foto, true);
  const heroFinoAllaSezione = html.slice(0, html.indexOf("<section"));
  assert.ok(
    !heroFinoAllaSezione.includes("<img"),
    "una lastra vuota sembrerebbe un'immagine che non si e caricata",
  );
  assert.ok(heroFinoAllaSezione.includes('class="filo"'), "il filo sopra il nome");
});

// ----- 3. Lo stato della pubblicazione --------------------------------

test("degradata: la pubblicazione si marca degraded, e torna ok da sola", () => {
  assert.equal(statoPubblicazione(SPEC, TUTTE), "ok");
  assert.equal(statoPubblicazione(SPEC, [foto("a", 0), foto("b", 1)]), "degraded");
  assert.equal(statoPubblicazione(SPEC, [foto("b", 0), foto("c", 1)]), "degraded");

  // Non e uno stato salvato: se la fotografia ricompare alla raccolta
  // dopo, lo stato torna `ok` senza che nessuno debba ripulire niente.
  assert.equal(statoPubblicazione(SPEC, TUTTE), "ok");
  assert.equal(statoPubblicazione(null, TUTTE), "ok");
});

test("degradata: risolviSpec e statoPubblicazione dicono la stessa cosa", () => {
  for (const disponibili of [TUTTE, [foto("a", 0)], [foto("b", 0), foto("c", 1)], []]) {
    assert.equal(
      risolviSpec(SPEC, disponibili).stato,
      statoPubblicazione(SPEC, disponibili),
      JSON.stringify(disponibili.map((f) => f.id)),
    );
  }
});
