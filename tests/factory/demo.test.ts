import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INDICE_FOTO, fotoMostrabili, riferimentoPerIndice,
} from "../../lib/demo/foto";
import { adessoARoma, leggiRiga, statoApertura } from "../../lib/demo/orari";
import type { BusinessDossier, MediaCandidate } from "../../types/dossier";

// ============================================================
// La demo si apre SENZA login: deve, altrimenti il prospect non la
// vede. Il che rende la rotta delle fotografie l'unico punto del
// sistema dove una richiesta non autenticata fa usare la nostra chiave
// Google.
//
// Se accettasse un riferimento scelto da chi chiama sarebbe un proxy
// pubblico: chiunque trovasse uno slug potrebbe farci scaricare le
// fotografie di qualunque attivita, a nostre spese.
//
// Il client non nomina mai una fotografia: manda un INDICE, e il
// server lo risolve dentro il manifest di QUEL progetto. L'insieme di
// cio che si puo chiedere e l'insieme di cio che si puo mostrare.
// ============================================================

const foto = (
  id: string,
  display: MediaCandidate["display_status"],
  ref = `places/P/photos/${id}`,
): MediaCandidate => ({
  id, source_url: "", source_page: "", platform: "google_maps",
  copyright_owner: "", attribution: "Rosita", observed_at: "", sha256: "",
  perceptual_hash: "", width: 1200, height: 1600, format: "", filesize: 0,
  orientation: "portrait", probable_role: "unknown", quality_score: 90,
  relevance_score: 80, duplicate_group: "", people_present: false,
  rights_status: "provider_rendered", allowed_scope: "preview_only",
  display_status: display, storage_status: "do_not_store",
  expires_at: "", provider_reference: ref, rejected_reason: "",
});

const dossierCon = (candidates: MediaCandidate[], approved: string[] = []): BusinessDossier =>
  ({ media: { candidates, approved_ids: approved } } as unknown as BusinessDossier);

// ----- L'unico ingresso ---------------------------------------------

test("foto: si accetta un indice, e nient'altro", () => {
  // Tutto cio che `Number()` tollererebbe ma non e un indice.
  for (const x of ["", " ", "-1", "+1", "1e2", "1.0", "0x1", "١", "100",
    "places/P/photos/X", "https://example.com/a.jpg", "../../etc/passwd"]) {
    assert.equal(INDICE_FOTO.test(x), false, `accettato «${x}»`);
  }
  for (const x of ["0", "3", "09", "42"]) assert.equal(INDICE_FOTO.test(x), true, x);
});

test("foto: un riferimento del progetto si risolve", () => {
  const d = dossierCon([foto("a", "display_allowed_with_attribution")]);
  const r = riferimentoPerIndice(d, "0");
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.riferimento, "places/P/photos/a");
});

test("foto: un riferimento di UN ALTRO progetto non e raggiungibile", () => {
  // Il caso che conta, e la ragione per cui il client manda un indice:
  // non esiste un modo di NOMINARE la fotografia di un altro dossier.
  // Chiedere l'indice 0 su questo progetto risolve la fotografia di
  // QUESTO progetto, sempre.
  const mio = dossierCon([foto("mia", "display_allowed_with_attribution", "places/MIO/photos/x")]);
  const altrui = dossierCon([foto("sua", "display_allowed_with_attribution", "places/ALTRUI/photos/y")]);

  const r = riferimentoPerIndice(mio, "0");
  assert.equal(r.ok && r.riferimento, "places/MIO/photos/x");
  assert.notEqual(r.ok && r.riferimento, "places/ALTRUI/photos/y");

  const s = riferimentoPerIndice(altrui, "0");
  assert.notEqual(s.ok && s.riferimento, r.ok && r.riferimento,
    "lo stesso indice su due progetti non deve poter dare la stessa fotografia");
});

test("foto: un URL arbitrario non e un indice", () => {
  const d = dossierCon([foto("a", "display_allowed_with_attribution")]);
  for (const x of [
    "https://lh3.googleusercontent.com/p/AAA",
    "places/ChIJaltro/photos/AVoNoX",
    "http://169.254.169.254/latest/meta-data/",
    "0/../1",
  ]) {
    const r = riferimentoPerIndice(d, x);
    assert.equal(r.ok, false, `accettato «${x}»`);
    assert.equal(r.ok === false && r.motivo, "indice_non_valido");
  }
});

test("foto: un indice fuori intervallo non e una fotografia", () => {
  const d = dossierCon([foto("a", "display_allowed_with_attribution")]);
  const r = riferimentoPerIndice(d, "7");
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.motivo, "fuori_intervallo");
});

test("foto: una fotografia non mostrabile resta irraggiungibile dalla demo", () => {
  // Sta nel manifest, ha un indice valido, ma i diritti non la
  // consentono. La demo non e un modo di aggirare quella decisione.
  const d = dossierCon([
    foto("vietata", "display_forbidden"),
    foto("daApprovare", "display_after_approval"),
  ]);
  for (const i of ["0", "1"]) {
    const r = riferimentoPerIndice(d, i);
    assert.equal(r.ok, false, `indice ${i} non doveva risolversi`);
    assert.equal(r.ok === false && r.motivo, "non_mostrabile");
  }
  // Approvata a mano, diventa mostrabile.
  const ok = riferimentoPerIndice(dossierCon([foto("daApprovare", "display_after_approval")], ["daApprovare"]), "0");
  assert.equal(ok.ok, true);
});

