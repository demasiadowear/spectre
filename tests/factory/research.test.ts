import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractFromHtml,
  parseJsonLd,
  visibleText,
  decodeEntities,
} from "@/lib/factory/extract";
import {
  BLOCKED_IMAGE_HOSTS,
  checkImageUrl,
  selectImages,
} from "@/lib/factory/images";
import {
  bandForMethod,
  candidatesFromKnown,
  candidatesFromPage,
  capBand,
  looksLikeService,
  mergeCandidates,
  normalizePhone,
  sameValue,
  verifiedServices,
  type ResearchResult,
} from "@/lib/factory/research";
import { templateFor, ALL_TEMPLATES } from "@/lib/factory/templates";
import {
  DEFAULT_LIMITS,
  hasFreshDemo,
  loadLimits,
  modeAcceptsWebsite,
  parseScoutMode,
  shouldRecheck,
} from "@/lib/factory/scout-config";

// ============================================================
// Ricerca, immagini, template e tetti di costo.
//
// La proprietà che conta più di tutte: niente entra in una demo senza
// una fonte, e ciò che una persona ha scritto a mano non viene mai
// scavalcato da una macchina.
// ============================================================

const JSONLD_PAGE = `<!doctype html><html><head>
<title>Ristorante Il Glicine | Modugno</title>
<meta name="description" content="Cucina pugliese di stagione.">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Restaurant",
  "name": "Ristorante Il Glicine",
  "telephone": "+39 080 5327441",
  "email": "info@glicine.it",
  "address": { "@type": "PostalAddress", "streetAddress": "Via Di Vittorio 14", "postalCode": "70026", "addressLocality": "Modugno" },
  "openingHoursSpecification": [
    { "@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday"], "opens": "00:00", "closes": "00:00" },
    { "@type": "OpeningHoursSpecification", "dayOfWeek": ["Friday"], "opens": "19:30", "closes": "23:30" }
  ],
  "hasOfferCatalog": {
    "@type": "OfferCatalog",
    "name": "Servizi",
    "itemListElement": [
      { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Cena alla carta" } },
      { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Giardino estivo" } }
    ]
  },
  "sameAs": ["https://www.facebook.com/glicine"],
  "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.6", "reviewCount": "214" }
}
</script></head><body>
<a href="tel:+390805327441">Chiama</a>
<img src="https://glicine.it/foto/sala.jpg" alt="La sala">
</body></html>`;

describe("parseJsonLd", () => {
  it("legge un blocco valido", () => {
    assert.equal(parseJsonLd(JSONLD_PAGE).length, 1);
  });

  it("un blocco rotto non ferma gli altri", () => {
    const html = `<script type="application/ld+json">{rotto</script>${JSONLD_PAGE}`;
    assert.equal(parseJsonLd(html).length, 1);
  });

  it("segue @graph", () => {
    const html = `<script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[{"@type":"HairSalon","name":"Salone X","telephone":"080 111"}]}
    </script>`;
    const out = extractFromHtml(html);
    assert.equal(out.name[0]?.value, "Salone X");
    assert.equal(out.phone[0]?.value, "080 111");
  });

  it("ignora i nodi che non sono un'attività", () => {
    const html = `<script type="application/ld+json">
      {"@context":"https://schema.org","@type":"BreadcrumbList","name":"Briciole"}
    </script>`;
    assert.equal(extractFromHtml(html).name.length, 0);
  });
});

describe("extractFromHtml", () => {
  const out = extractFromHtml(JSONLD_PAGE);

  it("estrae i campi dichiarati", () => {
    assert.equal(out.name[0].value, "Ristorante Il Glicine");
    assert.equal(out.phone[0].value, "+39 080 5327441");
    assert.equal(out.email[0].value, "info@glicine.it");
    assert.match(out.address[0].value, /Via Di Vittorio 14/);
    assert.equal(out.city[0].value, "Modugno");
  });

  it("traduce gli orari e riconosce il giorno di chiusura", () => {
    const rows = out.hours[0].value;
    assert.ok(rows.some((r) => /Lunedì: chiuso/.test(r)), rows.join(" | "));
    assert.ok(rows.some((r) => /Venerdì: 19:30 - 23:30/.test(r)), rows.join(" | "));
  });

  it("prende i servizi ma non il nome del catalogo", () => {
    const names = out.services.map((s) => s.value);
    assert.ok(names.includes("Cena alla carta"));
    assert.ok(names.includes("Giardino estivo"));
    assert.ok(!names.includes("Servizi"), `il contenitore è finito fra i servizi: ${names.join(", ")}`);
  });

  it("prende il rating aggregato", () => {
    assert.equal(out.rating[0].value, 4.6);
    assert.equal(out.review_count[0].value, 214);
  });

  it("raccoglie social e immagini", () => {
    assert.match(out.social[0].value, /facebook\.com\/glicine/);
    assert.match(out.images[0].value, /sala\.jpg/);
  });

  it("marca il metodo di ogni dato", () => {
    assert.equal(out.name[0].method, "json_ld");
  });

  it("non esplode su HTML vuoto", () => {
    const empty = extractFromHtml("");
    assert.equal(empty.name.length, 0);
  });

  it("estrae i contatti anche senza dati strutturati", () => {
    const html = `<html><body>
      <a href="tel:0805551234">chiama</a>
      <a href="mailto:info@esempio.it">scrivi</a>
      <p>oppure 080 5559876</p>
    </body></html>`;
    const o = extractFromHtml(html);
    assert.ok(o.phone.some((p) => p.value.includes("0805551234")));
    assert.ok(o.email.some((e) => e.value === "info@esempio.it"));
  });
});

