import assert from "node:assert/strict";
import { test } from "node:test";

import {
  componiIdentita, eOmonimo, haAncoraggio, motivoRifiuto, usoConsentito,
  valutaCandidato, type ContestoBrand,
} from "../../lib/collector/brand";
import type { BrandCandidate, FontiBrand } from "../../types/dossier";

/** Tutte le fonti gia esaurite: e il caso in cui NOT_FOUND e vero. */
const ESAURITE: FontiBrand = {
  sito_ufficiale: "not_applicable", social_confermati: "not_applicable",
  foto_places: "success_no_results", ricerca_grounded: "success_no_results",
};

// ============================================================
// Il modo piu rapido di sbagliare l'identita visiva non e non trovare
// il logo: e trovarne uno che sembra giusto.
//
// Il lead reale lo dimostra. «Collateral Beauty» e un film del 2016, e
// sui social la ricerca ha restituito quattro candidati su quattro
// sbagliati: la pagina del film e due canali Mediaset che ne
// promuovevano la messa in onda. Una ricerca di immagini sullo stesso
// nome restituirebbe la locandina — un'immagine bellissima, e
// completamente non sua.
//
// Questi test coprono i cinque falsi logo: l'omonimo, l'icona di
// categoria di Places, il marchio di piattaforma, il marchio di
// prodotto presente nel locale, e il wordmark che disegniamo noi.
// ============================================================

const CTX: ContestoBrand = {
  nome: "Collateral Beauty di Rosita Buonsante",
  citta: "Bari",
  indirizzo: "Via Guido Dorso, 8-8/A, 70124 Bari BA",
  titolare: "Rosita Buonsante",
  official_host: "",
};

const cand = (o: Partial<BrandCandidate> & { contesto_testo?: string; da_social_confermato?: boolean } = {}) => ({
  kind: "logo" as const, source_type: "grounded_search" as const,
  source_url: "", provider_reference: "", discovered_via: "grounded_search" as const,
  identity_signals: [], image_width: 512, image_height: 512,
  has_transparency: false, detected_text: "", candidate_colors: [],
  rights_status: "official_public_pending_approval" as const,
  confidence: 0, status: "needs_review" as const,
  rejection_reason: "" as const, retrieved_at: "", ...o,
});

// ----- L'omonimo, che e il caso di questo lead -----------------------

test("brand: il logo del film omonimo e rifiutato come homonym_entity", () => {
  const casi = [
    { source_url: "https://www.imdb.com/title/tt1424432/mediaviewer/rm1/", detected_text: "Collateral Beauty" },
    { source_url: "https://example.com/poster.jpg", contesto_testo: "Collateral Beauty film 2016 con Will Smith, trailer" },
    { source_url: "https://cdn.mymovies.it/locandina.jpg", detected_text: "COLLATERAL BEAUTY" },
    { source_url: "https://img.mediaset.it/x.jpg", contesto_testo: "stasera in tv Collateral Beauty" },
  ];
  for (const c of casi) {
    assert.equal(motivoRifiuto(cand(c), CTX), "homonym_entity", JSON.stringify(c));
    assert.equal(valutaCandidato(cand(c), CTX).status, "rejected");
  }
});

test("brand: il nome da solo non e un segnale, nemmeno se coincide esattamente", () => {
  // «Collateral Beauty» senza Bari, senza l'indirizzo e senza Rosita
  // Buonsante e il titolo di un film. E questa e la regola che
  // generalizza: qualunque attivita chiamata come un'opera produce
  // candidati che superano ogni controllo basato sul nome.
  const soloNome = cand({ detected_text: "Collateral Beauty", contesto_testo: "film" });
  assert.equal(valutaCandidato(soloNome, CTX).status, "rejected");
  assert.equal(haAncoraggio("Collateral Beauty", CTX), false);
  assert.equal(haAncoraggio("Collateral Beauty — Bari", CTX), true);
  assert.equal(haAncoraggio("insegna di Rosita Buonsante", CTX), true);
  assert.equal(haAncoraggio("Via Guido Dorso", CTX), true);
});

test("brand: un articolo che parla DELL'ATTIVITA citando il film non e un omonimo", () => {
  // I segni d'opera ci sono, ma c'e anche l'ancoraggio: e un pezzo sul
  // centro estetico che spiega da dove viene il nome. Rifiutarlo
  // sarebbe buttare via l'unica fonte utile.
  const articolo = cand({
    source_url: "https://cronachebaresi.example/centro-estetico",
    contesto_testo: "Il nome viene dal film: Collateral Beauty a Bari, in Via Guido Dorso",
  });
  assert.equal(eOmonimo(articolo, CTX), false);
  assert.notEqual(motivoRifiuto(articolo, CTX), "homonym_entity");
});

