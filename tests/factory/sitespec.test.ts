import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BANNED_CLAIM_PATTERNS,
  SPEC_VERSION,
  factOf,
  findBannedClaims,
  isPublishableFact,
  neutralCopy,
  sanitizeSiteSpec,
  validateSiteSpec,
} from "@/lib/factory/sitespec";
import type { Fact, SiteSpec } from "@/types/factory";

// ============================================================
// Anti-allucinazione. Questi test sono il contratto commerciale del
// modulo: un dato senza fonte non deve poter raggiungere una pagina
// mostrata a un titolare. Se uno di questi cade, la Factory non è
// sicura da usare, indipendentemente dal resto.
// ============================================================

const AT = "2026-09-17T10:00:00.000Z";

function verified<T>(value: T): Fact<T> {
  return factOf<T>(value, "google_places", "places_search", "verified", AT);
}

function baseSpec(over: Partial<SiteSpec> = {}): SiteSpec {
  return {
    spec_version: SPEC_VERSION,
    lead_id: "lead-1",
    business: {
      name: verified("Pizzeria Da Mimmo"),
      category: verified("pizzeria"),
    },
    services: [],
    sections: [{ kind: "about", title: "Chi siamo", body: "Pizzeria di quartiere." }],
    cta: { label: "Chiama", kind: "call", target: "" },
    palette: { primary: "#2FB4C9", accent: "#7FD9E6", bg: "#0D1316", fg: "#EDF6F8" },
    images: [],
    seo: { title: "Pizzeria Da Mimmo", description: "Pizzeria di quartiere." },
    copy: neutralCopy("Pizzeria Da Mimmo", "pizzeria"),
    incomplete: [],
    sources: [],
    generated_at: AT,
    ...over,
  };
}

describe("isPublishableFact", () => {
  it("accetta un fatto completo", () => {
    assert.equal(isPublishableFact(verified("x")), true);
  });

  it("rifiuta un fatto senza fonte", () => {
    assert.equal(
      isPublishableFact({ value: "x", source: "", method: "m", observed_at: AT, band: "verified" }),
      false,
    );
  });

  it("rifiuta un fatto senza timestamp", () => {
    assert.equal(
      isPublishableFact({ value: "x", source: "s", method: "m", observed_at: "", band: "verified" }),
      false,
    );
  });

  it("rifiuta una banda inventata", () => {
    assert.equal(
      isPublishableFact({ value: "x", source: "s", method: "m", observed_at: AT, band: "certo" }),
      false,
    );
  });

  it("rifiuta un valore nudo senza involucro Fact", () => {
    assert.equal(isPublishableFact("3494455678"), false);
    assert.equal(isPublishableFact(null), false);
  });
});

describe("findBannedClaims", () => {
  const cases: [string, string][] = [
    ["Pizze da 8 euro", "price"],
    ["Sconto del 20% questo mese", "discount"],
    ["Con 25 anni di esperienza nel settore", "experience"],
    ["Attivi dal 1987 in città", "since"],
    ["Certificati ISO 9001", "certification"],
    ["I nostri clienti dicono che siamo ottimi", "testimonial"],
    ["Il nostro team di 12 professionisti", "team"],
    ["Oltre 500 clienti soddisfatti", "results"],
    ["Soddisfazione garantita al 100%", "guarantee"],
    ["Siamo i migliori della provincia", "superlative"],
  ];

  for (const [text, code] of cases) {
    it(`intercetta ${code}: "${text}"`, () => {
      const hits = findBannedClaims(text);
      assert.ok(hits.length > 0, `nessun match per "${text}"`);
      assert.ok(hits.includes(code), `atteso ${code}, trovato ${hits.join(",")}`);
    });
  }

  it("lascia passare copy neutro", () => {
    assert.deepEqual(findBannedClaims("Pizzeria di quartiere. Forno a legna."), []);
  });

  it("copre tutti i pattern dichiarati", () => {
    // Ogni pattern deve avere almeno un caso sopra: un pattern senza
    // test è un pattern che può rompersi in silenzio.
    const tested = new Set(cases.map(([, code]) => code));
    for (const p of BANNED_CLAIM_PATTERNS) {
      assert.ok(tested.has(p.code), `pattern "${p.code}" senza caso di test`);
    }
  });
});

describe("validateSiteSpec", () => {
  it("accetta una spec valida", () => {
    const res = validateSiteSpec(baseSpec());
    assert.equal(res.ok, true, res.errors.join("; "));
    assert.ok(res.value);
  });

  it("rifiuta un input che non è un oggetto", () => {
    assert.equal(validateSiteSpec("nope").ok, false);
    assert.equal(validateSiteSpec(null).ok, false);
  });

  it("rifiuta una spec senza nome attività", () => {
    const spec = baseSpec();
    // @ts-expect-error rimozione volontaria per il test
    delete spec.business.name;
    const res = validateSiteSpec(spec);
    assert.equal(res.ok, false);
    assert.ok(res.errors.length > 0);
  });
});

