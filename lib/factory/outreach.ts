import { geminiJSON } from "@/lib/gemini";
import { findBannedClaims } from "./sitespec";
import type { OutreachDraft, SiteSpec, WebsiteAnalysis } from "@/types/factory";

// ============================================================
// Outreach PREPARATO. Questo modulo non spedisce niente: produce un
// testo che Puccio legge, corregge e manda a mano, come già fa nel
// resto di SPECTER. Nessuna API di invio è importata qui, e non è una
// dimenticanza: è il confine del sistema.
//
// Regole del messaggio:
//  - si cita solo ciò che è stato MISURATO sul sito del prospect
//    (le `reasons` dell'analisi, con il loro valore), mai un giudizio
//    inventato;
//  - AyroStar non c'entra: quello è il prodotto fisico (card NFC/QR e
//    supporto forex che aprono la pagina recensioni Google). Qui si
//    propone un SITO, che è un servizio distinto;
//  - nessuna promessa di risultato, nessun prezzo, nessuna scadenza
//    finta.
// ============================================================

/** Motivazioni tradotte in frasi che si possono dire a voce senza mentire. */
const REASON_PHRASES: Record<string, string> = {
  no_website: "non ho trovato un sito collegato alla scheda Google",
  offline: "il sito non risponde",
  server_error: "il sito risponde con un errore del server",
  not_found: "la pagina del sito non esiste più",
  blocked: "il sito non mostra contenuti leggibili",
  insecure: "il sito è senza HTTPS e i browser lo segnalano come non sicuro",
  not_mobile: "il sito non è adattato al telefono",
  outdated: "il sito usa tecnologie molto datate",
  no_cta: "sul sito non c'è un punto chiaro per prenotare o contattare",
  no_contacts: "sul sito non c'è un contatto cliccabile",
  slow: "il sito è lento ad aprirsi",
  thin: "il sito ha pochissimo contenuto",
  acceptable: "il sito è già in ordine",
};

/** Riassunto dei RILIEVI MISURATI. Niente aggettivi, solo fatti. */
export function auditSummary(analysis: WebsiteAnalysis): string {
  const real = analysis.reasons.filter((r) => r.points > 0);
  if (real.length === 0) return "Nessun rilievo tecnico sul sito attuale.";
  const parts = real.slice(0, 4).map((r) => {
    const phrase = REASON_PHRASES[r.code] ?? r.label.toLowerCase();
    return r.measured ? `${phrase} (${r.measured})` : phrase;
  });
  return `${parts.join("; ")}.`;
}

/** Motivo per cui questo lead è stato scelto: tracciabile, non "AI". */
export function outreachReason(analysis: WebsiteAnalysis): string {
  if (analysis.status === "no_website") {
    return "Nessun sito collegato alla scheda Google.";
  }
  const top = [...analysis.reasons].sort((a, b) => b.points - a.points)[0];
  const phrase = top ? REASON_PHRASES[top.code] ?? top.label : "sito migliorabile";
  return `Punteggio opportunità ${analysis.opportunity_score}/100: ${phrase}.`;
}

interface OutreachAi {
  whatsapp?: unknown;
  email_subject?: unknown;
  email_body?: unknown;
  call_opening?: unknown;
  objections?: unknown;
}

const SYSTEM_PROMPT = `Sei un venditore italiano di servizi web per micro-imprese locali.
Scrivi messaggi di primo contatto brevi, concreti, senza fronzoli.

VINCOLI ASSOLUTI:
- Non inventare prezzi, sconti, promozioni, scadenze o disponibilità limitate.
- Non promettere risultati ("più clienti", "primo su Google", "raddoppia il fatturato").
- Non citare anni di esperienza, certificazioni, premi, portfolio o altri clienti.
- Non dire di aver già lavorato con nessuno.
- Usa SOLO i rilievi tecnici che ti vengono forniti: non aggiungerne altri.
- Niente em-dash. Italiano naturale e parlato. Nessun punto esclamativo.
- Dai del lei.

Il messaggio WhatsApp deve stare in 5 righe, presentarsi, dire cosa si è
notato sul sito (o la sua assenza), dire che è già stata preparata
un'anteprima e chiedere solo il permesso di mandare il link.

Rispondi SOLO con questo JSON:
{
  "whatsapp": "...",
  "email_subject": "max 60 caratteri",
  "email_body": "5-8 righe",
  "call_opening": "2-3 frasi da dire al telefono nei primi 15 secondi",
  "objections": [{ "objection": "...", "answer": "..." }]
}`;

const asText = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** Testo scartato se contiene affermazioni inventate. */
function clean(value: string, fallback: string): string {
  if (!value) return fallback;
  return findBannedClaims(value).length ? fallback : value;
}