describe("visibleText / decodeEntities", () => {
  it("toglie script e style", () => {
    const t = visibleText("<style>a{}</style><script>var x=1</script><p>Ciao</p>");
    assert.equal(t, "Ciao");
  });

  it("decodifica gli accenti italiani", () => {
    assert.equal(decodeEntities("marted&igrave; e gioved&igrave;"), "martedì e giovedì");
  });
});

describe("bande e precedenza", () => {
  it("un dato strutturato è verificato, una regex no", () => {
    assert.equal(bandForMethod("json_ld"), "verified");
    assert.equal(bandForMethod("text_pattern"), "probable");
  });

  it("una fonte non può superare il proprio tetto", () => {
    assert.equal(capBand("verified", "public"), "possible");
    assert.equal(capBand("verified", "linked_page"), "probable");
    assert.equal(capBand("verified", "manual"), "verified");
  });

  it("capBand non alza mai la banda", () => {
    assert.equal(capBand("possible", "manual"), "possible");
  });
});

describe("normalizePhone / sameValue", () => {
  it("due scritture dello stesso numero coincidono", () => {
    assert.equal(normalizePhone("+39 080 532.74-41"), normalizePhone("0805327441"));
    assert.ok(sameValue("phone", "+39 080 5327441", "080 5327441"));
  });

  it("numeri diversi non coincidono", () => {
    assert.ok(!sameValue("phone", "080 5327441", "080 5327442"));
  });

  it("il confronto testuale ignora punteggiatura e accenti", () => {
    assert.ok(sameValue("name", "Ristorante  Il Glicine", "ristorante il glicine"));
  });

  it("le email si confrontano senza maiuscole", () => {
    assert.ok(sameValue("email", "Info@Esempio.IT", "info@esempio.it"));
  });
});

describe("mergeCandidates — precedenza e conflitti", () => {
  const cand = (field: string, value: string, source: string, band = "verified") => ({
    field,
    value,
    source: source as never,
    source_url: source === "manual" ? "" : "https://esempio.it",
    method: "test",
    band: band as never,
    evidence: {},
  });

  it("il dato manuale batte tutti gli altri", () => {
    const { facts } = mergeCandidates([
      cand("phone", "080 999", "official_site"),
      cand("phone", "080 111", "manual"),
      cand("phone", "080 222", "lead"),
    ]);
    const phone = facts.find((f) => f.field === "phone");
    assert.equal(phone?.value, "080 111");
    assert.equal(phone?.source, "manual");
  });

  it("un dato manuale non viene mai sovrascritto", () => {
    const { facts } = mergeCandidates([
      cand("name", "Nome Vecchio", "manual"),
      cand("name", "Nome Dal Sito", "structured"),
    ]);
    assert.equal(facts.find((f) => f.field === "name")?.value, "Nome Vecchio");
  });

  it("le fonti discordanti producono un conflitto", () => {
    const { conflicts } = mergeCandidates([
      cand("phone", "080 111", "lead"),
      cand("phone", "080 999", "official_site"),
    ]);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].field, "phone");
    assert.equal(conflicts[0].kept.value, "080 111");
    assert.equal(conflicts[0].others[0].value, "080 999");
  });

  it("un conflitto abbassa la banda: non resta verificato", () => {
    const { facts } = mergeCandidates([
      cand("phone", "080 111", "lead"),
      cand("phone", "080 999", "official_site"),
    ]);
    assert.equal(facts.find((f) => f.field === "phone")?.band, "probable");
  });

  it("fonti concordi non producono conflitti", () => {
    // Numero di lunghezza reale: il prefisso +39 si toglie solo se
    // restano almeno 9 cifre, altrimenti si mutilerebbe un numero che
    // comincia davvero per 39.
    const { conflicts, facts } = mergeCandidates([
      cand("phone", "+39 080 5327441", "lead"),
      cand("phone", "080 532 7441", "official_site"),
    ]);
    assert.equal(conflicts.length, 0);
    assert.equal(facts.find((f) => f.field === "phone")?.band, "verified");
  });

  it("i campi multi-valore tengono tutti i valori distinti", () => {
    const { facts } = mergeCandidates([
      cand("service", "Taglio", "manual"),
      cand("service", "Barba", "official_site"),
      cand("service", "Taglio", "structured"),
    ]);
    assert.equal(facts.filter((f) => f.field === "service").length, 2);
  });

  it("solo manual e verified diventano applied", () => {
    const { facts } = mergeCandidates([
      cand("description", "Testo dedotto", "public", "possible"),
    ]);
    assert.equal(facts[0].status, "proposed");
  });
});

