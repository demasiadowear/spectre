import assert from "node:assert/strict";
import { test } from "node:test";

import { conDecisioniColmate, decidi, SOGLIA_OPPORTUNITA } from "../../lib/collector/decisione";
import { queryPerLead, MAX_QUERY_PER_LEAD } from "../../lib/collector/ricerca";
import type {
  BusinessDossier, DossierConflict, DossierFact, IdentityCandidate,
  IdentityStatus, MediaCandidate, SourceType,
} from "../../types/dossier";

// ============================================================
// Il difetto che questi test esistono per impedire di ricommettere.
//
// Sul primo lead vero — identita certa, attivita aperta, sedici fatti
// verificati, zero conflitti — il collector rispondeva REVIEW. Il
// motivo era che l'attivita non aveva un sito web.
//
// Ma un'attivita senza sito e il cliente IDEALE, non un caso dubbio.
// Una risposta sola costringeva a rispondere insieme a tre domande
// diverse: se vale la pena lavorarci, se c'e abbastanza materiale, se
// si possono mostrare delle fotografie. Bastava che una delle tre
// andasse male perche tutte e tre sembrassero andate male.
//
// Il test che conta e il primo.
// ============================================================

const fatto = (field: string, value: string, source_type: SourceType = "google_places"): DossierFact => ({
  field, value, source: source_type, source_type,
  source_url: "", method: "places_details", extraction_method: "places_details",
  observed_at: "2026-09-18T00:00:00Z", band: "verified", confidence: 90,
  evidence: value, conflict_group: field, usage_scope: "public", status: "proposed",
});

const profilo = (
  status: IdentityStatus,
  discovered_via: SourceType = "official_site",
): IdentityCandidate => ({
  candidate_url: `https://instagram.com/x${status}`, platform: "instagram",
  confidence: 60, positive_signals: [], negative_signals: [],
  status, rationale: "", discovered_via,
});

const foto = (id: string, display: MediaCandidate["display_status"]): MediaCandidate => ({
  id, source_url: `https://x/${id}.jpg`, source_page: "", platform: "website",
  copyright_owner: "", attribution: "", observed_at: "", sha256: "",
  perceptual_hash: "", width: 1600, height: 1200, format: "jpg", filesize: 1,
  orientation: "landscape", probable_role: "venue", quality_score: 70,
  relevance_score: 70, duplicate_group: "", people_present: false,
  rights_status: "unknown", allowed_scope: "preview_only",
  display_status: display,
  storage_status: display === "display_allowed_with_attribution" ? "do_not_store" : "store_allowed",
  expires_at: "", provider_reference: "", rejected_reason: "",
});

/** Un dossier sano: identita ancorata, aperta, niente conflitti. */
function dossier(over: Partial<BusinessDossier> = {}): BusinessDossier {
  return {
    dossier_version: 1,
    lead_id: "lead-1",
    generated_at: "2026-09-18T00:00:00Z",
    place_id: "ChIJancora",
    official_site: "",
    official_host: "",
    verified: [
      fatto("name", "Trattoria Esempio"),
      fatto("address", "Via Prova 1, Bari"),
      fatto("phone", "+39 080 000 0000"),
      fatto("business_status", "OPERATIONAL"),
    ],
    probable: [],
    conflicts: [],
    missing: [],
    identities: [],
    media: {
      lead_id: "lead-1", generated_at: "", candidates: [], approved_ids: [],
      rejected: [],
      by_rights: {
        customer_owned: 0, official_public_pending_approval: 0,
        provider_rendered: 0, unknown: 0, forbidden: 0,
      },
      counts: {
        totali: 0, tramite_provider: 0, proprietarie: 0, copiabili: 0,
        utilizzabili_in_demo: 0, da_approvare: 0,
      },
    },
    sources: [],
    website_opportunity_score: 100,
    commercial_recommendation: "REVIEW",
    content_readiness: "BLOCKED",
    media_readiness: "NONE",
    decision_reasons: { commercial: [], content: [], media: [] },
    recommendation: "REVIEW",
    recommendation_reasons: [],
    cost: { external_calls: 0, total_ms: 0 },
    ...over,
  };
}

// ----- Il difetto originale --------------------------------------

test("decisione: senza sito e una GO, perche e proprio il caso per cui la Factory esiste", () => {
  const d = decidi(dossier());
  assert.equal(d.commercial_recommendation, "GO",
    `un'attivita identificata, aperta e senza conflitti non e un dubbio: ${d.reasons.commercial.join(" | ")}`);
  assert.ok(
    d.reasons.commercial.some((r) => /nessun sito/i.test(r)),
    "la ragione deve dire che l'assenza del sito e l'opportunita, non il problema",
  );
});

test("decisione: mancanza di social, foto o sito rende PARTIAL il contenuto, non REVIEW la commerciale", () => {
  // Niente sito, niente profili, nessuna immagine: lo scenario che
  // prima produceva REVIEW.
  const d = decidi(dossier({ missing: ["website", "services", "hours"] }));
  assert.equal(d.commercial_recommendation, "GO");
  assert.equal(d.content_readiness, "PARTIAL", "il materiale e poco, ma c'e");
  assert.equal(d.media_readiness, "NONE", "nessuna immagine non e un blocco commerciale");
});

