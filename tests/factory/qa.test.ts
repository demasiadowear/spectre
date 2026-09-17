import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QA_PASS_SCORE, qaSummary, runQa, runSpecChecks, scoreChecks } from "@/lib/factory/qa";
import { SPEC_VERSION, factOf, neutralCopy } from "@/lib/factory/sitespec";
import type { Fact, QaCheck, SiteSpec } from "@/types/factory";

// ============================================================
// QA come cancello. La proprietà che conta: nessuna combinazione di
// controlli minori superati può far passare una demo con un difetto
// bloccante. Il punteggio informa, non autorizza.
// ============================================================

const AT = "2026-09-17T10:00:00.000Z";
const verified = <T,>(v: T): Fact<T> => factOf<T>(v, "google_places", "places_search", "verified", AT);

function goodSpec(over: Partial<SiteSpec> = {}): SiteSpec {
  return {
    spec_version: SPEC_VERSION,
    lead_id: "lead-1",
    business: {
      name: verified("Pizzeria Da Mimmo"),
      category: verified("pizzeria"),
      phone: verified("080 1234567"),
      address: verified("Via Roma 1, Bari"),
    },
    services: [verified("Pizza al forno a legna")],
    sections: [
      { kind: "services", title: "Servizi" },
      { kind: "about", title: "Chi siamo", body: "Pizzeria di quartiere." },
      { kind: "contact", title: "Contatti" },
    ],
    cta: { label: "Chiama", kind: "call", target: "080 1234567" },
    palette: { primary: "#2FB4C9", accent: "#7FD9E6", bg: "#0D1316", fg: "#EDF6F8" },
    images: [{ url: "", alt: "presentazione", placeholder: true, source: "renderer" }],
    seo: { title: "Pizzeria Da Mimmo", description: "Pizzeria di quartiere a Bari." },
    copy: neutralCopy("Pizzeria Da Mimmo", "pizzeria"),
    incomplete: [],
    sources: ["google_places"],
    generated_at: AT,
    ...over,
  };
}

const blocking = (checks: QaCheck[]) => checks.filter((c) => c.blocking && !c.passed).map((c) => c.code);

describe("runSpecChecks", () => {
  it("una spec pulita non ha rilievi bloccanti", () => {
    assert.deepEqual(blocking(runSpecChecks(goodSpec())), []);
  });

  it("una spec nulla è bocciata subito", () => {
    const checks = runSpecChecks(null);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].code, "spec_valid");
    assert.equal(checks[0].passed, false);
  });

  it("un fatto senza fonte è bloccante", () => {
    const spec = goodSpec();
    spec.business.phone = { value: "080 1", source: "", method: "", observed_at: AT, band: "verified" };
    // Qui scatta la validazione strutturale, che è la prima delle due
    // difese: un business.* senza fonte non è nemmeno una spec valida,
    // quindi non arriva al controllo di provenienza. Ciò che conta è
    // che venga bloccato, non da quale dei due.
    assert.ok(blocking(runSpecChecks(spec)).includes("spec_valid"));
  });

  it("un servizio senza fonte è bloccante", () => {
    const spec = goodSpec({
      services: [{ value: "Catering", source: "", method: "", observed_at: AT, band: "possible" }],
    });
    assert.ok(blocking(runSpecChecks(spec)).includes("all_facts_sourced"));
  });

  it("un prezzo nel copy è bloccante", () => {
    const spec = goodSpec();
    spec.copy.about = "Pizze da 6 euro.";
    assert.ok(blocking(runSpecChecks(spec)).includes("no_invented_claims"));
  });

  it("un'affermazione nel titolo di sezione è bloccante", () => {
    const spec = goodSpec();
    spec.sections[1].title = "I migliori della città";
    assert.ok(blocking(runSpecChecks(spec)).includes("no_invented_claims"));
  });

  it("un'affermazione nella descrizione SEO è bloccante", () => {
    const spec = goodSpec();
    spec.seo.description = "Attivi dal 1990 con soddisfazione garantita.";
    assert.ok(blocking(runSpecChecks(spec)).includes("no_invented_claims"));
  });

  it("un'immagine di terzi senza fonte è bloccante", () => {
    const spec = goodSpec({
      images: [{ url: "https://cdn.terzi.it/a.jpg", alt: "a", placeholder: false, source: "" }],
    });
    assert.ok(blocking(runSpecChecks(spec)).includes("images_authorized"));
  });

  it("una CTA senza contatto è un rilievo minore, non un blocco", () => {
    const spec = goodSpec();
    spec.cta.target = "";
    const checks = runSpecChecks(spec);
    assert.deepEqual(blocking(checks), []);
    const cta = checks.find((c) => c.code === "cta_actionable");
    assert.equal(cta?.passed, false);
    assert.equal(cta?.blocking, false);
  });

  it("ogni controllo ha codice ed etichetta leggibile", () => {
    for (const c of runSpecChecks(goodSpec())) {
      assert.ok(c.code.length > 0);
      assert.ok(c.label.length > 0, `etichetta mancante per ${c.code}`);
    }
  });
});