describe("candidatesFromKnown", () => {
  it("i servizi manuali si scrivono con la barra", () => {
    const c = candidatesFromKnown({
      lead_id: "l",
      manual: { service: "Taglio uomo | Barba | Taglio bambino" },
    });
    assert.equal(c.filter((x) => x.field === "service").length, 3);
  });

  it("un campo a valore unico non viene spezzato", () => {
    const c = candidatesFromKnown({ lead_id: "l", manual: { name: "Bar A | B" } });
    assert.equal(c.filter((x) => x.field === "name").length, 1);
  });

  it("i campi vuoti non diventano candidati", () => {
    const c = candidatesFromKnown({ lead_id: "l", name: "", phone: "" });
    assert.equal(c.length, 0);
  });
});

describe("candidatesFromPage", () => {
  it("i dati strutturati prendono la fonte 'structured'", () => {
    const c = candidatesFromPage(extractFromHtml(JSONLD_PAGE), "https://glicine.it", "official_site");
    assert.equal(c.find((x) => x.field === "name")?.source, "structured");
  });
});

describe("looksLikeService", () => {
  it("accetta un nome di servizio", () => {
    assert.ok(looksLikeService("Taglio uomo"));
    assert.ok(looksLikeService("Cerimonie e banchetti"));
  });

  it("rifiuta una frase", () => {
    assert.ok(!looksLikeService("Offriamo il miglior taglio della città, da sempre."));
  });

  it("rifiuta le voci di navigazione", () => {
    assert.ok(!looksLikeService("Home"));
    assert.ok(!looksLikeService("Contatti"));
  });

  it("rifiuta testi troppo lunghi o vuoti", () => {
    assert.ok(!looksLikeService(""));
    assert.ok(!looksLikeService("a".repeat(120)));
  });
});

describe("verifiedServices", () => {
  const result = (facts: unknown[]): ResearchResult =>
    ({ facts, conflicts: [], sources_used: [], missing: [], images: [], rejected_images: [], schema_types: [], lead_id: "l" }) as ResearchResult;

  it("tiene un servizio inserito a mano, che non ha URL", () => {
    const out = verifiedServices(
      result([{ field: "service", value: "Taglio", source: "manual", source_url: "", band: "verified" }]),
    );
    assert.equal(out.length, 1, "il servizio manuale è stato scartato per mancanza di URL");
  });

  it("scarta una deduzione", () => {
    const out = verifiedServices(
      result([{ field: "service", value: "Forse catering", source: "public", source_url: "x", band: "possible" }]),
    );
    assert.equal(out.length, 0);
  });

  it("scarta un servizio senza alcuna fonte", () => {
    const out = verifiedServices(
      result([{ field: "service", value: "Inventato", source: "", source_url: "", band: "verified" }]),
    );
    assert.equal(out.length, 0);
  });
});

describe("checkImageUrl", () => {
  it("accetta un'immagine https normale", () => {
    assert.equal(checkImageUrl("https://esempio.it/foto.jpg").ok, true);
  });

  for (const bad of [
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "vbscript:msgbox",
    "file:///etc/passwd",
  ]) {
    it(`rifiuta lo schema non sicuro: ${bad.slice(0, 20)}`, () => {
      const d = checkImageUrl(bad);
      assert.equal(d.ok, false);
      assert.equal(d.reason, "schema_non_sicuro");
    });
  }

  it("rifiuta un SVG di terzi", () => {
    assert.equal(checkImageUrl("https://esempio.it/logo.svg").ok, false);
  });

  it("rifiuta le foto delle recensioni degli utenti", () => {
    const d = checkImageUrl("https://lh3.googleusercontent.com/p/abc=w400");
    assert.equal(d.ok, false);
    assert.equal(d.reason, "host_bloccato");
  });

  it("copre tutti gli host bloccati dichiarati", () => {
    for (const h of BLOCKED_IMAGE_HOSTS) {
      assert.equal(checkImageUrl(`https://${h}/foto.jpg`).ok, false, `host ${h} non bloccato`);
    }
  });

  it("rifiuta un pixel di tracciamento", () => {
    assert.equal(checkImageUrl("https://esempio.it/pixel.gif").reason, "tracking_pixel");
  });

  it("rifiuta un URL malformato", () => {
    assert.equal(checkImageUrl("non-un-url").ok, false);
  });
});

