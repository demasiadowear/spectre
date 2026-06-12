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
  risposto_manuale: "risposto — manuale",
  demo_richiesta: "demo richiesta — manuale",
  escalation: "escalation",
  archiviato: "archiviato",
};

/** Chip di stadio pieni (testo chiaro su colore funnel). */
export const STAGE_CHIP: Record<AutopilotStage, string> = {
  nuovo: "bg-fn-todo text-onaccent",
  studiato: "bg-ochre text-onaccent",
  contattato: "bg-fn-replied text-onaccent",
  risposto_manuale: "bg-accent text-onaccent",
  demo_richiesta: "bg-success text-onaccent",
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
  if (lead.stage === "escalation") return 0;
  if (lead.stage === "risposto_manuale") return 1; // c'è un umano in attesa
  if (lead.stage === "demo_richiesta") return 1;
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
  switch (lead.stage) {
    case "escalation":
      return `⚠ ${lead.escalation_reason || "serve Puccio"} · ${timeAgo(lead.escalated_at)}`;
    case "demo_richiesta":
      if (lead.demo_sent_at)
        return `demo inviata al cliente · ${timeAgo(lead.demo_sent_at)}`;
      if (lead.demo_url)
        return `demo approvata, invio in coda · ${timeAgo(lead.updated_at)}`;
      return `demo richiesta: preparala e incolla il link nel dettaglio · ${timeAgo(lead.updated_at)}`;
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
