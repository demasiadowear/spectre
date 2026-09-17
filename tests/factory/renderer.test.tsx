import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import SiteRenderer from "@/components/factory/SiteRenderer";
import { SPEC_VERSION, factOf, neutralCopy } from "@/lib/factory/sitespec";
import type { Fact, SiteSpec } from "@/types/factory";

// ============================================================
// Il renderer è l'UNICA cosa autorizzata a produrre markup: il modello
// genera dati, non HTML. Questi test difendono quella frontiera. Una
// SiteSpec ostile (perché il modello ha sbagliato o perché qualcuno ha
// scritto a mano sul DB) deve poter inserire solo TESTO.
// ============================================================

const AT = "2026-09-17T10:00:00.000Z";
const verified = <T,>(v: T): Fact<T> => factOf<T>(v, "google_places", "places_search", "verified", AT);

function spec(over: Partial<SiteSpec> = {}): SiteSpec {
  return {
    spec_version: SPEC_VERSION,
    lead_id: "lead-1",
    business: {
      name: verified("Pizzeria Da Mimmo"),
      category: verified("pizzeria"),
      phone: verified("080 1234567"),
    },
    services: [verified("Pizza al forno a legna")],
    // Le sezioni che il template verticale produce davvero: il renderer
    // rende quello che la spec dichiara, quindi il fixture deve
    // dichiarare una spec realistica.
    sections: [
      { kind: "about", title: "Il locale", body: "Pizzeria di quartiere." },
      { kind: "services", title: "La proposta" },
      { kind: "hours", title: "Quando siamo aperti" },
      { kind: "reviews", title: "Recensioni Google" },
      { kind: "contact", title: "Prenotazioni e contatti" },
      { kind: "map", title: "Dove siamo" },
    ],
    cta: { label: "Chiama", kind: "call", target: "080 1234567" },
    palette: { primary: "#2FB4C9", accent: "#7FD9E6", bg: "#0D1316", fg: "#EDF6F8" },
    images: [{ url: "", alt: "presentazione", placeholder: true, source: "renderer" }],
    seo: { title: "Pizzeria Da Mimmo", description: "Pizzeria di quartiere." },
    copy: neutralCopy("Pizzeria Da Mimmo", "pizzeria"),
    incomplete: [],
    sources: ["google_places"],
    generated_at: AT,
    ...over,
  };
}

const render = (s: SiteSpec, showProvenance = false) =>
  renderToStaticMarkup(<SiteRenderer spec={s} showProvenance={showProvenance} />);

describe("SiteRenderer", () => {
  it("stampa i dati verificati", () => {
    const html = render(spec());
    assert.match(html, /Pizzeria Da Mimmo/);
    assert.match(html, /Pizza al forno a legna/);
    assert.match(html, /080 1234567/);
  });

  it("una CTA telefonica diventa un link tel:", () => {
    assert.match(render(spec()), /href="tel:0801234567"/);
  });

  it("uno script nel nome viene scritto come testo, non eseguito", () => {
    const s = spec();
    s.business.name = verified("<script>alert(1)</script>");
    const html = render(s);
    assert.ok(!html.includes("<script>"), "tag script finito nel markup");
    assert.match(html, /&lt;script&gt;/, "il testo non è stato scritto come tale");
  });

  it("un tag nel copy viene escapato", () => {
    const s = spec();
    s.copy.hero_title = "<img src=x onerror=alert(1)>";
    const html = render(s);
    assert.ok(!html.includes("<img src=x"), "markup iniettato dal copy");
    assert.match(html, /&lt;img/);
  });

  it("un href javascript: nella CTA viene scartato", () => {
    const s = spec({
      cta: { label: "Apri", kind: "maps", target: "javascript:alert(1)" },
    });
    const html = render(s);
    assert.ok(!html.includes("javascript:"), "schema javascript: sopravvissuto");
    // Senza href valido la CTA diventa testo, non un link cieco.
    assert.ok(!html.includes('href="javascript'), "link pericoloso renderizzato");
  });

  it("un data: URI su un'immagine viene scartato in favore del segnaposto", () => {
    const s = spec({
      images: [
        {
          url: "data:text/html;base64,PHNjcmlwdD4=",
          alt: "x",
          placeholder: false,
          source: "ignota",
        },
      ],
    });
    const html = render(s);
    assert.ok(!html.includes("data:text/html"), "data URI renderizzato");
    // Al posto dell'immagine il renderer disegna il pannello con il
    // monogramma: "PD" da "Pizzeria Da Mimmo".
    assert.match(html, /role="img"/, "nessun segnaposto disegnato al suo posto");
    assert.match(html, />PD</, "monogramma assente dal segnaposto");
  });

  it("un maps_url http viene mantenuto ma marcato nofollow", () => {
    const s = spec();
    s.business.maps_url = verified("https://maps.google.com/?cid=1");
    const html = render(s);
    assert.match(html, /https:\/\/maps\.google\.com/);
    assert.match(html, /rel="nofollow noopener"/);
  });

  it("le sezioni senza corpo non lasciano paragrafi vuoti", () => {
    const html = render(spec({ sections: [{ kind: "contact", title: "Contatti" }] }));
    assert.ok(!html.includes("<p class=\"mt-2 text-sm leading-relaxed opacity-85 sm:text-base\"></p>"));
  });

  it("senza recensioni verificate non stampa nessun rating", () => {
    const html = render(spec());
    assert.ok(!html.includes("su 5"), "rating mostrato senza dato");
  });

  it("con recensioni verificate mostra il valore reale", () => {
    const html = render(spec({ reviews: { rating: verified(4.6), count: verified(212) } }));
    assert.match(html, /4\.6 su 5/);
    assert.match(html, /212 recensioni/);
  });

  it("il pannello provenienza è nascosto per default", () => {
    assert.ok(!render(spec()).includes("Provenienza dati"));
  });

  it("il pannello provenienza elenca le fonti quando richiesto", () => {
    const html = render(spec(), true);
    assert.match(html, /Provenienza dati/);
    assert.match(html, /google_places/);
  });

  it("dichiara che i contenuti vanno verificati col titolare", () => {
    assert.match(render(spec()), /da verificare con il titolare/i);
  });
});
