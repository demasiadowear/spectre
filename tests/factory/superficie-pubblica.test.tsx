// I CSS Module PRIMA del componente: vedi _ambiente-css.ts.
import { CSS_PRONTO } from "./_ambiente-css";

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import DiLato from "@/components/demo/DiLato";
import { componiSpec, risolviSpec } from "@/lib/demo/pubblicazione";
import type { CuratelaProgetto, SceltaFoto } from "@/lib/demo/curatela";
import type { FotoDemo } from "@/lib/demo/foto";
import type { Brief } from "@/lib/factory/brief";

// ============================================================
// Cosa arriva a chi non ha una sessione.
//
// `/demo/<slug>` sta FUORI dal middleware: deve, altrimenti il prospect
// non vede la pagina. Quindi tutto cio che la pagina rende e pubblico
// per chiunque abbia lo slug — compreso, un domani, il prospect stesso
// che apre gli strumenti per sviluppatori.
//
// TRE COSE NON DEVONO USCIRE, E NESSUNA E OVVIA:
//
//  1. `candidate_id`. E l'identita interna con cui l'operatore rimanda
//     indietro le scelte. Pubblicarla non apre una porta da sola, ma da
//     a chi guarda un nome stabile per una fotografia che noi trattiamo
//     come opaca — e il primo passo perche qualcuno provi a usarlo.
//  2. `provider_reference`. Quello si: e il nome con cui si chiede una
//     fotografia a Google con la nostra chiave.
//  3. Le revisioni e lo stato della curatela. Dicono quante fotografie
//     abbiamo guardato, quante scartate e perche: sono il nostro
//     giudizio sul materiale di un'attivita, e non sono affari di
//     nessun altro.
//
// Il controllo e su due piani: cosa c'e nel markup reso, e cosa le
// rotte pubbliche possono restituire per costruzione.
// ============================================================

assert.equal(CSS_PRONTO, true);

const RADICE = join(__dirname, "..", "..");

const foto = (id: string, indice: number): FotoDemo => ({
  id, indice, src: `/demo/SLUG/foto/${indice}?w=1200`,
  larghezza: 1200, altezza: 1600,
  attribuzione: "Rosita Buonsante", attribuzione_obbligatoria: true,
  display_status: "display_allowed_with_attribution",
  rights_status: "provider_rendered",
});

/** Identificativi riconoscibili: se uno di questi finisce nel markup,
 *  il test lo trova invece di doverlo cercare a occhio. */
const IDENTITA = ["c0ffee0000000001", "c0ffee0000000002", "c0ffee0000000003"];

const sel = (id: string, ruolo: SceltaFoto["layout_role"], order: number): SceltaFoto => ({
  candidate_id: id, order, layout_role: ruolo,
  object_position: "50% 30%", stato: "selected",
});

const curatela: CuratelaProgetto = {
  basis_revision: "BASE-SEGRETA-12345",
  manifest_revision: "MANIFEST-SEGRETO-67890",
  proposal_revision: "REVISIONE-SEGRETA-abc",
  scelte: [
    sel(IDENTITA[0], "hero", 0),
    sel(IDENTITA[1], "treatment", 1),
    sel(IDENTITA[2], "interior", 2),
  ],
  da_rivedere: [{ candidate_id: IDENTITA[2], motivo: "possibile_marchio" }],
  composta_il: "",
};

const brief: Brief = {
  lead_id: "lead-1",
  nome: "Collateral Beauty di Rosita Buonsante",
  categoria: "Centro estetico",
  luogo: {
    indirizzo: "Via Prova 12, 70121 Bari BA", citta: "Bari",
    maps_url: "https://www.google.com/maps/place/?q=place_id:ChIJprova",
  },
  contatti: { telefono: "080 1234567", email: "" },
  orari: ["Lunedì: 09:00–19:00"],
  servizi: [], descrizione: "", social: [], fotografie: [],
  stato: {
    commerciale: "GO", contenuto: "PARTIAL", media: "DISPLAYABLE",
    social: "NONE", opportunita_sito: 90,
  },
  lacune: [],
};

