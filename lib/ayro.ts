import type { Lead, LeadStatus } from "@/types";
import type { AyroResponse } from "@/types/voice";
import { cityOf, isStale, nextBestAction } from "@/lib/pitch";

// ============================================================
// AYRO — conversational agent layer over SPECTRE.
// Builds a compact CRM digest for Gemini and a deterministic
// fallback so the agent still answers basic data questions when
// no Gemini key is configured.
// ============================================================

export interface CrmDigest {
  total: number;
  open: number;
  closed: number;
  lost: number;
  urgent: number;
  pipeline_eur: number;
  cash_eur: number;
  by_status: Partial<Record<LeadStatus, number>>;
  leads: {
    name: string;
    company: string;
    status: LeadStatus;
    value: number;
    rating?: number;
    reviews?: number;
    city: string;
    phone: string;
    next: string;
    stale: boolean;
  }[];
}

export function buildCrmDigest(leads: Lead[]): CrmDigest {
  const open = leads.filter((l) => l.status !== "closed" && l.status !== "lost");
  const closed = leads.filter((l) => l.status === "closed");
  const lost = leads.filter((l) => l.status === "lost");
  const by_status: Partial<Record<LeadStatus, number>> = {};
  for (const l of leads) by_status[l.status] = (by_status[l.status] ?? 0) + 1;

  return {
    total: leads.length,
    open: open.length,
    closed: closed.length,
    lost: lost.length,
    urgent: open.filter(isStale).length,
    pipeline_eur: open.reduce((s, l) => s + l.value, 0),
    cash_eur: closed.reduce((s, l) => s + (l.meta.closed_price ?? l.value), 0),
    by_status,
    leads: leads.map((l) => ({
      name: l.name,
      company: l.company,
      status: l.status,
      value: l.value,
      rating: l.meta.rating,
      reviews: l.meta.reviews,
      city: cityOf(l),
      phone: l.phone,
      next: nextBestAction(l).title,
      stale: isStale(l),
    })),
  };
}

export const AYRO_SYSTEM_PROMPT = `Sei AYRO, l'assistente AI vocale di SPECTRE — il CRM di vendita di Christian (AYROMEX, vende siti web e automazioni AI a PMI locali in Puglia). Parli italiano, diretto, conciso: le tue risposte vengono LETTE ad alta voce, quindi frasi brevi, niente elenchi lunghi, niente markdown.

Ricevi un JSON con: "transcript" (cosa ha detto l'utente) e "crm" (un digest dei suoi lead: conteggi, pipeline, cash, e la lista lead con status/valore/città/prossima azione).

I tuoi compiti:
1. Se è una DOMANDA sui dati (es. "quanti devo chiamare oggi", "com'è il deal con La Cantina dello Zio", "quanto ho in pipeline", "chi è urgente") → rispondi con i numeri/fatti reali presi dal crm. Cita nomi e cifre concrete.
2. Se è una RICHIESTA DI AZIONE → imposta "action":
   - aprire un modulo: {"type":"navigate","payload":{"route":"/visor|/cockpit|/hunter|/whisper|/hand|/oracle|/territorio|/forecast"}}
   - cercare attività nuove: {"type":"hunt","payload":{"category":"ristoranti","city":"Bari"}}
   - cercare un lead nel CRM: {"type":"search","payload":{"query":"nome"}}
   - filtrare per stato: {"type":"filter","payload":{"status":"todo|step1_sent|replied|step2_sent|preview_sent|negotiating|closed|lost"}}
   - generare proposta: {"type":"generate","payload":{"leadName":"nome"}}
   - simulare chiusura: {"type":"simulate","payload":{"leadName":"nome"}}
   Quando metti un'azione, in "speak" conferma a voce cosa stai facendo.
3. Se non è chiaro, chiedi UNA precisazione breve.

Gli stati funnel significano: todo=da contattare, step1_sent=primo messaggio inviato, replied=ha risposto, step2_sent=conferma inviata, preview_sent=preview consegnata, negotiating=in trattativa, closed=cliente chiuso, lost=perso. "stale=true" = lead fermo da troppo, urgente.

Rispondi SOLO con JSON valido:
{"speak": string, "action": {"type": "navigate"|"hunt"|"search"|"filter"|"generate"|"simulate"|"none", "payload": object} }
Se non serve azione usa "type":"none". Niente testo fuori dal JSON.`;

/** Deterministic fallback for basic questions when Gemini is unavailable. */
export function mockAyro(digest: CrmDigest, transcript: string): AyroResponse {
  const t = transcript.toLowerCase();

  if (/(quant|oggi|chiamare|urgent|da fare)/.test(t)) {
    return {
      speak: `Hai ${digest.urgent} lead urgenti e ${digest.open} aperti in totale. La pipeline vale ${Math.round(digest.pipeline_eur)} euro. Apri il Cockpit per lavorarli.`,
      action: { type: "navigate", payload: { route: "/cockpit" } },
    };
  }
  if (/(pipeline|quanto.*pipeline|valore)/.test(t)) {
    return {
      speak: `Pipeline aperta: ${Math.round(digest.pipeline_eur)} euro su ${digest.open} lead. Cash chiuso: ${Math.round(digest.cash_eur)} euro.`,
      action: { type: "none" },
    };
  }
  // Try to match a lead by name.
  const hit = digest.leads.find((l) =>
    t.includes(l.name.toLowerCase().split(" ")[0]) ||
    t.includes(l.company.toLowerCase().split(" ")[0]),
  );
  if (hit) {
    return {
      speak: `${hit.name}: stato ${hit.status}, valore ${hit.value} euro. ${hit.next}.`,
      action: { type: "none" },
    };
  }
  return {
    speak: "Per ragionare su questa serve l'AI: in locale gira senza chiave Gemini. Sul sito funziona.",
    action: { type: "none" },
  };
}
