import type { AutopilotLead, AutopilotStage } from "@/types/autopilot";

// ============================================================
// Helper condivisi della vista Autopilot: tempo relativo,
// etichetta "ultima azione", priorità di ordinamento, colori
// di stadio/tier (palette warm-paper).
// ============================================================

export const STAGE_LABELS: Record<AutopilotStage, string> = {
  nuovo: "nuovo",
  studiato: "da contattare",
  contattato: "contattato",
  risposto_manuale: "da rispondere",
  da_chiamare: "da chiamare",
  demo_richiesta: "demo da fare",
  demo_inviata: "demo inviata",
  richiesta_prezzo: "richiesta prezzo",
  in_trattativa: "in trattativa",
  tiepido: "tiepido",
  vinto: "vinto",
  perso: "perso",
  escalation: "escalation",
  archiviato: "archiviato",
};

/** Chip di stadio pieni (testo chiaro su colore funnel). */
export const STAGE_CHIP: Record<AutopilotStage, string> = {
  nuovo: "bg-fn-todo text-onaccent",
  studiato: "bg-ochre text-onaccent",
  contattato: "bg-fn-replied text-onaccent",
  risposto_manuale: "bg-accent text-onaccent",
  da_chiamare: "bg-fn-step1 text-onaccent",
  demo_richiesta: "bg-fn-step2 text-onaccent",
  demo_inviata: "bg-fn-preview text-onaccent",
  richiesta_prezzo: "bg-success text-onaccent",
  in_trattativa: "bg-fn-negotiating text-onaccent",
  tiepido: "bg-ochre text-onaccent",
  vinto: "bg-fn-closed text-onaccent",
  perso: "bg-fn-lost text-onaccent",
  escalation: "bg-danger text-onaccent",
  archiviato: "bg-fn-lost text-onaccent",
};

export const TIER_BADGE: Record<string, string> = {
  T1: "border-success/50 text-success",
  T2: "border-ochre/60 text-ochre",
  T3: "border-border text-text2",
};

