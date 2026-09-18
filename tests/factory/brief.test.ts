import assert from "node:assert/strict";
import { test } from "node:test";

import { briefDaDossier, briefLeggibile, matriceFatti } from "../../lib/factory/brief";
import type {
  BusinessDossier, DossierFact, IdentityCandidate, IdentityStatus,
  MediaCandidate, UsageScope,
} from "../../types/dossier";

// ============================================================
// Il brief e una PROIEZIONE del dossier, non un riassunto scritto da
// qualcuno.
//
// «Nessun fatto inventato» affidato alla disciplina si rompe nel punto
// piu naturale del mestiere: mentre si scrive il copy. Nessuno inventa
// un indirizzo, ma «da trent'anni nel cuore della citta» si scrive
// senza accorgersene, e sembra vero perche suona vero.
//
// Questi test verificano la sola cosa che rende la regola una
// garanzia: che nel brief non possa entrare niente che non sia nel
// dossier, e che cio che il dossier ha ma non si puo usare esca
// DICHIARATO invece di sparire.
// ============================================================

const fatto = (
  field: string, value: string,
  over: Partial<DossierFact> = {},
): DossierFact => ({
  field, value, source: "google_places", source_type: "google_places",
  source_url: "", method: "places_details", extraction_method: "places_details",
  observed_at: "", band: "verified", confidence: 90, evidence: value,
  conflict_group: field, usage_scope: "public", status: "proposed", ...over,
});

const profilo = (status: IdentityStatus, url = "https://instagram.com/x"): IdentityCandidate => ({
  candidate_url: url, platform: "instagram", confidence: 70,
  positive_signals: [], negative_signals: [], status, rationale: "",
  discovered_via: "grounded_search",
});

const foto = (
  id: string, display: MediaCandidate["display_status"],
  over: Partial<MediaCandidate> = {},
): MediaCandidate => ({
  id, source_url: `https://x/${id}.jpg`, source_page: "", platform: "website",
  copyright_owner: "", attribution: "Mario Rossi", observed_at: "", sha256: "",
  perceptual_hash: "", width: 1600, height: 1200, format: "jpg", filesize: 1,
  orientation: "landscape", probable_role: "venue", quality_score: 70,
  relevance_score: 70, duplicate_group: "", people_present: false,
  rights_status: "provider_rendered", allowed_scope: "preview_only",
  display_status: display, storage_status: "do_not_store",
  expires_at: "", provider_reference: `places/P/photos/${id}`, rejected_reason: "",
});

function dossier(over: Partial<BusinessDossier> = {}): BusinessDossier {
  return {
    dossier_version: 1, lead_id: "lead-1", generated_at: "",
    place_id: "P1", official_site: "", official_host: "",
    verified: [
      fatto("name", "Trattoria Esempio"),
      fatto("address", "Via Prova 1, Bari"),
      fatto("phone", "+39 080 000 0000"),
      fatto("maps_url", "https://maps.google.com/?cid=1"),
      fatto("business_status", "OPERATIONAL"),
    ],
    probable: [], conflicts: [], missing: [], identities: [],
    media: {
      lead_id: "lead-1", generated_at: "", candidates: [], approved_ids: [],
      rejected: [],
      by_rights: { customer_owned: 0, official_public_pending_approval: 0, provider_rendered: 0, unknown: 0, forbidden: 0 },
      counts: { totali: 0, tramite_provider: 0, proprietarie: 0, copiabili: 0, utilizzabili_in_demo: 0, da_approvare: 0 },
    },
    sources: [], website_opportunity_score: 100,
    commercial_recommendation: "GO", content_readiness: "PARTIAL",
    media_readiness: "NONE", social_readiness: "NONE",
    decision_reasons: { commercial: [], content: [], media: [], social: [] },
    recommendation: "GO", recommendation_reasons: [],
    cost: { external_calls: 0, total_ms: 0 },
    ...over,
  };
}

// ----- La garanzia --------------------------------------------------

test("brief: non contiene nulla che non sia nel dossier", () => {
  const b = briefDaDossier(dossier());
  const testo = briefLeggibile(b);

  // Ogni valore non vuoto del brief deve comparire fra i fatti
  // verificati. Se un giorno qualcuno aggiungesse un default «di
  // cortesia» — una categoria plausibile, un orario tipico — questo
  // test lo prende.
  const valoriDossier = dossier().verified.map((f) => f.value);
  for (const v of [b.nome, b.categoria, b.luogo.indirizzo, b.contatti.telefono,
    b.contatti.email, b.descrizione, b.luogo.maps_url]) {
    if (!v) continue;
    assert.ok(valoriDossier.indexOf(v) !== -1, `«${v}» non viene dal dossier`);
  }
  for (const s of b.servizi.concat(b.orari)) {
    assert.ok(valoriDossier.indexOf(s) !== -1, `«${s}» non viene dal dossier`);
  }
  assert.ok(testo.includes("Trattoria Esempio"));
});

test("brief: cio che manca si dichiara, non si riempie", () => {
  const b = briefDaDossier(dossier());
  assert.equal(b.categoria, "");
  assert.deepEqual(b.servizi, []);
  assert.deepEqual(b.orari, []);
  assert.equal(b.descrizione, "");

  const testo = briefLeggibile(b);
  assert.ok(/non si elencano servizi plausibili/i.test(testo),
    "il brief deve dire esplicitamente di non inventare i servizi");
  assert.ok(b.lacune.some((l) => /servizi/i.test(l)));
  assert.ok(b.lacune.some((l) => /orari/i.test(l)));
});

