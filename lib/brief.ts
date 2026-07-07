import { getPipeline } from "@/lib/autopilot/db";
import { turso } from "@/lib/turso";
import type { AutopilotLead } from "@/types/autopilot";

// ============================================================
// Morning brief giornaliero (7:00, cron-job.org → /api/brief):
// digest Telegram con i lead che richiedono azione + agenda del
// giorno. Solo lettura: nessuno stato cambia, nessun messaggio
// parte verso i lead (copilota manuale).
// ============================================================

/** Oggi in Europe/Rome come "YYYY-MM-DD". Il server Vercel gira in
 *  UTC ma next_action_at è ora locale (input datetime-local): il
 *  confronto giusto è sulla data di Roma, non su quella UTC. */
export function todayRome(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
}

/** Agenda: azione pianificata oggi o già scaduta. next_action_at è
 *  locale naive ("YYYY-MM-DDTHH:MM"): basta confrontare la data. */
export function isDueToday(lead: AutopilotLead, today: string): boolean {
  if (!lead.next_action_at) return false;
  return lead.next_action_at.slice(0, 10) <= today;
}

export function agendaLabel(lead: AutopilotLead, today: string): string {
  const at = lead.next_action_at ?? "";
  const date = at.slice(0, 10);
  const time = at.slice(11, 16);
  const when =
    date === today ? `oggi ${time}`.trim() : `scaduta (${date} ${time})`.trim();
  return `• ${lead.company} — ${lead.next_action || "prossima azione"} · ${when}`;
}

function qualitySuffix(lead: AutopilotLead): string {
  return lead.rating > 0 ? ` (⭐${lead.rating.toFixed(1)} · ${lead.reviews})` : "";
}

interface IntentOpen {
  title: string;
  platform: string;
  score: number;
}

/** Lead intent ancora aperti (richiesta pubblicata, non contattati):
 *  sono i più urgenti in assoluto. Senza Turso: lista vuota. */
async function getOpenIntent(): Promise<IntentOpen[]> {
  if (!turso) return [];
  try {
    const res = await turso.execute(
      `SELECT title, platform, score FROM intent_pipeline
       WHERE stage = 'intent_found' ORDER BY score DESC LIMIT 20`,
    );
    return res.rows.map((r) => ({
      title: String(r.title ?? ""),
      platform: String(r.platform ?? ""),
      score: Number(r.score) || 0,
    }));
  } catch (err) {
    console.error("[brief] lettura intent fallita:", (err as Error).message);
    return [];
  }
}

export interface BriefStats {
  agenda: number;
  risposte: number;
  da_contattare: number;
  fissi: number;
  intent_aperti: number;
}

export interface MorningBrief {
  text: string;
  stats: BriefStats;
}

export async function buildMorningBrief(): Promise<MorningBrief> {
  const today = todayRome();
  const [pipeline, intent] = await Promise.all([getPipeline(), getOpenIntent()]);

  // Stadi chiusi fuori da ogni conteggio azione.
  const active = pipeline.filter(
    (l) => !["vinto", "perso", "archiviato"].includes(l.stage),
  );

  const agenda = active
    .filter((l) => isDueToday(l, today))
    .sort((a, b) => (a.next_action_at ?? "").localeCompare(b.next_action_at ?? ""));

  const risposte = active.filter((l) => l.stage === "ha_risposto");

  const daContattare = active
    .filter(
      (l) =>
        l.stage === "da_contattare" &&
        l.wa_first_message !== "" &&
        l.phone_type !== "fisso" &&
        !isDueToday(l, today), // già in agenda: non duplicare
    )
    .sort((a, b) => b.rating - a.rating || b.reviews - a.reviews);

  const fissi = active.filter(
    (l) => l.stage === "da_contattare" && l.phone_type === "fisso",
  );

  const dateLabel = new Date().toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Rome",
  });

  const lines: string[] = [`☀️ SPECTRE Morning Brief — ${dateLabel}`, ""];

  if (intent.length > 0) {
    lines.push(`🎯 INTENT APERTI (${intent.length}) — contattare per primi:`);
    for (const i of intent.slice(0, 3)) {
      lines.push(`• [${i.score}] ${i.title.slice(0, 80)} — ${i.platform}`);
    }
    lines.push("");
  }

  if (agenda.length > 0) {
    lines.push(`📅 AGENDA OGGI (${agenda.length}):`);
    for (const l of agenda.slice(0, 6)) lines.push(agendaLabel(l, today));
    lines.push("");
  }

  if (risposte.length > 0) {
    lines.push(`💬 RISPOSTE DA GESTIRE (${risposte.length}):`);
    for (const l of risposte.slice(0, 5)) lines.push(`• ${l.company}`);
    lines.push("");
  }

  if (daContattare.length > 0) {
    lines.push(`📤 DA CONTATTARE — messaggio pronto (${daContattare.length}):`);
    for (const l of daContattare.slice(0, 5)) {
      lines.push(`• ${l.company}${qualitySuffix(l)}`);
    }
    lines.push("");
  }

  if (fissi.length > 0) {
    lines.push(`📞 NUMERI FISSI DA CHIAMARE (${fissi.length}):`);
    for (const l of fissi.slice(0, 3)) lines.push(`• ${l.company}`);
    lines.push("");
  }

  const nothingToDo =
    intent.length + agenda.length + risposte.length + daContattare.length === 0;
  if (nothingToDo) {
    lines.push("🟢 Niente che richiede azione: pipeline pulita.");
    lines.push("");
  }

  lines.push("— SPECTRE");

  return {
    text: lines.join("\n").trim(),
    stats: {
      agenda: agenda.length,
      risposte: risposte.length,
      da_contattare: daContattare.length,
      fissi: fissi.length,
      intent_aperti: intent.length,
    },
  };
}