// ----- Gli altri falsi logo ------------------------------------------

test("brand: l'icona di categoria di Google non e un logo", () => {
  // Places la serve dal profilo dell'attivita, quindi sembra sua. E di
  // Google, ed e identica per ogni centro estetico del mondo.
  for (const u of [
    "https://maps.gstatic.com/mapfiles/place_api/icons/v1/png_71/beauty_salon-71.png",
    "https://example.com/iconMaskBaseUri/spa",
  ]) {
    assert.equal(motivoRifiuto(cand({ source_url: u }), CTX), "category_icon", u);
  }
});

test("brand: il marchio di una piattaforma non e il marchio dell'attivita", () => {
  assert.equal(
    motivoRifiuto(cand({ source_url: "https://static.facebook.com/logo.svg" }), CTX),
    "platform_asset",
  );
});

test("brand: un marchio di cosmetici nel locale non e l'insegna", () => {
  // In un centro estetico c'e sempre un marchio di fornitore ben
  // visibile. Pubblicarlo come identita del cliente e un errore che si
  // paga con il cliente.
  const prodotto = cand({ kind: "signage", source_type: "google_places", detected_text: "DERMALOGICA" });
  assert.equal(motivoRifiuto(prodotto, CTX), "product_brand");
});

test("brand: senza stato dei diritti non si usa", () => {
  assert.equal(motivoRifiuto(cand({ rights_status: "unknown" }), CTX), "no_rights");
  assert.equal(motivoRifiuto(cand({ rights_status: "forbidden" }), CTX), "no_rights");
});

// ----- Quando si conferma --------------------------------------------

test("brand: il logo servito dal sito ufficiale verificato e confermato", () => {
  const conSito: ContestoBrand = { ...CTX, official_host: "collateralbeauty.example" };
  const r = valutaCandidato(
    cand({ source_type: "official_site", source_url: "https://collateralbeauty.example/logo.svg" }),
    conSito,
  );
  assert.equal(r.status, "confirmed");
});

test("brand: l'avatar di un social CONFERMATO e confermato", () => {
  const r = valutaCandidato(
    cand({ source_type: "social_profile", da_social_confermato: true, source_url: "https://cdn.example/avatar.jpg" }),
    CTX,
  );
  assert.equal(r.status, "confirmed");
});

test("brand: l'avatar di un social NON confermato resta needs_review", () => {
  // Non e rifiutato: potrebbe benissimo essere suo. Ma nessuno lo ha
  // verificato, quindi non si pubblica senza che una persona guardi.
  const r = valutaCandidato(
    cand({ source_type: "social_profile", source_url: "https://cdn.example/avatar.jpg" }),
    CTX,
  );
  assert.equal(r.status, "needs_review");
  assert.equal(r.rejection_reason, "");
});

test("brand: due segnali forti indipendenti confermano", () => {
  const r = valutaCandidato(
    cand({ identity_signals: ["same_phone", "same_address"] }), CTX);
  assert.equal(r.status, "confirmed");
  // Uno solo no: e la stessa soglia dei profili social, e non si
  // abbassa perche qui l'oggetto e un'immagine.
  assert.equal(valutaCandidato(cand({ identity_signals: ["same_phone"] }), CTX).status, "probable");
  assert.equal(valutaCandidato(cand({ identity_signals: ["similar_name", "same_city"] }), CTX).status, "rejected");
});

test("brand: l'insegna in una foto Places conferma solo con un ancoraggio", () => {
  const base = { kind: "signage" as const, source_type: "google_places" as const,
    rights_status: "provider_rendered" as const };

  const conLuogo = valutaCandidato(
    cand({ ...base, detected_text: "COLLATERAL BEAUTY", contesto_testo: "Via Guido Dorso, Bari" }), CTX);
  assert.equal(conLuogo.status, "confirmed");

  // Il nome si legge ma niente lo lega a QUESTO luogo: e esattamente
  // il caso dell'omonimo che ha un'insegna da un'altra parte.
  const soloNome = valutaCandidato(cand({ ...base, detected_text: "COLLATERAL BEAUTY" }), CTX);
  assert.equal(soloNome.status, "needs_review");
});

// ----- L'identita complessiva ----------------------------------------

const confermato = (k: BrandCandidate["kind"]): BrandCandidate =>
  ({ ...cand({ kind: k }), status: "confirmed", confidence: 95 }) as BrandCandidate;

