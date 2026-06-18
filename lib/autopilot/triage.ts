import { geminiJSON } from "@/lib/gemini";
import type { AutopilotLead, AutopilotStage, WaMessage } from "@/types/autopilot";
import { TRIAGE_SYSTEM_PROMPT } from "./prompts";

// ============================================================
// Triage della risposta del cliente (lato web-app, copilota manuale).
// Puccio incolla cosa gli ha scritto il lead: Gemini cataloga lo stato
// di trattativa. SOLO catalogazione: nessun messaggio parte verso il
// lead. Qualunque dubbio o errore -> "risposto_manuale" (da rispondere).
// ============================================================

export interface TriageResult {
  /** Stage di pipeline assegnato (già mappato sugli stati SPECTRE). */
  stage: AutopilotStage;
  /** ISO locale (datetime-local) per l'eventuale richiamo, "" se assente. */
  callback_at: string;
  next_action: string;
  lost_reason: string;
  /** Etichetta leggibile per le notifiche/alert. */
  label: string;
}

/** Soglie di confidenza: perso solo se nettissimo (mai archiviare a
 *  caso), gli altri stati con soglia media, sotto -> da rispondere. */
const TRIAGE_MIN_CONF = 0.6;
const TRIAGE_LOST_MIN_CONF = 0.75;

const STAGE_MAP: Record<string, AutopilotStage> = {
  demo_richiesta: "demo_richiesta",
  da_chiamare: "da_chiamare",
  richiesta_prezzo: "richiesta_prezzo",
  tiepido: "tiepido",
  perso: "perso",
  da_rispondere: "risposto_manuale",
};

/** Etichette leggibili per la riga alert/notifica. */
export const TRIAGE_LABELS: Record<string, string> = {
  risposto_manuale: "da rispondere",
  da_chiamare: "da chiamare",
  demo_richiesta: "demo da fare",
  richiesta_prezzo: "richiesta prezzo",
  tiepido: "tiepido",
  perso: "perso",
};

interface TriageVerdict {
  stage?: string;
  callback_at?: string;
  next_action?: string;
  lost_reason?: string;
  confidence?: number;
}

/**
 * Smista la risposta del cliente nello stato trattativa giusto.
 * `history` sono i messaggi già salvati sul lead (ASC), `body` è il
 * nuovo testo incollato da Puccio.
 */
export async function triageInbound(
  lead: AutopilotLead,
  body: string,
  history: WaMessage[],
): Promise<TriageResult> {
  const fallback: TriageResult = {
    stage: "risposto_manuale",
    callback_at: "",
    next_action: "",
    lost_reason: "",
    label: TRIAGE_LABELS.risposto_manuale,
  };

  try {
    const transcript = history
      .slice(-10)
      .map((m) => `${m.direction === "out" ? "NOI" : "CLIENTE"}: ${m.body}`)
      .join("\n");
    // Data completa con giorno della settimana: serve a Gemini per
    // risolvere "lunedì" / "domani" in una data concreta.
    const nowRome = new Date().toLocaleString("it-IT", {
      timeZone: "Europe/Rome",
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    const verdict = await geminiJSON<TriageVerdict>(
      TRIAGE_SYSTEM_PROMPT,
      `Attività: ${lead.company} (${lead.category}, ${lead.city})\n` +
        `Ora attuale (Europe/Rome): ${nowRome}\n\n` +
        `CHAT FINORA:\n${transcript || "(nessun messaggio precedente)"}\n\n` +
        `ULTIMO MESSAGGIO DEL CLIENTE:\n${body}`,
      { temperature: 0.2 },
    );
    if (!verdict) return fallback;

    let stage = STAGE_MAP[verdict.stage ?? ""] ?? "risposto_manuale";
    const conf = Number(verdict.confidence) || 0;
    if (stage === "perso" && conf < TRIAGE_LOST_MIN_CONF) stage = "risposto_manuale";
    else if (stage !== "risposto_manuale" && conf < TRIAGE_MIN_CONF) {
      stage = "risposto_manuale";
    }

    const callback =
      typeof verdict.callback_at === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(verdict.callback_at)
        ? verdict.callback_at
        : "";

    return {
      stage,
      callback_at: callback,
      next_action:
        typeof verdict.next_action === "string"
          ? verdict.next_action.slice(0, 120)
          : "",
      lost_reason:
        stage === "perso" && typeof verdict.lost_reason === "string"
          ? verdict.lost_reason.slice(0, 120)
          : "",
      label: TRIAGE_LABELS[stage] ?? stage,
    };
  } catch (err) {
    console.error(
      "[autopilot/triage] fallito:",
      err instanceof Error ? err.message : String(err),
    );
    return fallback;
  }
}