const rendi = (aperturaTestuale: boolean) => {
  const disponibili = IDENTITA.map((id, i) => foto(id, i));
  const spec = componiSpec(curatela, "tipografia", "NOT_FOUND");
  const r = risolviSpec(
    spec,
    aperturaTestuale ? disponibili.slice(1) : disponibili,
  );
  return renderToStaticMarkup(
    <DiLato
      brief={brief}
      foto={r.foto}
      apertura={{ stato: "aperto", fino: "19:00", riapre: "" } as never}
      recensioni={{ punteggio: 4.8, totale: 93 }}
      aperturaTestuale={aperturaTestuale}
    />,
  );
};

test("pubblico: la demo non rende nessun candidate_id", () => {
  for (const testuale of [false, true]) {
    const html = rendi(testuale);
    for (const id of IDENTITA) {
      assert.ok(!html.includes(id), `candidate_id nel markup (testuale=${testuale}): ${id}`);
    }
  }
});

test("pubblico: la demo non rende revisioni, stati di curatela ne motivi di revisione", () => {
  for (const testuale of [false, true]) {
    const html = rendi(testuale);
    for (const segreto of [
      "BASE-SEGRETA", "MANIFEST-SEGRETO", "REVISIONE-SEGRETA",
      "possibile_marchio", "needs_review", "not_selected", "unreviewed",
      "basis_revision", "manifest_revision", "proposal_revision",
      "display_status", "rights_status", "provider_rendered",
      "layout_role", "candidate_id",
    ]) {
      assert.ok(!html.includes(segreto), `«${segreto}» nel markup (testuale=${testuale})`);
    }
  }
});

test("pubblico: la demo non rende nessun riferimento del provider", () => {
  const html = rendi(false);
  assert.ok(!html.includes("places/"), "riferimento Places nel markup");
  assert.ok(!html.includes("googleapis.com"), "il browser non deve parlare col provider");
  assert.ok(!/[?&]key=/i.test(html), "nessuna chiave nel markup");
  // Le fotografie passano dal nostro indirizzo, e il nome e un indice.
  assert.ok(html.includes("/demo/SLUG/foto/0"));
});

// ----- Cosa possono restituire le rotte pubbliche ---------------------

/** Le uniche rotte fuori dal middleware che toccano questo lavoro.
 *  L'elenco e quello del `matcher` in middleware.ts. */
const ROTTE_PUBBLICHE = [
  "app/demo/[slug]/page.tsx",
  "app/demo/[slug]/foto/[indice]/route.ts",
];

test("pubblico: la rotta delle fotografie non restituisce nessun JSON", () => {
  // Non e una questione di cosa ci mettiamo dentro: quella rotta non ha
  // un corpo JSON da riempire. Restituisce byte, 404 o 503, e basta.
  const src = readFileSync(join(RADICE, ROTTE_PUBBLICHE[1]), "utf8");
  assert.ok(!src.includes("NextResponse.json"), "la rotta delle foto non deve avere un corpo JSON");
  assert.ok(!src.includes("leggiProposta"), "non deve nemmeno leggere la proposta");
});

test("pubblico: nessuna rotta pubblica serializza dossier, proposta o manifest", () => {
  for (const f of ROTTE_PUBBLICHE) {
    const src = readFileSync(join(RADICE, f), "utf8");
    for (const proibito of [
      "JSON.stringify(dossier", "JSON.stringify(salvato", "JSON.stringify(spec",
      "JSON.stringify(proposta", "JSON.stringify(curata",
      "dangerouslySetInnerHTML",
    ]) {
      assert.ok(!src.includes(proibito), `«${proibito}» in ${f}`);
    }
  }
});

test("pubblico: le rotte del provino e del comando restano dietro la sessione", () => {
  // Il `matcher` protegge tutto tranne un elenco chiuso. Se una di
  // queste finisse in quell'elenco, il provino — che contiene i
  // candidate_id e il nostro giudizio su ogni fotografia — diventerebbe
  // pubblico senza che nessuno cambi una riga di quelle rotte.
  const mw = readFileSync(join(RADICE, "middleware.ts"), "utf8");
  for (const rotta of ["api/demo", "demo/proposta", "demo/analizza", "demo/approva"]) {
    assert.ok(!mw.includes(rotta), `«${rotta}» compare nel middleware: verifica che non sia un'eccezione`);
  }
  // E nessuna di loro e fra le rotte che il cron puo aprire col bearer.
  const cron = /const CRON_PATHS = \[([\s\S]*?)\]/.exec(mw)?.[1] ?? "";
  assert.ok(!cron.includes("demo"), `una rotta demo e fra quelle del cron: ${cron}`);
});