// ----- Le tre esclusioni che contano --------------------------------

test("brief: un fatto CONTESO non entra, nemmeno se verificato", () => {
  // Places dice un telefono, il sito ne dice un altro. Metterne uno
  // significa sceglierne uno a caso e stamparlo sotto il nome del
  // cliente.
  const b = briefDaDossier(dossier({
    conflicts: [{
      field: "phone", conflict_group: "phone",
      kept: { value: "+39 080 000 0000", source_type: "google_places", confidence: 90 },
      others: [{ value: "080 111 1111", source_type: "site_structured", confidence: 88 }],
      blocking: true,
    }],
  }));
  assert.equal(b.contatti.telefono, "", "un telefono conteso non si pubblica");
  assert.ok(b.lacune.some((l) => /phone/i.test(l) && /disaccordo/i.test(l)));
  assert.ok(b.lacune.some((l) => /CTA/i.test(l)),
    "senza recapiti le CTA devono andare alla scheda Maps");
});

test("brief: solo i profili `confirmed` entrano in pagina", () => {
  const stati: IdentityStatus[] = ["likely", "unverified_candidate", "browser_required", "rejected"];
  for (const st of stati) {
    const b = briefDaDossier(dossier({ identities: [profilo(st)] }));
    assert.deepEqual(b.social, [], `${st} non deve finire in pagina`);
    assert.ok(b.lacune.some((l) => /social/i.test(l)));
  }
  const ok = briefDaDossier(dossier({ identities: [profilo("confirmed")] }));
  assert.equal(ok.social.length, 1);
});

test("brief: solo le fotografie mostrabili ADESSO, con la loro attribuzione", () => {
  const b = briefDaDossier(dossier({
    media: {
      ...dossier().media,
      candidates: [
        foto("a", "display_allowed_with_attribution"),
        foto("b", "display_after_approval"),
        foto("c", "display_forbidden"),
      ],
    },
  }));
  assert.equal(b.fotografie.length, 1);
  assert.equal(b.fotografie[0].id, "a");
  assert.equal(b.fotografie[0].attribuzione_obbligatoria, true);
  assert.equal(b.fotografie[0].attribuzione, "Mario Rossi");
  assert.ok(b.fotografie[0].provider_reference, "serve per il rendering on demand");
});

test("brief: una fotografia approvata a mano diventa utilizzabile", () => {
  const b = briefDaDossier(dossier({
    media: {
      ...dossier().media,
      candidates: [foto("b", "display_after_approval")],
      approved_ids: ["b"],
    },
  }));
  assert.equal(b.fotografie.length, 1);
  assert.equal(b.fotografie[0].attribuzione_obbligatoria, false);
});

test("brief: un fatto `probable` non basta per una pagina pubblica", () => {
  const b = briefDaDossier(dossier({
    probable: [fatto("category", "Ristorante", { band: "probable" })],
  }));
  assert.equal(b.categoria, "", "«probabilmente» non si stampa sotto il nome di un cliente");
});

// ----- La matrice ---------------------------------------------------

test("matrice: ogni fatto risulta usato oppure escluso con un motivo", () => {
  const d = dossier({
    probable: [fatto("category", "Ristorante", { band: "probable" })],
    missing: ["services"],
    identities: [profilo("browser_required"), profilo("confirmed", "https://instagram.com/ok")],
    media: {
      ...dossier().media,
      candidates: [foto("a", "display_allowed_with_attribution"), foto("c", "display_forbidden")],
    },
  });
  const m = matriceFatti(d);

  for (const v of m.esclusi) {
    assert.ok(v.motivo, `«${v.campo}» escluso senza motivo: una lacuna senza spiegazione si riempie di fantasia`);
  }
  for (const v of m.usati) assert.equal(v.motivo, "");

  const per = (c: string) => m.esclusi.find((v) => v.campo === c);
  assert.equal(per("category")?.motivo, "non_verificato");
  assert.equal(per("services")?.motivo, "non_trovato");
  assert.equal(per("business_status")?.motivo, "solo_interno");
  assert.equal(m.esclusi.find((v) => v.campo === "media:venue")?.motivo, "non_mostrabile");
  assert.equal(m.esclusi.find((v) => v.campo === "social:instagram")?.motivo, "non_confermato");

  // E cio che si usa c'e davvero.
  assert.ok(m.usati.some((v) => v.campo === "name"));
  assert.ok(m.usati.some((v) => v.campo === "social:instagram"));
  assert.ok(m.usati.some((v) => v.campo === "media:venue"));
});

test("matrice: i campi di lavorazione non finiscono mai in pagina", () => {
  const m = matriceFatti(dossier({
    verified: dossier().verified.concat([
      fatto("social", "https://instagram.com/x"),
      fatto("website", "https://x.example"),
    ]),
  }));
  for (const c of ["business_status", "social", "website"]) {
    assert.ok(m.esclusi.some((v) => v.campo === c && v.motivo === "solo_interno"), c);
    assert.ok(!m.usati.some((v) => v.campo === c), `${c} non deve risultare usato`);
  }
});

test("matrice: un fatto marcato solo-interno resta fuori anche se verificato", () => {
  const m = matriceFatti(dossier({
    verified: dossier().verified.concat([
      fatto("description", "testo", { usage_scope: "internal_review" as UsageScope }),
    ]),
  }));
  assert.equal(m.esclusi.find((v) => v.campo === "description")?.motivo, "solo_interno");
});