// ----- Quando REVIEW e giusto ------------------------------------

test("decisione: identita non ancorata e REVIEW, perche non si sa di chi siano i dati", () => {
  const d = decidi(dossier({ place_id: "" }));
  assert.equal(d.commercial_recommendation, "REVIEW");
});

test("decisione: un conflitto bloccante e REVIEW", () => {
  const conflitto: DossierConflict = {
    field: "phone", conflict_group: "phone",
    kept: { value: "A", source_type: "google_places", confidence: 90 },
    others: [{ value: "B", source_type: "site_structured", confidence: 88 }],
    blocking: true,
  };
  const d = decidi(dossier({ conflicts: [conflitto] }));
  assert.equal(d.commercial_recommendation, "REVIEW");
});

test("decisione: un profilo che potrebbe essere di un altro e REVIEW", () => {
  const d = decidi(dossier({ identities: [profilo("unverified_candidate")] }));
  assert.equal(d.commercial_recommendation, "REVIEW",
    "attribuire l'Instagram sbagliato e l'errore che si paga davvero");
});

test("decisione: un profilo non letto ma DICHIARATO dal sito non manda in REVIEW", () => {
  // Instagram pretende un login: la pagina non si e potuta leggere. Ma
  // a dichiararlo suo e stato il sito ufficiale dell'attivita. Non e un
  // dubbio di identita, e una pagina non letta.
  const d = decidi(dossier({ identities: [profilo("browser_required", "official_site")] }));
  assert.equal(d.commercial_recommendation, "GO");
});

test("decisione: un profilo non letto e TROVATO da una ricerca manda in REVIEW", () => {
  // Qui non lo dichiara nessuno: se non si riesce nemmeno ad aprirlo,
  // metterlo sul sito vorrebbe dire pubblicare il profilo di un altro.
  const d = decidi(dossier({ identities: [profilo("browser_required", "grounded_search")] }));
  assert.equal(d.commercial_recommendation, "REVIEW");
});

// ----- Quando REJECT e giusto ------------------------------------

test("decisione: un'attivita chiusa e REJECT", () => {
  const d = decidi(dossier({
    verified: [fatto("name", "X"), fatto("address", "Y"), fatto("business_status", "CLOSED_PERMANENTLY")],
  }));
  assert.equal(d.commercial_recommendation, "REJECT");
});

test("decisione: un sito gia buono e REJECT, non GO", () => {
  const d = decidi(dossier({
    official_site: "https://gia-buono.example/",
    website_opportunity_score: SOGLIA_OPPORTUNITA - 1,
  }));
  assert.equal(d.commercial_recommendation, "REJECT",
    "senza un problema da risolvere non c'e niente da vendere");
});

test("decisione: un sito scadente resta GO", () => {
  const d = decidi(dossier({
    official_site: "https://da-rifare.example/",
    website_opportunity_score: SOGLIA_OPPORTUNITA + 30,
  }));
  assert.equal(d.commercial_recommendation, "GO");
});

test("decisione: un sito non misurato non diventa un REJECT per difetto", () => {
  // `null` vuol dire «non misurato», e non deve poter valere zero: un
  // numero mancante non e un giudizio.
  const d = decidi(dossier({
    official_site: "https://boh.example/",
    website_opportunity_score: null,
  }));
  assert.equal(d.commercial_recommendation, "GO");
});

// ----- Contenuto --------------------------------------------------

test("decisione: senza nome il contenuto e BLOCCATO", () => {
  const d = decidi(dossier({ verified: [fatto("address", "Via Prova 1")] }));
  assert.equal(d.content_readiness, "BLOCKED");
});

test("decisione: con tutto il materiale il contenuto e PRONTO", () => {
  const d = decidi(dossier({
    verified: [
      fatto("name", "X"), fatto("address", "Y"), fatto("phone", "Z"),
      fatto("category", "Ristorante"), fatto("hours", "lun 9-18"),
      fatto("services", "pizza"), fatto("description", "buono"),
      fatto("business_status", "OPERATIONAL"),
    ],
  }));
  assert.equal(d.content_readiness, "READY");
});

// ----- Media: il fraintendimento sul possesso ---------------------

test("decisione: una foto del provider e MOSTRABILE anche se non e nostra", () => {
  // Il punto: non si possiede l'immagine, ma il provider consente di
  // renderla citando la fonte. «Zero approvate» non vuol dire «zero
  // mostrabili».
  const d = decidi(dossier({
    media: {
      ...dossier().media,
      candidates: [foto("p1", "display_allowed_with_attribution")],
      counts: { totali: 1, tramite_provider: 1, proprietarie: 0, copiabili: 0, utilizzabili_in_demo: 1, da_approvare: 0 },
    },
  }));
  assert.equal(d.media_readiness, "DISPLAYABLE");
  assert.ok(d.reasons.media.some((r) => /attribuzione/i.test(r)),
    "l'attribuzione obbligatoria va detta, non sottintesa");
});

