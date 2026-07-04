import { geminiJSON } from "@/lib/gemini";
import type { RawIntentRequest } from "@/types/intent";
import { buildHookPrompt } from "./constants";

// ============================================================
// Study intent — gancio di apertura personalizzato sulla richiesta
// specifica (2-3 righe, tono diretto, rimando a ayromex.com).
// Contratto null-safe come il resto di SPECTRE: senza Gemini (o su
// errore) si usa un fallback deterministico, mai un crash.
// ============================================================

function fallbackHook(req: RawIntentRequest): string {
  const where = req.zone ? ` a ${req.zone}` : "";
  return (
    `Ho letto la vostra richiesta "${req.title}"${where}: è esattamente il tipo di progetto ` +
    `che realizziamo in AYROMEX (ayromex.com — siti editoriali e immersivi per PMI). ` +
    `Se vi va, in una call di 10 minuti vi mostro un esempio concreto già fatto nel vostro settore.`
  );
}

export async function generateHook(req: RawIntentRequest): Promise<string> {
  const user = [
    `TITOLO: ${req.title}`,
    `TESTO: ${req.body || "(non disponibile)"}`,
    `CATEGORIA: ${req.category || "(non indicata)"}`,
    `ZONA: ${req.zone || "(non indicata)"}`,
    `BUDGET: ${req.budget || "(non dichiarato)"}`,
    `PIATTAFORMA: ${req.platform}`,
  ].join("\n");

  const result = await geminiJSON<{ hook: string }>(buildHookPrompt(), user);
  const hook = result?.hook?.trim();
  return hook || fallbackHook(req);
}
