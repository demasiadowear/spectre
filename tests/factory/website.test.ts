import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ELIGIBLE_SCORE,
  MAX_SCORE,
  SLOW_MS,
  isEligible,
  scoreWebsite,
  type SiteProbe,
} from "@/lib/factory/website";

// ============================================================
// Punteggio opportunità. Funzione pura: nessuna rete nei test.
// Ogni punto deve essere giustificato da una `reason` misurabile —
// un punteggio senza motivazione non è vendibile a nessuno.
// ============================================================

const GOOD_HTML = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pizzeria</title></head><body>
<a href="tel:+390801234567">Chiamaci</a>
<a href="#form">Prenota un tavolo</a>
${"<p>Contenuto reale della pagina.</p>".repeat(200)}
</body></html>`;

function probe(over: Partial<SiteProbe> = {}): SiteProbe {
  return {
    url: "https://esempio.it",
    reachable: true,
    http_status: 200,
    response_ms: 400,
    https: true,
    html: GOOD_HTML,
    error: "",
    ...over,
  };
}

describe("scoreWebsite", () => {
  it("nessun sito = opportunità massima", () => {
    const a = scoreWebsite(null);
    assert.equal(a.status, "no_website");
    assert.equal(a.opportunity_score, 100);
    assert.equal(a.reasons[0].code, "no_website");
  });

  it("sito buono = punteggio basso e stato accettabile", () => {
    const a = scoreWebsite(probe());
    assert.equal(a.status, "acceptable");
    assert.equal(a.opportunity_score, 0);
    assert.equal(isEligible(a), false);
  });

  it("sito irraggiungibile pesa quasi come l'assenza di sito", () => {
    const a = scoreWebsite(probe({ reachable: false, html: "", error: "ENOTFOUND" }));
    assert.equal(a.status, "offline");
    assert.equal(a.opportunity_score, 90);
    assert.equal(a.reasons[0].measured, "ENOTFOUND");
  });

  it("500 è un errore server, non un 404", () => {
    const a = scoreWebsite(probe({ http_status: 503, html: "" }));
    assert.equal(a.status, "offline");
    assert.equal(a.reasons[0].code, "server_error");
    assert.equal(a.reasons[0].measured, "HTTP 503");
  });

  it("404 diventa blocked, non offline", () => {
    const a = scoreWebsite(probe({ http_status: 404, html: "" }));
    assert.equal(a.status, "blocked");
    assert.equal(a.reasons[0].code, "not_found");
  });

  it("200 senza HTML = contenuto non leggibile", () => {
    const a = scoreWebsite(probe({ html: "" }));
    assert.equal(a.status, "blocked");
    assert.equal(a.opportunity_score, 60);
  });

  it("assenza di viewport è il problema dominante", () => {
    const a = scoreWebsite(probe({ html: GOOD_HTML.replace(/<meta name="viewport"[^>]*>/, "") }));
    assert.equal(a.status, "not_mobile");
    assert.equal(a.has_viewport, false);
    assert.ok(a.reasons.some((r) => r.code === "not_mobile"));
    assert.ok(a.opportunity_score >= 30);
  });

  it("http senza TLS viene segnalato", () => {
    const a = scoreWebsite(probe({ https: false, url: "http://esempio.it" }));
    assert.equal(a.status, "insecure");
    assert.ok(a.reasons.some((r) => r.code === "insecure"));
  });

  it("markup datato viene riconosciuto", () => {
    const a = scoreWebsite(
      probe({ html: GOOD_HTML.replace("<body>", "<body><font size=3>vecchio</font>") }),
    );
    assert.equal(a.status, "outdated");
  });

  it("risposta lenta viene misurata", () => {
    const a = scoreWebsite(probe({ response_ms: SLOW_MS + 1 }));
    assert.equal(a.status, "slow");
    const slow = a.reasons.find((r) => r.code === "slow");
    assert.equal(slow?.measured, `${SLOW_MS + 1} ms`);
  });

  it("nessun contatto cliccabile viene rilevato", () => {
    const a = scoreWebsite(probe({ html: GOOD_HTML.replace(/<a href="tel:[^"]*">[^<]*<\/a>/, "") }));
    assert.equal(a.has_contacts, false);
    assert.equal(a.status, "no_contacts");
  });

  it("pagina scarna prende il punto thin", () => {
    const a = scoreWebsite(
      probe({ html: `<html><head><meta name="viewport" content="width=device-width"></head><body>
        <a href="tel:+390801234567">chiama</a><p>prenota</p></body></html>` }),
    );
    assert.ok(a.reasons.some((r) => r.code === "thin"));
  });

  it("ogni motivazione ha codice, etichetta e punti", () => {
    const a = scoreWebsite(probe({ https: false, response_ms: 9999, html: "<html><body>x</body></html>" }));
    for (const r of a.reasons) {
      assert.ok(r.code.length > 0, "codice mancante");
      assert.ok(r.label.length > 0, `etichetta mancante per ${r.code}`);
      assert.equal(typeof r.points, "number");
    }
  });

  it("il punteggio non supera mai il tetto", () => {
    const a = scoreWebsite(
      probe({ https: false, response_ms: 99_999, html: "<html><frameset></frameset></html>" }),
    );
    assert.ok(a.opportunity_score <= MAX_SCORE, `${a.opportunity_score} > ${MAX_SCORE}`);
  });

  it("il punteggio è la somma dei punti delle motivazioni", () => {
    const a = scoreWebsite(probe({ https: false, response_ms: SLOW_MS + 500 }));
    const sum = a.reasons.reduce((s, r) => s + r.points, 0);
    assert.equal(a.opportunity_score, Math.min(MAX_SCORE, sum));
  });
});

describe("isEligible", () => {
  it("un sito assente è sempre eleggibile", () => {
    assert.equal(isEligible(scoreWebsite(null)), true);
  });

  it("un sito a posto non è eleggibile nemmeno con qualche punto", () => {
    const a = scoreWebsite(probe());
    a.opportunity_score = 99;
    assert.equal(isEligible(a), false, "stato acceptable deve prevalere sul punteggio");
  });

  it("sotto soglia non è eleggibile", () => {
    const a = scoreWebsite(probe({ https: false }));
    assert.equal(a.opportunity_score < ELIGIBLE_SCORE, true);
    assert.equal(isEligible(a), false);
  });

  it("un sito non mobile e insicuro supera la soglia", () => {
    const a = scoreWebsite(
      probe({ https: false, html: GOOD_HTML.replace(/<meta name="viewport"[^>]*>/, "") }),
    );
    assert.ok(a.opportunity_score >= ELIGIBLE_SCORE);
    assert.equal(isEligible(a), true);
  });
});