test("brand: nessun candidato vivo -> NOT_FOUND, e non si inventa niente", () => {
  const b = componiIdentita([{ ...cand(), status: "rejected", rejection_reason: "homonym_entity" } as BrandCandidate], ESAURITE);
  assert.equal(b.brand_status, "NOT_FOUND");
  assert.equal(b.primary_logo, null);
  assert.equal(b.requires_operator_approval, false);

  const uso = usoConsentito(b);
  assert.equal(uso.usa, "tipografia");
  assert.equal(uso.puo_pubblicare, true);
  // La riga che impedisce l'errore piu sottile: un nome disegnato bene
  // non e il logo del cliente, e non va chiamato cosi.
  assert.ok(/non si chiama logo/i.test(uso.nota), uso.nota);
});

test("brand: logo confermato -> ORIGINAL_CONFIRMED, pubblicabile", () => {
  const b = componiIdentita([confermato("logo")], ESAURITE);
  assert.equal(b.brand_status, "ORIGINAL_CONFIRMED");
  assert.equal(b.requires_operator_approval, false);
  assert.equal(usoConsentito(b).puo_pubblicare, true);
});

test("brand: logo probabile -> non si pubblica senza approvazione", () => {
  const b = componiIdentita([{ ...cand({ kind: "logo" }), status: "probable", confidence: 65 } as BrandCandidate], ESAURITE);
  assert.equal(b.brand_status, "ORIGINAL_PROBABLE");
  assert.equal(b.requires_operator_approval, true);
  assert.equal(usoConsentito(b).puo_pubblicare, false);
});

test("brand: solo insegna -> SIGNAGE_ONLY, e non se ne estrae un logo finto", () => {
  const b = componiIdentita([{ ...cand({ kind: "signage" }), status: "needs_review" } as BrandCandidate], ESAURITE);
  assert.equal(b.brand_status, "SIGNAGE_ONLY");
  const uso = usoConsentito(b);
  assert.equal(uso.usa, "riferimento_insegna");
  assert.equal(uso.puo_pubblicare, false);
  assert.ok(/non come marchio/i.test(uso.nota));
});

test("brand: un wordmark generato da noi non e mai un candidato", () => {
  // Il quinto falso logo, e l'unico che produrremmo noi. Puo essere un
  // ottimo trattamento editoriale; dichiararlo identita del cliente
  // sarebbe inventare un fatto, con la differenza che questo si vede.
  const b = componiIdentita([
    { ...cand({ kind: "wordmark" }), status: "rejected", rejection_reason: "generated_wordmark" } as BrandCandidate,
  ], ESAURITE);
  assert.equal(b.brand_status, "NOT_FOUND");
  assert.equal(b.primary_logo, null);
});

// ----- I tre «non lo so» che si somigliano ----------------------------

test("brand: PENDING, INCONCLUSIVE e NOT_FOUND non sono la stessa cosa", () => {
  // La distinzione che evita il difetto peggiore: trasformare «questa
  // attivita non ha un logo» in «questo sito non si pubblica mai».
  const respinto = { ...cand(), status: "rejected", rejection_reason: "homonym_entity" } as BrandCandidate;
  const ambiguo = { ...cand({ kind: "color_reference" }), status: "needs_review" } as BrandCandidate;

  // Fonti ancora aperte: bloccare e giusto, guardare e ancora possibile.
  const aperte: FontiBrand = { ...ESAURITE, foto_places: "pending" };
  const pending = componiIdentita([respinto], aperte);
  assert.equal(pending.brand_status, "PENDING");
  assert.equal(usoConsentito(pending).puo_pubblicare, false);
  assert.equal(pending.requires_operator_approval, false, "prima si esegue l'analisi, non si chiede a una persona");

  // Tutto interrogato, resta qualcosa di ambiguo: decide una persona.
  const inconcl = componiIdentita([ambiguo], ESAURITE);
  assert.equal(inconcl.brand_status, "INCONCLUSIVE");
  assert.equal(usoConsentito(inconcl).puo_pubblicare, false);
  assert.equal(inconcl.requires_operator_approval, true);

  // Tutto interrogato, niente di vivo: NON blocca.
  const nf = componiIdentita([respinto], ESAURITE);
  assert.equal(nf.brand_status, "NOT_FOUND");
  assert.equal(usoConsentito(nf).puo_pubblicare, true);
  assert.equal(usoConsentito(nf).usa, "tipografia");
});