describe("scoreChecks", () => {
  it("un controllo bloccante fallito boccia, qualunque punteggio", () => {
    const checks: QaCheck[] = [
      { code: "a", label: "A", passed: false, blocking: true, detail: "" },
      ...Array.from({ length: 30 }, (_, i) => ({
        code: `ok${i}`,
        label: `OK ${i}`,
        passed: true,
        blocking: false,
        detail: "",
      })),
    ];
    const { passed, score } = scoreChecks(checks);
    assert.ok(score >= QA_PASS_SCORE, "il punteggio dovrebbe essere alto");
    assert.equal(passed, false, "un blocco è stato comprato col punteggio");
  });

  it("senza blocchi ma sotto soglia non passa", () => {
    const checks: QaCheck[] = Array.from({ length: 10 }, (_, i) => ({
      code: `c${i}`,
      label: `C ${i}`,
      passed: i < 5,
      blocking: false,
      detail: "",
    }));
    assert.equal(scoreChecks(checks).passed, false);
  });

  it("una lista vuota non passa", () => {
    assert.deepEqual(scoreChecks([]), { passed: false, score: 0 });
  });
});

describe("runQa", () => {
  it("promuove una spec pulita", async () => {
    const report = await runQa(goodSpec());
    assert.equal(report.passed, true, qaSummary(report));
    assert.ok(report.score >= QA_PASS_SCORE);
    assert.ok(report.checked_at);
  });

  it("boccia una spec con dati non tracciabili", async () => {
    const spec = goodSpec();
    spec.business.address = { value: "Via Falsa 1", source: "", method: "", observed_at: AT, band: "verified" };
    const report = await runQa(spec);
    assert.equal(report.passed, false);
  });

  it("senza screenshot richiesti non prova nemmeno ad aprire il browser", async () => {
    const report = await runQa(goodSpec());
    assert.equal(report.checks.some((c) => c.code === "screenshot_ok"), false);
    assert.deepEqual(report.screenshots, { desktop: "", mobile: "" });
  });

  it("uno screenshot fallito non boccia la demo", async () => {
    // URL inesistente: il browser non parte o non raggiunge nulla.
    const report = await runQa(goodSpec(), {
      screenshots: true,
      previewUrl: "http://127.0.0.1:1/preview/x",
    });
    const shot = report.checks.find((c) => c.code === "screenshot_ok");
    assert.equal(shot?.passed, false);
    assert.equal(shot?.blocking, false, "lo screenshot non deve bloccare");
    assert.equal(report.passed, true, "un problema di browser ha bocciato una demo valida");
  });
});

describe("qaSummary", () => {
  it("dice che è tutto a posto quando lo è", async () => {
    assert.match(qaSummary(await runQa(goodSpec())), /superato/i);
  });

  it("nomina i rilievi bloccanti", async () => {
    const spec = goodSpec();
    spec.copy.hero_title = "Sconto del 30%";
    const summary = qaSummary(await runQa(spec));
    assert.match(summary, /bloccanti/i);
    assert.match(summary, /inventata/i);
  });
});
