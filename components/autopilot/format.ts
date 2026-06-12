import type { AutopilotLead, AutopilotStage } from "@/types/autopilot";

// ============================================================
// Helper condivisi della vista Autopilot: tempo relativo,
// etichetta "ultima azione", priorità di ordinamento, colori
// di stadio/tier (palette warm-paper).
// ============================================================

export const STAGE_LABELS: Record<AutopilotStage, string> = {
  nuovo: "nuovo",
  studiato: "da approvare",
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

/** Per lo stadio "studiato" l'azione richiesta esiste solo se pending. */
export function isPendingApproval(lead: AutopilotLead): boolean {
  return lead.stage === "studiato" && lead.approval_status === "pending";
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

// ----- Stima invio (SOLO UI: i delay reali sono del worker) ---

/** Replica di inSendWindow del worker: lun-sab, 9-20 Rome. */
function inSendWindowRome(now = new Date()): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("it-IT", {
      timeZone: "Europe/Rome",
      hour: "numeric",
      weekday: "short",
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  if (parts.weekday === "dom") return false;
  const hour = Number(parts.hour);
  return hour >= 9 && hour < 20;
}

/** Label di stadio veritiera per la singola riga: lo stage "studiato"
 *  copre due stati diversi (da approvare vs approvato in coda invio)
 *  e il chip deve distinguerli — un approved etichettato "da
 *  approvare" è di fatto invisibile all'occhio. */
export function stageLabel(lead: AutopilotLead): string {
  if (lead.stage === "studiato" && lead.approval_status !== "pending") {
    return "in coda invio";
  }
  return STAGE_LABELS[lead.stage];
}

/** Approvato (manuale o auto) in attesa che il worker lo invii. */
export function isQueuedForSend(lead: AutopilotLead): boolean {
  return (
    lead.stage === "studiato" &&
    (lead.approval_status === "approved" || lead.approval_status === "auto") &&
    lead.wa_first_message !== ""
  );
}

/**
 * Label "in coda" con ETA per ogni lead approvato, nello stesso ordine
 * del worker (tier ASC, approved_at ASC). Stima: ~2,5 min a invio
 * (delay random 60-240s), solo dentro le finestre. Il cap giornaliero
 * può allungarla: per questo è un "~".
 */
export function queuedSendLabels(
  leads: AutopilotLead[],
  killSwitch: boolean,
): Map<string, string> {
  const queue = leads.filter(isQueuedForSend).sort((a, b) => {
    if (a.tier !== b.tier) return a.tier < b.tier ? -1 : 1;
    return (
      (parseDbDate(a.approved_at)?.getTime() ?? 0) -
      (parseDbDate(b.approved_at)?.getTime() ?? 0)
    );
  });
  const inWindow = inSendWindowRome();
  return new Map(
    queue.map((l, i) => {
      let label: string;
      if (killSwitch) {
        label = "in coda · invio fermo (kill switch attivo)";
      } else if (!inWindow) {
        label = "in coda · invio alla prossima finestra (lun-sab 9-20)";
      } else {
        label = `in coda · invio previsto entro ~${Math.max(3, Math.ceil((i + 1) * 2.5))} min`;
      }
      return [l.lead_id, label];
    }),
  );
}

/**
 * Ordinamento "richiede azione" in cima:
 * escalation (0) > demo_richiesta (1) > da approvare (2) > resto (3).
 */
export function actionPriority(lead: AutopilotLead): number {
  if (nextActionDue(lead)) return 0; // appuntamento di oggi / scaduto: prima di tutto
  if (lead.stage === "escalation") return 0;
  if (lead.stage === "risposto_manuale") return 1; // c'è un umano in attesa
  if (lead.stage === "richiesta_prezzo") return 1; // vuole il prezzo: rispondi
  if (lead.stage === "demo_richiesta") return 1; // demo da fare
  if (isPendingApproval(lead)) return 2;
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

/** Riga 2 del lead: ultima azione + quanto tempo fa. `queuedLabel`
 *  (da queuedSendLabels) sostituisce il generico "in coda di invio". */
export function lastAction(
  lead: AutopilotLead,
  queuedLabel?: string | null,
): string {
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
        return `demo approvata, invio in coda · ${timeAgo(lead.updated_at)}`;
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
      return lead.approval_status === "pending"
        ? `messaggio da approvare · studiato ${timeAgo(lead.updated_at)}`
        : `${queuedLabel ?? "in coda di invio"} · approvato ${timeAgo(lead.approved_at ?? lead.updated_at)}`;
    case "risposto_manuale":
      return `ha risposto, bot muto: chat in mano tua · ${timeAgo(lead.updated_at)}`;
    case "contattato":
      if (lead.followup2_at)
        return `follow-up 2 inviato · ${timeAgo(lead.followup2_at)}`;
      if (lead.followup1_at)
        return `follow-up 1 inviato · ${timeAgo(lead.followup1_at)}`;
      if (lead.bypass_sent_at)
        return `auto-reply scavalcato ${timeAgo(lead.bypass_sent_at)} · in attesa di umano`;
      return `contattato ${timeAgo(lead.contacted_at)} · in attesa di risposta`;
    case "nuovo":
      return `trovato ${timeAgo(lead.created_at)} · study in coda`;
    case "archiviato":
      return `${lead.archived_reason || "archiviato"} · ${timeAgo(lead.updated_at)}`;
  }
}