describe("sanitizeSiteSpec", () => {
  it("rimuove il telefono privo di fonte", () => {
    const spec = baseSpec();
    spec.business.phone = {
      value: "080 1234567",
      source: "",
      method: "",
      observed_at: AT,
      band: "verified",
    };
    const { spec: out, dropped } = sanitizeSiteSpec(spec);
    assert.equal(out.business.phone, undefined);
    assert.ok(dropped.some((d) => d.field === "business.phone"));
    assert.ok(out.incomplete.includes("telefono"));
  });

  it("conserva il telefono con fonte", () => {
    const spec = baseSpec();
    spec.business.phone = verified("080 1234567");
    const { spec: out } = sanitizeSiteSpec(spec);
    assert.equal(out.business.phone?.value, "080 1234567");
  });

  it("tiene solo i servizi con fonte", () => {
    const spec = baseSpec({
      services: [
        verified("Pizza al forno a legna"),
        { value: "Catering matrimoni", source: "", method: "", observed_at: AT, band: "possible" },
      ],
    });
    const { spec: out, dropped } = sanitizeSiteSpec(spec);
    assert.equal(out.services.length, 1);
    assert.equal(out.services[0].value, "Pizza al forno a legna");
    assert.ok(dropped.some((d) => d.field.startsWith("services")));
  });

  it("sostituisce il copy che contiene un prezzo", () => {
    const spec = baseSpec();
    spec.copy.hero_title = "Pizze da 5 euro tutti i giorni";
    const { spec: out, dropped } = sanitizeSiteSpec(spec);
    assert.ok(!/euro/i.test(out.copy.hero_title), `copy non sanificato: ${out.copy.hero_title}`);
    assert.ok(dropped.some((d) => d.field === "copy.hero_title"));
  });

  it("sostituisce il corpo di sezione con affermazioni fattuali", () => {
    const spec = baseSpec({
      sections: [
        { kind: "about", title: "Chi siamo", body: "Da 30 anni di esperienza nel settore." },
      ],
    });
    const { spec: out, dropped } = sanitizeSiteSpec(spec);
    assert.ok(!/30 anni/i.test(out.sections[0].body ?? ""));
    assert.ok(dropped.some((d) => d.field.startsWith("sections")));
  });

  it("scarta le recensioni senza fonte", () => {
    const spec = baseSpec({
      reviews: {
        rating: { value: 4.8, source: "", method: "", observed_at: AT, band: "verified" },
        count: verified(212),
      },
    });
    const { spec: out, dropped } = sanitizeSiteSpec(spec);
    assert.equal(out.reviews, undefined);
    assert.ok(dropped.some((d) => d.field === "reviews"));
  });

  it("degrada la CTA quando il contatto non è verificato", () => {
    const spec = baseSpec();
    spec.business.maps_url = verified("https://maps.google.com/?cid=1");
    spec.cta = { label: "Chiama", kind: "call", target: "080 999" };
    const { spec: out, dropped } = sanitizeSiteSpec(spec);
    assert.equal(out.cta.kind, "maps");
    assert.equal(out.cta.target, "https://maps.google.com/?cid=1");
    assert.ok(dropped.some((d) => d.field === "cta"));
  });

  it("disattiva la CTA quando non esiste alcun contatto", () => {
    const { spec: out } = sanitizeSiteSpec(baseSpec());
    assert.equal(out.cta.target, "");
    assert.match(out.cta.label, /non disponibili/i);
  });

  it("forza il placeholder sulle immagini senza fonte", () => {
    const spec = baseSpec({
      images: [
        { url: "https://cdn.terzi.it/foto.jpg", alt: "interno", placeholder: false, source: "" },
      ],
    });
    const { spec: out, dropped } = sanitizeSiteSpec(spec);
    assert.equal(out.images[0].placeholder, true);
    assert.equal(out.images[0].url, "");
    assert.ok(dropped.some((d) => d.field.startsWith("images")));
  });

  it("elenca le fonti effettivamente usate", () => {
    const spec = baseSpec();
    spec.business.phone = verified("080 1234567");
    const { spec: out } = sanitizeSiteSpec(spec);
    assert.deepEqual(out.sources, ["google_places"]);
  });

  it("non muta la spec in ingresso", () => {
    const spec = baseSpec();
    spec.copy.hero_title = "Prezzi da 10 euro";
    const snapshot = JSON.stringify(spec);
    sanitizeSiteSpec(spec);
    assert.equal(JSON.stringify(spec), snapshot);
  });
});
