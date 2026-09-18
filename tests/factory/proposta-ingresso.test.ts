import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_IN_PAGINA, validaScelteInviate } from "../../lib/demo/curatela";
import { messaggioPubblicazione, messaggioValidazione } from "../../lib/demo/messaggi";
import { componiSpec, risolviSpec } from "../../lib/demo/pubblicazione";
import type { CuratelaProgetto, SceltaFoto } from "../../lib/demo/curatela";
import type { FotoDemo } from "../../lib/demo/foto";

// ============================================================
// Cio che arriva dal browser, e cio che l'operatore legge quando
// qualcosa non torna.
//
// La schermata e l'unico posto in cui una persona puo prendere le sue
// decisioni; il corpo della POST e l'unico posto da cui possono
// arrivare. Un rifiuto generico qui costa un'analisi rifatta per un
// motivo che nessuno ha guardato.
// ============================================================

const foto = (id: string, attribuzione = "Rosita"): FotoDemo => ({
  id, indice: 0, src: `/demo/x/foto/0`, larghezza: 1200, altezza: 1600,
  attribuzione, attribuzione_obbligatoria: true,
  display_status: "display_allowed_with_attribution",
  rights_status: "provider_rendered",
});

const DISPONIBILI = ["a", "b", "c"].map((x, i) => ({ ...foto(x), indice: i }));

const scelta = (id: string, ruolo = "detail", order = 0) =>
  ({ candidate_id: id, layout_role: ruolo, order, object_position: "50% 30%" });

// ----- Ingresso --------------------------------------------------------

test("ingresso: zero aperture e ammesso — la pagina si apre con il nome", () => {
  // Prima era un rifiuto. La regola e cambiata guardando una proposta
  // reale: pretendere un'apertura fotografica significa accettarne una
  // qualunque, ed e cosi che in copertina e finito un mucchio di
  // asciugamani.
  const r = validaScelteInviate([scelta("a", "detail"), scelta("b", "interior")], DISPONIBILI);
  assert.ok(Array.isArray(r), String(r));
  assert.equal(r.length, 2);
});

test("ingresso: una selezione buona passa e viene rinumerata", () => {
  const r = validaScelteInviate(
    [scelta("b", "hero", 7), scelta("a", "detail", 2)],
    DISPONIBILI,
  );
  assert.ok(Array.isArray(r), String(r));
  // L'ordine relativo si conserva, i numeri si normalizzano.
  assert.deepEqual(r.map((s) => [s.candidate_id, s.order]), [["a", 0], ["b", 1]]);
});

test("ingresso: ogni rifiuto dice cosa sistemare", () => {
  const casi: [unknown, RegExp][] = [
    [null, /elenco/],
    [[], /nessuna fotografia/],
    [Array.from({ length: MAX_IN_PAGINA + 1 }, () => scelta("a", "hero")), /al massimo/],
    [[scelta("", "hero")], /identificativo/],
    // Una fotografia che nel manifest di adesso non c'e piu: non e un
    // ingresso da correggere, e una fotografia che non esiste.
    [[scelta("sconosciuta", "hero")], /non è più disponibile/],
    [[scelta("a", "hero"), scelta("a", "detail")], /due volte/],
    [[scelta("a", "capolavoro")], /ruolo/],
    [[{ ...scelta("a", "hero"), object_position: "javascript:alert(1)" }], /ritaglio/],
    [[scelta("a", "hero"), scelta("b", "hero")], /più di una fotografia di apertura/],
  ];
  for (const [ingresso, atteso] of casi) {
    const r = validaScelteInviate(ingresso, DISPONIBILI);
    assert.equal(typeof r, "string", `doveva essere rifiutato: ${JSON.stringify(ingresso)}`);
    assert.match(r as string, atteso);
  }
});

test("ingresso: il ritaglio accetta solo percentuali, mai CSS arbitrario", () => {
  for (const pos of ["50% 30%", "0% 100%", "100% 0%"]) {
    assert.ok(Array.isArray(validaScelteInviate([{ ...scelta("a", "hero"), object_position: pos }], DISPONIBILI)), pos);
  }
  for (const pos of ["center", "50px 30px", "50%30%", "url(x)", "50% 30% 10%", "-10% 50%"]) {
    const r = validaScelteInviate([{ ...scelta("a", "hero"), object_position: pos }], DISPONIBILI);
    assert.equal(typeof r, "string", `accettato «${pos}»`);
  }
});

// ----- I messaggi ------------------------------------------------------

const curatela = (scelte: SceltaFoto[]): CuratelaProgetto => ({
  basis_revision: "", manifest_revision: "a|b|c", proposal_revision: "",
  scelte, da_rivedere: [], composta_il: "",
});