describe("selectImages", () => {
  const opts = { category: "pizzeria", name: "Da Mimmo", officialHost: "glicine.it" };

  it("tiene solo le immagini del dominio ufficiale", () => {
    const { images, rejected } = selectImages(
      [
        { url: "https://glicine.it/a.jpg", source: "s" },
        { url: "https://altrosito.it/b.jpg", source: "s" },
      ],
      opts,
    );
    assert.equal(images.length, 1);
    assert.match(images[0].url, /glicine\.it/);
    assert.equal(rejected.length, 1);
  });

  it("accetta un sottodominio del sito ufficiale", () => {
    const { images } = selectImages([{ url: "https://cdn.glicine.it/a.jpg", source: "s" }], opts);
    assert.equal(images.length, 1);
  });

  it("senza immagini utilizzabili mette un segnaposto", () => {
    const { images } = selectImages([{ url: "javascript:alert(1)", source: "s" }], opts);
    assert.equal(images.length, 1);
    assert.equal(images[0].placeholder, true);
    assert.equal(images[0].url, "");
  });

  it("conserva sempre la provenienza", () => {
    const { images } = selectImages([{ url: "https://glicine.it/a.jpg", source: "https://glicine.it" }], opts);
    assert.equal(images[0].source, "https://glicine.it");
  });
});

describe("templateFor", () => {
  it("categorie diverse danno template diversi", () => {
    assert.notEqual(templateFor("pizzeria").id, templateFor("parrucchiere").id);
    assert.notEqual(templateFor("dentista").id, templateFor("idraulico").id);
  });

  it("è deterministico", () => {
    assert.equal(templateFor("pizzeria").id, templateFor("PIZZERIA").id);
  });

  it("una categoria ignota ricade sul generico", () => {
    assert.equal(templateFor("cartomante").id, "locale");
  });

  it("ogni template ha sezioni, palette e CTA", () => {
    for (const t of ALL_TEMPLATES) {
      assert.ok(t.sections.length >= 4, `${t.id}: troppe poche sezioni`);
      assert.ok(t.palette.primary.startsWith("#"), `${t.id}: palette assente`);
      for (const k of ["call", "whatsapp", "maps", "email"] as const) {
        assert.ok(t.ctaLabels[k].length > 0, `${t.id}: manca l'etichetta CTA ${k}`);
      }
    }
  });

  it("i verticali non hanno lo stesso ordine di sezioni", () => {
    const orders = ALL_TEMPLATES.map((t) => t.sections.map((s) => s.kind).join(">"));
    assert.ok(new Set(orders).size > 1, "tutti i template hanno lo stesso ordine");
  });

  it("nella bellezza i servizi vengono prima del chi siamo", () => {
    const kinds = templateFor("parrucchiere").sections.map((s) => s.kind);
    assert.ok(kinds.indexOf("services") < kinds.indexOf("about"));
  });

  it("nella ristorazione il locale viene prima della proposta", () => {
    const kinds = templateFor("pizzeria").sections.map((s) => s.kind);
    assert.ok(kinds.indexOf("about") < kinds.indexOf("services"));
  });
});

describe("configurazione Scout", () => {
  it("riconosce le tre modalità", () => {
    assert.equal(parseScoutMode("no_site"), "no_site");
    assert.equal(parseScoutMode("weak_site"), "weak_site");
    assert.equal(parseScoutMode("both"), "both");
  });

  it("un valore ignoto ricade sul predefinito", () => {
    assert.equal(parseScoutMode("qualsiasi"), DEFAULT_LIMITS.mode);
    assert.equal(parseScoutMode(undefined), "both");
  });

  it("no_site esclude chi ha un sito", () => {
    assert.equal(modeAcceptsWebsite("no_site", true), false);
    assert.equal(modeAcceptsWebsite("no_site", false), true);
  });

  it("weak_site esclude chi NON ha un sito", () => {
    assert.equal(modeAcceptsWebsite("weak_site", true), true);
    assert.equal(modeAcceptsWebsite("weak_site", false), false);
  });

  it("both accetta entrambi", () => {
    assert.equal(modeAcceptsWebsite("both", true), true);
    assert.equal(modeAcceptsWebsite("both", false), true);
  });
});

