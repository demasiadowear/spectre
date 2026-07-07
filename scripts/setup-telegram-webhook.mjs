// ============================================================
// Registra il webhook Telegram per i comandi SPECTRE
// (/brief /pipeline /agenda /leads).
//
// Uso:
//   TELEGRAM_BOT_TOKEN=<token> TELEGRAM_WEBHOOK_SECRET=<secret> \
//     node scripts/setup-telegram-webhook.mjs https://<dominio>
//
// Il secret DEVE essere lo stesso valore della env
// TELEGRAM_WEBHOOK_SECRET sul progetto Vercel: Telegram lo rimanda
// nell'header X-Telegram-Bot-Api-Secret-Token e la route lo verifica.
// ============================================================

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const base = process.argv[2]?.replace(/\/$/, "");

if (!token || !secret || !base) {
  console.error(
    "Servono: env TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET e l'URL base come argomento.",
  );
  process.exit(1);
}

const url = `${base}/api/telegram/webhook`;
const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  }),
});
const data = await res.json();
if (!data.ok) {
  console.error("setWebhook fallito:", JSON.stringify(data));
  process.exit(1);
}
console.log(`Webhook registrato: ${url}`);

const info = await (
  await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)
).json();
console.log("getWebhookInfo:", JSON.stringify(info.result, null, 2));
