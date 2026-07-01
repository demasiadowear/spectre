import type { AutopilotLead, AutopilotStage } from "@/types/autopilot";

// ============================================================
// Helper condivisi della Pipeline: tempo relativo, etichetta
// "ultima azione", priorità di ordinamento, colori di stadio,
// badge qualità (stelle Google + recensioni — NON è un tier).
// ============================================================

export const STAGE_LABELS: Record<AutopilotStage, string> = {
  da_contattare: "da contattare",
  contattato: "contattato",
  ha_risposto: "ha risposto",
  in_trattativa: "in trattativa",
  vinto: "vinto",
  perso: "perso",
  archiviato: "archiviato",
};

/** Colore per stadio (hex) — usato da JS/Canvas/Leaflet (mappa). */
export const STAGE_HEX: Record<AutopilotStage, string> = {
  da_contattare: "#8A877E",
  contattato: "#1D6E8C",
  ha_risposto: "#C2410C",
  in_trattativa: "#A8431E",
  vinto: "#3B6B34",
  perso: "#9A6B5E",
  archiviato: "#6B6862",
};

/** Chip di stadio pieni (testo chiaro su colore funnel). */
export const STAGE_CHIP: Record<AutopilotStage, string> = {
  da_contattare: "bg-fn-todo text-onaccent",
  contattato: "bg-fn-replied text-onaccent",
  ha_risposto: "bg-accent text-onaccent",
  in_trattativa: "bg-fn-negotiating text-onaccent",
  vinto: "bg-fn-closed text-onaccent",
  perso: "bg-fn-lost text-onaccent",
  archiviato: "bg-fn-lost text-onaccent",
};

/** SQLite salva "YYYY-MM-DD HH:MM:SS" in UTC senza suffisso. */
export function parseDbDate(value: string | null): Date | null {
  if (!value) return null;
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Entrato in pipeline nelle ultime 48h. created_at della riga pipeline
 *  = momento dell'import (da Hunter/Visor), cioè "appena aggiunto". */
const RECENT_WINDOW_MS = 48 * 60 * 60 * 1000;
export function isRecent(lead: AutopilotLead, now = Date.now()): boolean {
  const d = parseDbDate(lead.created_at);
  return d !== null && now - d.getTime() < RECENT_WINDOW_MS;
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

// ----- Qualità lead (stelle + recensioni, NON è un tier) -------

/** Heat di qualità: solo per ordinare chi contattare prima. Nessun
 *  prezzo, nessun tier. "hot" = top reputazione, "warm" = buona. */
export type LeadHeat = "hot" | "warm" | "base";

export function leadHeat(lead: AutopilotLead): LeadHeat {
  if (lead.rating >= 4.8 && lead.reviews >= 100) return "hot";
  if (lead.rating >= 4.6 && lead.reviews >= 50) return "warm";
  return "base";
}

/** Badge qualità testuale, es. "⭐4.8 · 120". Vuoto se manca il rating. */
export function qualityLabel(lead: AutopilotLead): string {
  if (!lead.rating || lead.rating <= 0) return "";
  return `⭐${lead.rating.toFixed(1)} · ${lead.reviews}`;
}

export const HEAT_BADGE: Record<LeadHeat, string> = {
  hot: "border-success/50 text-success",
  warm: "border-ochre/60 text-ochre",
  base: "border-border text-text2",
};

/** Prezzo manuale formattato (€) o "" se non impostato. */
export function priceLabel(lead: AutopilotLead): string {
  return lead.price != null ? `€${lead.price}` : "";
}

// ----- Agenda (prossima azione manuale) ------------------------

/** next_action_at arriva da <input type="datetime-local">: niente Z,
 *  è ora locale. */
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

/** Lead pronto da contattare a mano: stadio "da contattare" col primo
 *  messaggio già preparato dallo Study. */
export function isReadyToContact(lead: AutopilotLead): boolean {
  return lead.stage === "da_contattare" && lead.wa_first_message !== "";
}

/**
 * Ordinamento "cosa fare ora" (Cockpit assorbito):
 * scadenza agenda (0) > risposta da gestire (1) > da contattare (2) > resto (3).
 */
export function actionPriority(lead: AutopilotLead): number {
  if (nextActionDue(lead)) return 0; // appuntamento di oggi / scaduto
  if (lead.stage === "ha_risposto") return 1; // c'è una risposta da gestire
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

/** Ordina per qualità (chi contattare prima): hot > warm > base, poi
 *  per rating e n. recensioni. */
export function sortByQuality(leads: AutopilotLead[]): AutopilotLead[] {
  const rank = { hot: 0, warm: 1, base: 2 };
  return [...leads].sort((a, b) => {
    const ra = rank[leadHeat(a)];
    const rb = rank[leadHeat(b)];
    if (ra !== rb) return ra - rb;
    if (b.rating !== a.rating) return b.rating - a.rating;
    return b.reviews - a.reviews;
  });
}

/** Riga 2 del lead: ultima azione + quanto tempo fa. */
export function lastAction(lead: AutopilotLead): string {
  // Prossima azione pianificata: vince su tutto.
  if (lead.next_action_at || lead.next_action) {
    const when = nextActionLabel(lead);
    const what = lead.next_action || "prossima azione";
    return when ? `→ ${what} · ${when}` : `→ ${what}`;
  }
  switch (lead.stage) {
    case "da_contattare":
      return lead.wa_first_message
        ? `da contattare: rivedi e manda il primo messaggio · ${timeAgo(lead.updated_at)}`
        : `trovato ${timeAgo(lead.created_at)} · in preparazione`;
    case "contattato":
      return `contattato ${timeAgo(lead.contacted_at)} · incolla la risposta quando arriva`;
    case "ha_risposto":
      return `ha risposto: rispondi tu, incolla la risposta nel dettaglio · ${timeAgo(lead.updated_at)}`;
    case "in_trattativa":
      return `in trattativa · ${timeAgo(lead.updated_at)}`;
    case "vinto":
      return `🏆 cliente acquisito · ${timeAgo(lead.updated_at)}`;
    case "perso":
      return `perso${lead.lost_reason ? `: ${lead.lost_reason}` : ""} · ${timeAgo(lead.updated_at)}`;
    case "archiviato":
      return `${lead.archived_reason || "archiviato"} · ${timeAgo(lead.updated_at)}`;
  }
}
