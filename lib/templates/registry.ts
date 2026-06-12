// ============================================================
// TEMPLATE MANAGER — registry client-safe (zero import server).
// Chiavi, placeholder documentati e resolver condivisi tra la
// pagina /templates, Cockpit/Visor (LeadActionPanel) e le API.
// Il worker ha il suo resolver gemello in worker/lib/templates.mjs
// (stesse regole: tenere allineati).
// ============================================================

export const TEMPLATE_KEYS = [
  "study_wa_instructions",
  "outreach_variant_b",
  "outreach_variant_c",
  "followup_day3",
  "followup_day7",
  "archive_reject",
  "demo_ready",
  "manual_step1",
  "manual_step2",
  "manual_step3",
  "bypass_autoreply",
  "escalation_notify",
  "demo_request_notify",
  "human_reply_notify",
  "kill_switch_notify",
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export interface MessageTemplate {
  key: TemplateKey;
  label: string;
  content: string;
  variables: string[];
  updated_at: string;
}

/** Placeholder uniformi — risolti all'invio (worker) o al render (UI).
 *  {SALUTO} resta SEMPRE irrisolto fino al momento dell'invio: è il
 *  worker (o la UI al click) a sostituirlo con il saluto per l'orario. */
export const PLACEHOLDER_DOCS: Record<string, string> = {
  "{SALUTO}": "Buongiorno (9-14) / Buon pomeriggio (14-20), risolto all'invio",
  "{NOME_ATTIVITA}": "nome dell'attività (es. Salone Marisa)",
  "{RATING}": "stelle Google (es. 4.9)",
  "{N_RECENSIONI}": "numero recensioni Google (es. 140)",
  "{COMPLIMENTO}": "frase stelle+recensioni già composta, con fallback se i dati mancano",
  "{CATEGORIA}": "tipo attività (es. salone, ristorante)",
  "{CITTA}": "città del lead",
  "{URL_DEMO}": "link della demo/preview",
  "{RIGA_PREZZO}": "riga prezzo completa, vuota se il prezzo non è impostato",
  "{TELEFONO}": "telefono del lead",
  "{MOTIVO}": "motivo di escalation/blocco",
  "{RIASSUNTO}": "riassunto AI della chat",
  "{MESSAGGIO}": "testo del messaggio ricevuto dal lead",
  "{LINK_CHAT}": "link wa.me alla chat del lead",
};

export interface TemplateVars {
  NOME_ATTIVITA?: string;
  RATING?: string;
  N_RECENSIONI?: string;
  COMPLIMENTO?: string;
  CATEGORIA?: string;
  CITTA?: string;
  URL_DEMO?: string;
  RIGA_PREZZO?: string;
  TELEFONO?: string;
  MOTIVO?: string;
  RIASSUNTO?: string;
  MESSAGGIO?: string;
  LINK_CHAT?: string;
  /** Solo per anteprime/UI: il worker lo risolve all'invio. */
  SALUTO?: string;
}

/** Sostituisce i placeholder presenti in vars; {SALUTO} resta com'è
 *  se non passato (lo risolve il worker al momento dell'invio). */
export function renderTemplate(content: string, vars: TemplateVars): string {
  let out = content;
  for (const [name, value] of Object.entries(vars)) {
    if (value === undefined) continue;
    out = out.replaceAll(`{${name}}`, value);
  }
  return out;
}

/** Saluto coerente con l'orario (stessa regola del worker):
 *  Buongiorno fino alle 14, Buon pomeriggio dopo. Mai Buonasera. */
export function greetingNow(date = new Date()): string {
  const hour = Number(
    date.toLocaleString("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", hour12: false }),
  );
  return hour < 14 ? "Buongiorno" : "Buon pomeriggio";
}

/** Frase complimento stelle+recensioni con fallback (ex lib/pitch
 *  compliment): mai numeri inventati, se mancano si resta generici. */
export function complimentFor(rating?: number | null, reviews?: number | null): string {
  const r = rating ?? 0;
  const n = reviews ?? 0;
  if (r === 5 && n >= 100) return `${n} recensioni 5.0 su Google`;
  if (r === 5) return `5.0 su Google con ${n} recensioni`;
  if (r >= 4.9 && n >= 200) return `${n} recensioni a ${r}★`;
  if (r && n) return `${r}★ con ${n} recensioni su Google`;
  return "numeri importanti su Google";
}

/** Lead fittizio per l'anteprima in /templates (nessun dato reale). */
export const PREVIEW_VARS: Required<Omit<TemplateVars, "SALUTO">> & { SALUTO: string } = {
  SALUTO: greetingNow(),
  NOME_ATTIVITA: "Salone Marisa",
  RATING: "4.9",
  N_RECENSIONI: "140",
  COMPLIMENTO: complimentFor(4.9, 140),
  CATEGORIA: "salone",
  CITTA: "Bari",
  URL_DEMO: "https://salone-marisa-ayromex.vercel.app",
  RIGA_PREZZO: "\nPrezzo: €499, tutto incluso: dominio, hosting, setup e SEO.\n",
  TELEFONO: "3331234567",
  MOTIVO: "vuole essere richiamato domani alle 15",
  RIASSUNTO: "Titolare interessato, chiede tempi e prezzo. Consiglio: chiamare nel pomeriggio.",
  MESSAGGIO: "Sì mi interessa, quanto costa?",
  LINK_CHAT: "https://wa.me/393331234567",
};