/** SQLite salva "YYYY-MM-DD HH:MM:SS" in UTC senza suffisso. */
export function parseDbDate(value: string | null): Date | null {
  if (!value) return null;
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "ora" / "35m fa" / "4h fa" / "3g fa". */
export function timeAgo(value: string | null): string {
  const d = parseDbDate(value);
  if (!d) return "";
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 2) return "ora";
  if (mins < 60) return `${mins}m fa`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h fa`;
  return `${Math.floor(hours / 24)}g fa`;
}

/** Lo stadio "studiato" = lead pronto da contattare a mano (study ha
 *  preparato brief + primo messaggio). Richiede l'azione di Puccio. */
export function isReadyToContact(lead: AutopilotLead): boolean {
  return lead.stage === "studiato";
}

// ----- Agenda (prossima azione manuale) ------------------------

/** next_action_at arriva da <input type="datetime-local">: niente Z,
 *  è ora locale. parseDbDate la tratta correttamente (contiene la T
 *  ma il fuso resta locale per le stringhe senza suffisso). */
export function nextActionDate(lead: AutopilotLead): Date | null {
  if (!lead.next_action_at) return null;
  const d = new Date(lead.next_action_at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Azione in scadenza: oggi o già passata (entra in "richiede azione"). */
export function nextActionDue(lead: AutopilotLead, now = new Date()): boolean {
  const d = nextActionDate(lead);
  if (!d) return false;
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  return d <= endOfToday;
}

/** "oggi 09:00" / "dom 15/06 10:30" / "scaduta 2g fa". */
export function nextActionLabel(lead: AutopilotLead): string {
  const d = nextActionDate(lead);
  if (!d) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `oggi ${time}`;
  if (d < now) {
    const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
    return days === 0 ? `scaduta oggi ${time}` : `scaduta ${days}g fa`;
  }
  return `${d.toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit" })} ${time}`;
}

/** Etichetta di stadio per chip e riga. */
export function stageLabel(lead: AutopilotLead): string {
  return STAGE_LABELS[lead.stage];
}

/**
 * Ordinamento "richiede azione" in cima:
 * scadenza agenda / escalation (0) > risposte e demo da fare (1) >
 * lead da contattare (2) > resto (3).
 */
export function actionPriority(lead: AutopilotLead): number {
  if (nextActionDue(lead)) return 0; // appuntamento di oggi / scaduto: prima di tutto
  if (lead.stage === "escalation") return 0;
  if (lead.stage === "risposto_manuale") return 1; // c'è una risposta da gestire
  if (lead.stage === "richiesta_prezzo") return 1; // vuole il prezzo: rispondi
  if (lead.stage === "demo_richiesta") return 1; // demo da fare
  if (isReadyToContact(lead)) return 2; // primo messaggio da mandare a mano
  return 3;
}

export function sortByAction(leads: AutopilotLead[]): AutopilotLead[] {
  return [...leads].sort((a, b) => {
    const pa = actionPriority(a);
    const pb = actionPriority(b);
    if (pa !== pb) return pa - pb;
    return (
      (parseDbDate(b.updated_at)?.getTime() ?? 0) -
      (parseDbDate(a.updated_at)?.getTime() ?? 0)
    );
  });
}

/** Riga 2 del lead: ultima azione + quanto tempo fa. */
export function lastAction(lead: AutopilotLead): string {
  // Prossima azione pianificata: vince su tutto, è quello che Puccio
  // deve fare (es. "chiamare lunedì 9:00 · oggi 09:00").
  if (lead.next_action_at || lead.next_action) {
    const when = nextActionLabel(lead);
    const what = lead.next_action || "prossima azione";
    return when ? `→ ${what} · ${when}` : `→ ${what}`;
  }
  switch (lead.stage) {
    case "escalation":
      return `⚠ ${lead.escalation_reason || "serve Puccio"} · ${timeAgo(lead.escalated_at)}`;
    case "da_chiamare":
      return `da chiamare: fissa data/ora nel dettaglio · ${timeAgo(lead.updated_at)}`;
    case "demo_richiesta":
      if (lead.demo_url)
        return `demo pronta: mandala su WhatsApp dal dettaglio · ${timeAgo(lead.updated_at)}`;
      return `demo da fare: preparala e incolla il link nel dettaglio · ${timeAgo(lead.updated_at)}`;
    case "demo_inviata":
      return `demo inviata, in attesa di risposta · ${timeAgo(lead.demo_sent_at ?? lead.updated_at)}`;
    case "richiesta_prezzo":
      return `ha chiesto il prezzo: rispondi tu · ${timeAgo(lead.updated_at)}`;
    case "in_trattativa":
      return `in trattativa · ${timeAgo(lead.updated_at)}`;
    case "tiepido":
      return `tiepido: fissa la data di ricontatto · ${timeAgo(lead.updated_at)}`;
    case "vinto":
      return `🏆 cliente acquisito · ${timeAgo(lead.updated_at)}`;
    case "perso":
      return `perso${lead.lost_reason ? `: ${lead.lost_reason}` : ""} · ${timeAgo(lead.updated_at)}`;
    case "studiato":
      return `da contattare: rivedi e manda il primo messaggio · studiato ${timeAgo(lead.updated_at)}`;
    case "risposto_manuale":
      return `ha risposto: rispondi tu, incolla la risposta nel dettaglio · ${timeAgo(lead.updated_at)}`;
    case "contattato":
      return `contattato ${timeAgo(lead.contacted_at)} · incolla la risposta quando arriva`;
    case "nuovo":
      return `trovato ${timeAgo(lead.created_at)} · study in coda`;
    case "archiviato":
      return `${lead.archived_reason || "archiviato"} · ${timeAgo(lead.updated_at)}`;
  }
}
