import type { RawIntentRequest } from "@/types/intent";

// ============================================================
// Notifica immediata Telegram per i lead intent con score alto:
// vanno contattati entro 1 ora. Env: TELEGRAM_BOT_TOKEN +
// TELEGRAM_CHAT_ID (v. .env.local.example). Senza env la notifica
// è disattivata: si logga e si prosegue (l'alert dashboard resta).
// ============================================================

/** Invia un messaggio Telegram. Ritorna true se accettato dall'API.
 *  Non lancia mai: un errore di notifica non deve fermare lo scout
 *  (il lead resta comunque in dashboard con l'alert). */
export async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) {
    console.warn("[intent/notify] Telegram non configurato: notifica saltata");
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(
        `[intent/notify] Telegram API ${res.status}: ${await res.text()}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error("[intent/notify] invio fallito:", (err as Error).message);
    return false;
  }
}

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
