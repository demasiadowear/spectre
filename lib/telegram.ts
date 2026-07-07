// ============================================================
// Telegram condiviso (notifiche Intent, morning brief, webhook
// comandi). Env: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID. Senza env
// l'invio è disattivato: si logga e si prosegue — un errore di
// notifica non deve MAI fermare scout/study/brief.
// ============================================================

/** Invia un messaggio Telegram alla chat configurata (o a `chatId`
 *  esplicito, es. risposta a un comando webhook). Ritorna true se
 *  accettato dall'API. Non lancia mai. */
export async function sendTelegram(
  text: string,
  chatId?: string | number,
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chat = chatId ?? process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chat) {
    console.warn("[telegram] non configurato: invio saltato");
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[telegram] API ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[telegram] invio fallito:", (err as Error).message);
    return false;
  }
}