test("decisione: solo foto altrui in attesa di approvazione e APPROVAL_REQUIRED", () => {
  const d = decidi(dossier({
    media: { ...dossier().media, candidates: [foto("s1", "display_after_approval")] },
  }));
  assert.equal(d.media_readiness, "APPROVAL_REQUIRED");
});

test("decisione: solo foto di provenienza ignota e BLOCKED", () => {
  const d = decidi(dossier({
    media: { ...dossier().media, candidates: [foto("x1", "display_forbidden")] },
  }));
  assert.equal(d.media_readiness, "BLOCKED");
});

// ----- Dossier vecchi ---------------------------------------------

test("decisione: un dossier salvato prima della separazione non mostra «undefined»", () => {
  const vecchio = dossier();
  delete (vecchio as Partial<BusinessDossier>).commercial_recommendation;
  delete (vecchio as Partial<BusinessDossier>).content_readiness;
  vecchio.recommendation = "REVIEW";
  vecchio.recommendation_reasons = ["conflitto su phone"];

  const colmato = conDecisioniColmate(vecchio);
  assert.equal(colmato.commercial_recommendation, "REVIEW", "si riporta la risposta di allora");
  assert.ok(colmato.content_readiness, "nessun campo deve restare indefinito");
  assert.ok(colmato.media_readiness);
  assert.deepEqual(colmato.decision_reasons.commercial, ["conflitto su phone"]);
  assert.ok(
    colmato.decision_reasons.content.some((r) => /prima della separazione/i.test(r)),
    "va detto che e una risposta vecchia, non ricalcolata",
  );
});

test("decisione: un dossier gia nuovo non viene toccato", () => {
  const nuovo = dossier({ commercial_recommendation: "GO" });
  assert.equal(conDecisioniColmate(nuovo), nuovo);
});

// ----- Le interrogazioni della ricerca ----------------------------

test("ricerca: mai piu di quattro interrogazioni per lead", () => {
  const q = queryPerLead({
    nome: "Trattoria Esempio", citta: "Bari", indirizzo: "Via Prova 1",
    telefono: "+39 080 000 0000", categoria: "Ristorante",
  });
  assert.ok(q.length <= MAX_QUERY_PER_LEAD, `${q.length} interrogazioni: il tetto e ${MAX_QUERY_PER_LEAD}`);
  assert.equal(q.length, 4);
});

test("ricerca: il nome va sempre fra virgolette, o si raccolgono gli omonimi", () => {
  const q = queryPerLead({
    nome: "Bar Centrale", citta: "Bari", indirizzo: "", telefono: "", categoria: "",
  });
  for (const s of q) {
    assert.ok(s.includes('"Bar Centrale"'), `senza nome esatto: ${s}`);
  }
});

test("ricerca: senza un luogo non si formulano interrogazioni a caso", () => {
  const q = queryPerLead({ nome: "Bar Centrale", citta: "", indirizzo: "", telefono: "", categoria: "" });
  assert.equal(q.length, 0, "una ricerca senza luogo restituirebbe attivita di un'altra citta");
});

test("decisione: un dossier vecchio non dichiara 0 foto utilizzabili se ne ha dieci", () => {
  // Il caso reale: dieci fotografie di Places gia in archivio, salvate
  // prima che esistessero `display_status` e i conti. Senza derivarli,
  // il pannello direbbe «0 utilizzabili» — la stessa confusione fra
  // possedere un'immagine e poterla mostrare che questa versione doveva
  // togliere di mezzo.
  const vecchio = dossier();
  delete (vecchio as Partial<BusinessDossier>).commercial_recommendation;
  vecchio.media = {
    ...vecchio.media,
    candidates: Array.from({ length: 10 }, (_, i) => {
      const m = foto(`p${i}`, "display_allowed_with_attribution");
      delete (m as Partial<MediaCandidate>).display_status;
      delete (m as Partial<MediaCandidate>).storage_status;
      m.rights_status = "provider_rendered";
      return m;
    }),
  };
  delete (vecchio.media as Partial<BusinessDossier["media"]>).counts;

  const c = conDecisioniColmate(vecchio);
  assert.equal(c.media.counts.totali, 10);
  assert.equal(c.media.counts.tramite_provider, 10);
  assert.equal(c.media.counts.proprietarie, 0);
  assert.equal(c.media.counts.copiabili, 0, "le foto del provider non si copiano");
  assert.equal(c.media.counts.utilizzabili_in_demo, 10, "si mostrano, citando la fonte");
  assert.equal(c.media_readiness, "DISPLAYABLE");
  // E i due campi derivati arrivano fino al candidato, o l'anteprima nel
  // pannello si rifiuterebbe di disegnarla.
  assert.equal(c.media.candidates[0].display_status, "display_allowed_with_attribution");
  assert.equal(c.media.candidates[0].storage_status, "do_not_store");
});
