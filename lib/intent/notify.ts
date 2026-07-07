import type { RawIntentRequest } from "@/types/intent";

// ============================================================
// Notifica immediata Telegram per i lead intent con score alto:
// vanno contattati entro 1 ora. L'implementazione dell'invio è
// condivisa in lib/telegram.ts (usata anche da brief e webhook).
// Senza env la notifica è disattivata: si logga e si prosegue
// (l'alert dashboard resta).
// ============================================================

export { sendTelegram } from "@/lib/telegram";

/** Formatta la notifica per un lead intent nuovo con score alto. */
export function formatIntentNotification(
  req: RawIntentRequest,
  score: number,
  hook: string,
): string {
  const lines = [
    `🎯 LEAD INTENT — score ${score}/100 — contattare entro 1 ora`,
    ``,
    `${req.title}`,
    req.zone ? `📍 ${req.zone}` : "",
    req.budget ? `💰 ${req.budget}` : "",
    `🌐 ${req.platform} — ${req.source_url}`,
    ``,
    req.body ? req.body.slice(0, 300) : "",
    ``,
    `✍️ Gancio pronto:`,
    hook,
  ];
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
