import { geminiJSON } from "@/lib/gemini";
import type { AutopilotLead, WaMessage } from "@/types/autopilot";
import { SUGGEST_REPLY_SYSTEM_PROMPT } from "./prompts";

// ============================================================
// Risposta suggerita (copilota manuale). Data la conversazione,
// Gemini scrive una BOZZA che Puccio rivede e invia a mano dal suo
// numero. Non è un bot: è un suggerimento, mai inviato in automatico.
// ============================================================

export interface SuggestedReply {
  reply: string;
  note: string;
}

interface SuggestVerdict {
  reply?: string;
  note?: string;
}

/**
 * Genera la bozza di risposta per l'ultimo messaggio del cliente.
 * `history` sono i messaggi salvati sul lead (ASC, ultimo = cliente).
 * Ritorna null se Gemini non è configurato o fallisce: la UI mostra
 * un campo vuoto editabile, Puccio scrive a mano.
 */
export async function suggestReply(
  lead: AutopilotLead,
  history: WaMessage[],
): Promise<SuggestedReply | null> {
  const transcript = history
    .slice(-12)
    .map((m) => `${m.direction === "out" ? "TU" : "CLIENTE"}: ${m.body}`)
    .join("\n");
  if (!transcript) return null;

  // Ora corrente nel prompt: il saluto (se serve) deve essere coerente.
  const nowRome = new Date().toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  const verdict = await geminiJSON<SuggestVerdict>(
    SUGGEST_REPLY_SYSTEM_PROMPT,
    `Attività: ${lead.company} (${lead.category}, ${lead.city})\n` +
      `Ora attuale (Europe/Rome): ${nowRome}\n\n` +
      `CHAT FINORA:\n${transcript}\n\n` +
      `Scrivi la bozza di risposta all'ultimo messaggio del cliente.`,
    { complex: true, temperature: 0.7 },
  );
  if (!verdict?.reply) return null;
  return {
    reply: verdict.reply.trim(),
    note: typeof verdict.note === "string" ? verdict.note.trim() : "",
  };
}