describe("loadLimits", () => {
  it("senza env usa i predefiniti, non i minimi", () => {
    const l = loadLimits({});
    assert.equal(l.maxSiteAudits, DEFAULT_LIMITS.maxSiteAudits);
    assert.equal(l.maxDemosPerDay, DEFAULT_LIMITS.maxDemosPerDay);
    assert.equal(l.minOpportunityScore, DEFAULT_LIMITS.minOpportunityScore);
  });

  it("legge i valori impostati", () => {
    const l = loadLimits({ FACTORY_MAX_DEMOS_PER_DAY: "12", FACTORY_SCOUT_MODE: "no_site" });
    assert.equal(l.maxDemosPerDay, 12);
    assert.equal(l.mode, "no_site");
  });

  it("clampa un valore assurdo invece di fidarsi", () => {
    assert.equal(loadLimits({ FACTORY_MAX_DEMOS_PER_DAY: "999999" }).maxDemosPerDay, 50);
    assert.equal(loadLimits({ FACTORY_MAX_DEMOS_PER_DAY: "-5" }).maxDemosPerDay, 1);
  });

  it("un valore non numerico ricade sul predefinito", () => {
    assert.equal(loadLimits({ FACTORY_MAX_DEMOS_PER_DAY: "molte" }).maxDemosPerDay, DEFAULT_LIMITS.maxDemosPerDay);
  });

  it("riconosce la pausa e il dry-run", () => {
    assert.equal(loadLimits({ FACTORY_PAUSED: "1" }).paused, true);
    assert.equal(loadLimits({ FACTORY_DRY_RUN: "true" }).dryRun, true);
    assert.equal(loadLimits({}).paused, false);
  });
});

describe("shouldRecheck", () => {
  const now = new Date("2026-09-17T12:00:00Z");

  it("un sito mai analizzato si analizza", () => {
    assert.equal(shouldRecheck({ checkedAt: null, status: "", recheckAfterDays: 30, now }), true);
  });

  it("un esito definitivo recente non si rianalizza", () => {
    assert.equal(
      shouldRecheck({ checkedAt: "2026-09-10T00:00:00Z", status: "acceptable", recheckAfterDays: 30, now }),
      false,
    );
  });

  it("un esito definitivo vecchio si ricontrolla", () => {
    assert.equal(
      shouldRecheck({ checkedAt: "2026-06-01T00:00:00Z", status: "acceptable", recheckAfterDays: 30, now }),
      true,
    );
  });

  it("un esito NON definitivo si rianalizza sempre", () => {
    assert.equal(
      shouldRecheck({ checkedAt: "2026-09-16T00:00:00Z", status: "not_mobile", recheckAfterDays: 30, now }),
      true,
    );
  });

  it("una data illeggibile non blocca l'analisi", () => {
    assert.equal(shouldRecheck({ checkedAt: "boh", status: "acceptable", recheckAfterDays: 30, now }), true);
  });
});

describe("hasFreshDemo", () => {
  const now = new Date("2026-09-17T12:00:00Z");

  it("una demo pronta e recente non si rigenera", () => {
    assert.equal(
      hasFreshDemo({ updatedAt: "2026-09-15T00:00:00Z", stage: "ready", qaScore: 92, demoFreshDays: 14, now }),
      true,
    );
  });

  it("una demo vecchia si può rigenerare", () => {
    assert.equal(
      hasFreshDemo({ updatedAt: "2026-07-01T00:00:00Z", stage: "ready", qaScore: 92, demoFreshDays: 14, now }),
      false,
    );
  });

  it("una demo bocciata dal QA non conta come pronta", () => {
    assert.equal(
      hasFreshDemo({ updatedAt: "2026-09-16T00:00:00Z", stage: "qa_failed", qaScore: 40, demoFreshDays: 14, now }),
      false,
    );
  });

  it("una demo senza punteggio non conta", () => {
    assert.equal(
      hasFreshDemo({ updatedAt: "2026-09-16T00:00:00Z", stage: "ready", qaScore: 0, demoFreshDays: 14, now }),
      false,
    );
  });

  it("una demo già inviata resta valida", () => {
    assert.equal(
      hasFreshDemo({ updatedAt: "2026-09-16T00:00:00Z", stage: "sent", qaScore: 88, demoFreshDays: 14, now }),
      true,
    );
  });
});