test("brand: una fonte che NON ESISTE conta come interrogata", () => {
  // Per Collateral Beauty il sito non c'e e i social confermati sono
  // zero: tenere quelle fonti «aperte» bloccherebbe il progetto per
  // sempre, aspettando qualcosa che non arrivera.
  const senzaSito: FontiBrand = {
    sito_ufficiale: "not_applicable", social_confermati: "not_applicable",
    foto_places: "success_no_results", ricerca_grounded: "success_no_results",
  };
  const b = componiIdentita([], senzaSito);
  assert.equal(b.brand_status, "NOT_FOUND", "niente da interrogare non e «non ho interrogato»");
  assert.equal(usoConsentito(b).puo_pubblicare, true);
});

// ----- IL TEST OBBLIGATORIO: un timeout non e un «non c'e» ------------

test("fonti: sito assente + social assenti + Places vuoto + ricerca in timeout -> RETRY_REQUIRED", () => {
  // Lo scenario esatto di Collateral Beauty con una rete che fa i
  // capricci. Tre fonti hanno detto la loro; la quarta non ha
  // risposto.
  //
  // Se `transient_error` collassasse in «nessun risultato», il verdetto
  // sarebbe NOT_FOUND — cioe «questa attivita non ha un logo» — e il
  // sito si pubblicherebbe con un trattamento tipografico deciso da un
  // timeout. Un errore di rete non e un fatto sul mondo.
  const fonti: FontiBrand = {
    sito_ufficiale: "not_applicable",        // il sito non esiste
    social_confermati: "not_applicable",     // zero profili confermati
    foto_places: "success_no_results",       // guardate, niente insegna
    ricerca_grounded: "transient_error",     // timeout
  };
  const b = componiIdentita([], fonti);

  assert.equal(b.brand_status, "RETRY_REQUIRED");
  assert.notEqual(b.brand_status, "NOT_FOUND", "un timeout non puo chiudere la ricerca");
  assert.equal(usoConsentito(b).puo_pubblicare, false);
  // Non entra nella coda umana: non c'e niente da decidere.
  assert.equal(b.requires_operator_approval, false);
  assert.ok(/nuova esecuzione, non una decisione/i.test(usoConsentito(b).nota));
});

test("fonti: un timeout e un blocco non sono la stessa cosa, e non sono risultati", () => {
  // Due modi diversi di non sapere, che si somigliano entrambi a «zero
  // candidati» e non lo sono.
  //
  // `permanent_error` NON e piu NOT_FOUND. Prima lo era, e il
  // ragionamento sembrava sensato — «quella fonte e chiusa, le altre
  // hanno risposto, la conclusione e legittima». Non lo e: una chiave
  // assente chiude la fonte senza averla mai interrogata, e concludere
  // «questa attivita non ha un logo» perche non abbiamo potuto
  // guardare e un NOT_FOUND che nessuno ha guadagnato. Adesso e
  // BLOCKED, che ha un rimedio operativo invece di una conclusione.
  const ritentabile = componiIdentita([], { ...ESAURITE, ricerca_grounded: "transient_error" });
  assert.equal(ritentabile.brand_status, "RETRY_REQUIRED");

  const bloccata = componiIdentita([], { ...ESAURITE, ricerca_grounded: "permanent_error" });
  assert.equal(bloccata.brand_status, "BLOCKED");

  // Nessuno dei due chiede una persona: il primo chiede una nuova
  // esecuzione, il secondo un intervento sulla configurazione. Mandarli
  // in revisione umana vuol dire dare a qualcuno una coda di cose su
  // cui non puo fare niente.
  assert.equal(ritentabile.requires_operator_approval, false);
  assert.equal(bloccata.requires_operator_approval, false);
});

test("fonti: un'identita trovata vale anche se una fonte e bloccata", () => {
  // L'ordine conta: se il logo e confermato dal sito ufficiale, che la
  // ricerca grounded non sia configurata non toglie niente.
  const confermato = cand({ source_type: "official_site", kind: "logo" });
  const b = componiIdentita(
    [{ ...confermato, status: "confirmed" } as BrandCandidate],
    { ...ESAURITE, ricerca_grounded: "permanent_error" },
  );
  assert.equal(b.brand_status, "ORIGINAL_CONFIRMED");
});

test("fonti: success_candidates senza candidati vivi resta INCONCLUSIVE", () => {
  // La fonte ha trovato qualcosa, e stato tutto respinto: e diverso da
  // «non ha trovato niente», perche qualcosa da guardare c'era.
  const ambiguo = { ...cand({ kind: "color_reference" }), status: "needs_review" } as BrandCandidate;
  const b = componiIdentita([ambiguo], { ...ESAURITE, ricerca_grounded: "success_candidates" });
  assert.equal(b.brand_status, "INCONCLUSIVE");
  assert.equal(b.requires_operator_approval, true);
});