test("foto: senza dossier non si risolve niente", () => {
  assert.equal(riferimentoPerIndice(null, "0").ok, false);
});

// ----- Gli indici pubblicati -----------------------------------------

test("foto: l'indice pubblicato e quello del manifest completo", () => {
  // Se si numerasse la lista FILTRATA, il numero che il client manda e
  // il numero che il server risolve smetterebbero di coincidere alla
  // prima fotografia scartata — e la demo mostrerebbe l'immagine
  // sbagliata senza che niente sembri rotto.
  const d = dossierCon([
    foto("vietata", "display_forbidden"),
    foto("buona", "display_allowed_with_attribution"),
  ]);
  const lista = fotoMostrabili(d, "SLUG123");
  assert.equal(lista.length, 1);
  assert.equal(lista[0].indice, 1, "la buona e in posizione 1, non 0");
  assert.equal(riferimentoPerIndice(d, String(lista[0].indice)).ok, true);
});

test("foto: il percorso non contiene mai il riferimento del provider", () => {
  const lista = fotoMostrabili(dossierCon([foto("a", "display_allowed_with_attribution")]), "SLUG123");
  assert.equal(lista[0].src, "/demo/SLUG123/foto/0?w=1200");
  assert.ok(!lista[0].src.includes("places/"), "il riferimento non deve uscire verso il client");
  assert.equal(lista[0].attribuzione_obbligatoria, true);
  assert.equal(lista[0].attribuzione, "Rosita");
});

// ----- Aperto ora, con il fuso giusto --------------------------------

test("orari: si legge il trattino lungo che Places usa davvero", () => {
  const r = leggiRiga("lunedì: 11:00–19:00");
  assert.ok(r);
  assert.equal(r?.giorno, "lunedì");
  assert.deepEqual(r?.intervalli, [{ apre: 660, chiude: 1140 }]);
  assert.equal(leggiRiga("sabato: Chiuso")?.chiuso, true);
});

const ORARI = [
  "lunedì: 11:00–19:00", "martedì: 09:00–19:00", "mercoledì: 09:00–19:00",
  "giovedì: 09:00–19:00", "venerdì: 09:00–19:00",
  "sabato: Chiuso", "domenica: Chiuso",
];

test("orari: l'ora e quella di Bari, non quella del server", () => {
  // Il server sta a Washington. Alle 23:30 di domenica a Washington
  // sono le 05:30 di lunedi a Bari: `getDay()` direbbe «domenica» e il
  // sito darebbe chiuso un'attivita che apre fra cinque ore e mezza.
  const domenicaSeraUSA = new Date("2026-09-21T03:30:00Z"); // lun 05:30 a Roma
  const r = adessoARoma(domenicaSeraUSA);
  assert.equal(r.giorno, 1, "a Roma e lunedì");
  assert.equal(r.minuti, 5 * 60 + 30);
});

test("orari: l'ora legale non si approssima con un offset fisso", () => {
  // Stessa ora UTC, sei mesi di distanza: a Roma cambia di un'ora.
  // Un offset costante sbaglierebbe per meta anno, e sbaglierebbe in
  // modo che non sembra un guasto.
  const estate = adessoARoma(new Date("2026-07-15T08:00:00Z"));  // UTC+2 -> 10:00
  const inverno = adessoARoma(new Date("2026-01-15T08:00:00Z")); // UTC+1 -> 09:00
  assert.equal(estate.minuti, 10 * 60);
  assert.equal(inverno.minuti, 9 * 60);
});

test("orari: aperto dentro l'intervallo, con l'ora di chiusura", () => {
  const r = statoApertura(ORARI, new Date("2026-09-16T12:00:00Z")); // mer 14:00 a Roma
  assert.equal(r.stato, "aperto");
  assert.equal(r.stato === "aperto" && r.fino, "19:00");
});

test("orari: prima dell'apertura riapre OGGI", () => {
  const r = statoApertura(ORARI, new Date("2026-09-16T05:00:00Z")); // mer 07:00
  assert.equal(r.stato, "chiuso");
  assert.equal(r.stato === "chiuso" && r.riapre, "oggi alle 09:00");
});

test("orari: sabato chiuso riapre LUNEDÌ, non domani", () => {
  // Il caso che un «riapre domani» scritto a mano sbaglierebbe: questa
  // attivita e chiusa sabato E domenica.
  const r = statoApertura(ORARI, new Date("2026-09-19T10:00:00Z")); // sab 12:00
  assert.equal(r.stato, "chiuso");
  assert.equal(r.stato === "chiuso" && r.riapre, "lunedì alle 11:00");
});

test("orari: domenica riapre domani alle 11", () => {
  const r = statoApertura(ORARI, new Date("2026-09-20T10:00:00Z")); // dom 12:00
  assert.equal(r.stato === "chiuso" && r.riapre, "domani alle 11:00");
});

test("orari: orari illeggibili danno `sconosciuto`, non `chiuso`", () => {
  // Dire a un cliente che un'attivita e chiusa quando e aperta e
  // peggio che non dirgli niente.
  assert.equal(statoApertura([]).stato, "sconosciuto");
  assert.equal(statoApertura(["boh", "non si sa"]).stato, "sconosciuto");
});

test("orari: un'attivita chiusa sempre non inventa una riapertura", () => {
  const r = statoApertura(["lunedì: Chiuso", "martedì: Chiuso"], new Date("2026-09-16T10:00:00Z"));
  assert.equal(r.stato, "sconosciuto");
});