const sel = (id: string, ruolo: SceltaFoto["layout_role"]): SceltaFoto => ({
  candidate_id: id, order: 0, layout_role: ruolo,
  object_position: "50% 50%", stato: "selected",
});

test("messaggi: l'apertura sparita si chiama per nome", () => {
  const c = curatela([sel("a", "hero"), sel("b", "detail")]);
  const m = messaggioValidazione(
    { stato: "stale", motivo: "foto_scomparsa", candidate_id: "a" }, c,
  );
  assert.match(m.testo, /in apertura non è più disponibile/i);
  assert.equal(m.bloccante, true);

  // Una qualunque altra fotografia non e «l'apertura»: dirlo manderebbe
  // a cercare nel posto sbagliato.
  const altro = messaggioValidazione(
    { stato: "stale", motivo: "foto_scomparsa", candidate_id: "b" }, c,
  );
  assert.ok(!/apertura/i.test(altro.testo), altro.testo);
});

test("messaggi: l'attribuzione cambiata chiede di rieseguire l'analisi", () => {
  const m = messaggioValidazione(
    { stato: "stale", motivo: "attribuzione_cambiata", candidate_id: "a" },
    curatela([sel("a", "hero")]),
  );
  assert.equal(m.testo, "L'attribuzione della fotografia è cambiata: riesegui l'analisi.");
});

test("messaggi: una fotografia non più mostrabile lo dice, e blocca", () => {
  const m = messaggioValidazione(
    { stato: "stale", motivo: "non_piu_mostrabile", candidate_id: "b" },
    curatela([sel("a", "hero"), sel("b", "detail")]),
  );
  assert.match(m.testo, /non è più utilizzabile nella demo/i);
  assert.equal(m.bloccante, true);
});

test("messaggi: le fotografie nuove NON bloccano", () => {
  const uno = messaggioValidazione({ stato: "valida", outdated: true, nuove: 1 }, null);
  assert.equal(uno.bloccante, false);
  assert.match(uno.testo, /Puoi approvare comunque/);

  const tre = messaggioValidazione({ stato: "valida", outdated: true, nuove: 3 }, null);
  assert.match(tre.testo, /3 fotografie nuove/);

  const pulita = messaggioValidazione({ stato: "valida", outdated: false, nuove: 0 }, null);
  assert.equal(pulita.testo, "", "senza niente da dire non si dice niente");
});

test("messaggi: l'apertura mancante in pagina si dichiara, e non si sostituisce", () => {
  const m = messaggioPubblicazione(1, true);
  assert.match(m, /apertura/i);
  assert.match(m, /Non ne è stata messa un'altra/i);
  assert.equal(messaggioPubblicazione(0, false), "");
});

// ----- La spec pubblicata ---------------------------------------------

test("spec: contiene identita e non indici", () => {
  const c = curatela([sel("a", "hero"), sel("b", "detail")]);
  const spec = componiSpec(c, "tipografia", "NOT_FOUND");
  const testo = JSON.stringify(spec);
  assert.ok(testo.includes("candidate_id"));
  assert.ok(!testo.includes("indice"), testo);
  assert.ok(!testo.includes("/foto/"), "nessun URL congelato nella spec");
});

test("spec: un manifest riordinato non sposta niente in pagina", () => {
  const c = curatela([sel("a", "hero"), sel("b", "detail")]);
  const spec = componiSpec(c, "tipografia", "NOT_FOUND");

  // Places restituisce le stesse foto in ordine rovesciato: gli indici
  // cambiano, le identita no.
  const rovesciate = [
    { ...foto("c"), indice: 0, src: "/demo/x/foto/0" },
    { ...foto("b"), indice: 1, src: "/demo/x/foto/1" },
    { ...foto("a"), indice: 2, src: "/demo/x/foto/2" },
  ];
  const r = risolviSpec(spec, rovesciate);
  assert.deepEqual(r.foto.map((f) => f.id), ["a", "b"]);
  assert.equal(r.foto[0].layout_role, "hero");
  // E l'URL e quello dell'indice di ADESSO, non di allora.
  assert.equal(r.foto[0].src, "/demo/x/foto/2");
});

test("spec: una fotografia sparita viene saltata, mai sostituita", () => {
  const c = curatela([sel("a", "hero"), sel("b", "detail")]);
  const spec = componiSpec(c, "tipografia", "NOT_FOUND");
  const r = risolviSpec(spec, [{ ...foto("b"), indice: 0 }]);

  assert.deepEqual(r.mancanti, ["a"]);
  assert.equal(r.apertura_mancante, true);
  assert.equal(r.foto.length, 1);
  assert.equal(r.foto[0].layout_role, "detail",
    "la seconda fotografia NON deve essere promossa ad apertura");
});
