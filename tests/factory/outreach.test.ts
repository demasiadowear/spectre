import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditSummary, fallbackDraft, outreachReason } from "@/lib/factory/outreach";
import { findBannedClaims } from "@/lib/factory/sitespec";
import { scoreWebsite, type SiteProbe } from "@/lib/factory/website";
import type { WebsiteAnalysis } from "@/types/factory";

// ============================================================
// Outreach preparato. Due proprietà da difendere:
//  1. il messaggio cita solo rilievi MISURATI, non giudizi inventati;
//  2. il modulo non invia niente (nessun canale di uscita importato).
// Senza Gemini si prova il fallback deterministico, che è anche il
// percorso che gira davvero quando manca la API key.
// ============================================================

const noWebsite = (): WebsiteAnalysis => scoreWebsite(null);

function probe(over: Partial<SiteProbe> = {}): SiteProbe {
  return {
    url: "http://vecchiosito.it",
    reachable: true,
    http_status: 200,
    response_ms: 5_000,
    https: false,
    html: "<html><body><p>poco</p></body></html>",
    error: "",
    ...over,
  };
}

const input = (analysis: WebsiteAnalysis) => ({
  business_name: "Pizzeria Da Mimmo",
  category: "pizzeria",
  city: "Bari",
  analysis,
  demo_url: "https://specter.example/preview/abcdefghijklmnopqrstuv",
});

describe("auditSummary", () => {
  it("dice che manca il sito quando manca", () => {
    assert.match(auditSummary(noWebsite()), /non ho trovato un sito/i);
  });

  it("riporta i valori misurati, non aggettivi", () => {
    const summary = auditSummary(scoreWebsite(probe()));
    assert.match(summary, /\(.+\)/, `nessuna misura fra parentesi: ${summary}`);
  });

  it("cita il tempo di risposta quando la lentezza è il rilievo", () => {
    // Sito per il resto in ordine: così `slow` non viene scavalcato dai
    // rilievi che pesano più di lui.
    const summary = auditSummary(
      scoreWebsite(
        probe({
          https: true,
          url: "https://lento.it",
          response_ms: 7_000,
          html: `<html><head><meta name="viewport" content="width=device-width"></head><body>
            <a href="tel:+390801234567">chiama</a><p>prenota</p>${"<p>testo</p>".repeat(600)}</body></html>`,
        }),
      ),
    );
    assert.match(summary, /7000 ms/, summary);
  });

  it("mette per primo il rilievo che pesa di più", () => {
    // not_mobile (30) deve precedere insecure (25), qualunque sia
    // l'ordine in cui i controlli girano.
    const summary = auditSummary(scoreWebsite(probe()));
    assert.ok(
      summary.indexOf("telefono") < summary.indexOf("HTTPS"),
      `ordine per peso non rispettato: ${summary}`,
    );
  });

  it("non inventa rilievi su un sito a posto", () => {
    const good = scoreWebsite(
      probe({
        https: true,
        url: "https://ok.it",
        response_ms: 300,
        html: `<html><head><meta name="viewport" content="width=device-width"></head><body>
          <a href="tel:+390801234567">chiama</a><p>prenota</p>${"<p>testo</p>".repeat(600)}</body></html>`,
      }),
    );
    assert.match(auditSummary(good), /nessun rilievo/i);
  });

  it("non elenca più di quattro rilievi: un messaggio non è un referto", () => {
    const summary = auditSummary(scoreWebsite(probe({ response_ms: 99_999 })));
    assert.ok(summary.split(";").length <= 4, `troppi rilievi: ${summary}`);
  });
});

describe("outreachReason", () => {
  it("motiva l'assenza di sito", () => {
    assert.match(outreachReason(noWebsite()), /Nessun sito collegato/i);
  });

  it("cita punteggio e rilievo principale", () => {
    const reason = outreachReason(scoreWebsite(probe()));
    assert.match(reason, /Punteggio opportunità \d+\/100/);
  });
});

describe("fallbackDraft", () => {
  it("produce tutti i canali, senza inviarne nessuno", () => {
    const draft = fallbackDraft(input(noWebsite()));
    assert.ok(draft.whatsapp.length > 0);
    assert.ok(draft.email_subject.length > 0);
    assert.ok(draft.email_body.length > 0);
    assert.ok(draft.call_opening.length > 0);
    assert.ok(draft.objections.length >= 3);
  });

  it("non contiene affermazioni vietate", () => {
    const draft = fallbackDraft(input(scoreWebsite(probe())));
    for (const [field, text] of [
      ["whatsapp", draft.whatsapp],
      ["email_subject", draft.email_subject],
      ["email_body", draft.email_body],
      ["call_opening", draft.call_opening],
    ] as const) {
      // Le risposte alle obiezioni parlano di prezzo per forza (è la
      // domanda del cliente); i messaggi in uscita no.
      assert.deepEqual(findBannedClaims(text), [], `${field} contiene un'affermazione vietata`);
    }
  });

  it("non incolla il link della demo: lo manda una persona", () => {
    const draft = fallbackDraft(input(noWebsite()));
    const all = [draft.whatsapp, draft.email_body, draft.call_opening].join("\n");
    assert.ok(!all.includes("/preview/"), "il link è già nel messaggio automatico");
  });

  it("non promette risultati", () => {
    const draft = fallbackDraft(input(noWebsite()));
    const all = [draft.whatsapp, draft.email_body, draft.call_opening].join(" ").toLowerCase();
    for (const promessa of ["più clienti", "primo su google", "raddoppia", "garantiamo"]) {
      assert.ok(!all.includes(promessa), `promessa "${promessa}" nel messaggio`);
    }
  });

  it("non nomina AyroStar: il sito è un servizio distinto dal prodotto fisico", () => {
    const draft = fallbackDraft(input(noWebsite()));
    const all = JSON.stringify(draft).toLowerCase();
    assert.ok(!all.includes("ayrostar"), "AyroStar citato in una proposta di sito");
    assert.ok(!all.includes("recension"), "promessa sulle recensioni in una proposta di sito");
  });

  it("propone un follow-up nel futuro", () => {
    const draft = fallbackDraft(input(noWebsite()));
    assert.ok(new Date(draft.next_followup_at).getTime() > Date.now());
  });

  it("il messaggio WhatsApp resta corto", () => {
    const draft = fallbackDraft(input(noWebsite()));
    assert.ok(draft.whatsapp.split("\n").length <= 6, "messaggio troppo lungo per WhatsApp");
  });

  it("non usa em-dash", () => {
    const draft = fallbackDraft(input(scoreWebsite(probe())));
    assert.ok(!JSON.stringify(draft).includes("—"), "em-dash nel testo");
  });
});