function parseObjections(raw: unknown): { objection: string; answer: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 5)
    .map((o) => ({
      objection: asText((o as { objection?: unknown })?.objection, 160),
      answer: asText((o as { answer?: unknown })?.answer, 400),
    }))
    .filter((o) => o.objection && o.answer && !findBannedClaims(o.answer).length);
}

export interface OutreachInput {
  business_name: string;
  category: string;
  city?: string;
  analysis: WebsiteAnalysis;
  /** URL della demo già pronta. Il messaggio lo cita ma non lo incolla:
   *  il link lo manda Puccio quando il titolare dice sì. */
  demo_url: string;
  spec?: SiteSpec | null;
}

/** Fallback deterministico: se Gemini non c'è, il messaggio esiste
 *  comunque. Un modulo commerciale che tace quando manca una API key
 *  sarebbe inutile proprio nei giorni in cui serve. */
export function fallbackDraft(input: OutreachInput): OutreachDraft {
  const summary = auditSummary(input.analysis);
  const name = input.business_name;
  const whatsapp = [
    `Buongiorno, le scrivo per ${name}.`,
    input.analysis.status === "no_website"
      ? "Ho notato che la scheda Google non ha un sito collegato."
      : `Ho dato un'occhiata al sito e ho notato una cosa: ${summary.toLowerCase()}`,
    "Ho già preparato una bozza di come potrebbe essere, senza impegno.",
    "Se le va le mando il link e mi dice se ha senso per lei.",
  ].join("\n");

  return {
    reason: outreachReason(input.analysis),
    audit_summary: summary,
    whatsapp,
    email_subject: `Una bozza di sito per ${name}`,
    email_body: [
      `Buongiorno,`,
      ``,
      `le scrivo a proposito di ${name}.`,
      input.analysis.status === "no_website"
        ? `Ho notato che alla scheda Google non risulta collegato un sito.`
        : `Guardando il sito attuale ho annotato questo: ${summary}`,
      ``,
      `Ho preparato una bozza di anteprima, senza impegno da parte sua.`,
      `Se le interessa le mando il link e ne parliamo.`,
      ``,
      `Buona giornata.`,
    ].join("\n"),
    call_opening: `Buongiorno, chiamo per ${name}. ${
      input.analysis.status === "no_website"
        ? "Ho visto che la scheda Google non ha un sito collegato"
        : "Ho guardato il sito e c'è un punto che le farebbe comodo sistemare"
    }. Ho già preparato una bozza: le posso mandare il link?`,
    cta: "Chiedere il permesso di inviare il link della bozza.",
    objections: [
      {
        objection: "Non mi serve un sito, ho la pagina Facebook.",
        answer:
          "Capisco. La pagina resta. Il sito serve per chi la cerca su Google e non su Facebook. Guardi la bozza e mi dice.",
      },
      {
        objection: "Quanto costa?",
        answer:
          "Le dico volentieri i numeri, ma prima guardi la bozza: se non le piace, il prezzo non serve a niente.",
      },
      {
        objection: "Ci penso.",
        answer: "Va bene. Le lascio il link e la richiamo fra qualche giorno, senza insistere.",
      },
    ],
    next_followup_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  };
}

/** Prepara la bozza. Non invia nulla, per costruzione. */
export async function prepareOutreach(
  input: OutreachInput,
): Promise<{ draft: OutreachDraft; used_ai: boolean }> {
  const fallback = fallbackDraft(input);
  const summary = auditSummary(input.analysis);

  const userPrompt = [
    `Attività: ${input.business_name}`,
    `Categoria: ${input.category}`,
    input.city ? `Città: ${input.city}` : "",
    `Rilievi tecnici misurati sul sito attuale (usa solo questi): ${summary}`,
    `Stato sito: ${input.analysis.status}`,
    `Anteprima già pronta: sì (il link lo invia una persona, non citarlo per intero)`,
  ]
    .filter(Boolean)
    .join("\n");

  const ai = await geminiJSON<OutreachAi>(SYSTEM_PROMPT, userPrompt, {
    complex: true,
    temperature: 0.5,
    maxOutputTokens: 1200,
  });
  if (!ai) return { draft: fallback, used_ai: false };

  const objections = parseObjections(ai.objections);
  return {
    draft: {
      reason: fallback.reason,
      audit_summary: summary,
      whatsapp: clean(asText(ai.whatsapp, 900), fallback.whatsapp),
      email_subject: clean(asText(ai.email_subject, 80), fallback.email_subject),
      email_body: clean(asText(ai.email_body, 1800), fallback.email_body),
      call_opening: clean(asText(ai.call_opening, 600), fallback.call_opening),
      cta: fallback.cta,
      objections: objections.length ? objections : fallback.objections,
      next_followup_at: fallback.next_followup_at,
    },
    used_ai: true,
  };
}
