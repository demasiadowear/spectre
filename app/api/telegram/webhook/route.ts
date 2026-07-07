import { NextResponse } from "next/server";
import { getPipeline, getStats } from "@/lib/autopilot/db";
import { STAGE_LABELS } from "@/components/autopilot/format";
import { agendaLabel, buildMorningBrief, isDueToday, todayRome } from "@/lib/brief";
import { sendTelegram } from "@/lib/telegram";
import { AUTOPILOT_STAGES } from "@/lib/autopilot/constants";
import { isCronAuthorized } from "@/lib/autopilot/cron-auth";

// ============================================================
// Webhook comandi Telegram — SOLO comandi fissi, nessun parsing
// in linguaggio naturale. Sicurezza a due livelli:
//   1. header X-Telegram-Bot-Api-Secret-Token = TELEGRAM_WEBHOOK_SECRET
//      (impostato alla registrazione: scripts/setup-telegram-webhook.mjs)
//   2. whitelist chat: solo TELEGRAM_CHAT_ID può dare comandi
// Il path è escluso dal middleware JWT (Telegram non ha sessione).
// Risposta SEMPRE 200 a Telegram, altrimenti ritenta in loop.
// ============================================================

export const dynamic = "force-dynamic";

const HELP = [
  "🤖 SPECTRE — comandi:",
  "",
  "/brief — morning brief completo",
  "/pipeline — conteggi per stadio",
  "/agenda — azioni di oggi + scadute",
  "/leads — ultimi lead in pipeline",
].join("\n");

async function pipelineText(): Promise<string> {
  const stats = await getStats();
  const lines = ["📊 Pipeline SPECTRE:", ""];
  for (const stage of AUTOPILOT_STAGES) {
    const n = stats.by_stage[stage];
    if (n > 0) lines.push(`• ${STAGE_LABELS[stage]}: ${n}`);
  }
  if (lines.length === 2) lines.push("(vuota)");
  if (stats.unread_alerts > 0) {
    lines.push("", `🔔 ${stats.unread_alerts} notifiche non lette in dashboard`);
  }
  return lines.join("\n");
}

async function agendaText(): Promise<string> {
  const today = todayRome();
  const due = (await getPipeline())
    .filter((l) => !["vinto", "perso", "archiviato"].includes(l.stage))
    .filter((l) => isDueToday(l, today))
    .sort((a, b) => (a.next_action_at ?? "").localeCompare(b.next_action_at ?? ""));
  if (due.length === 0) return "📅 Agenda vuota: nessuna azione oggi.";
  return [`📅 Agenda oggi (${due.length}):`, "", ...due.slice(0, 10).map((l) => agendaLabel(l, today))].join("\n");
}

async function leadsText(): Promise<string> {
  const leads = await getPipeline();
  if (leads.length === 0) return "🎯 Pipeline vuota.";
  const latest = [...leads]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5);
  return [
    `🎯 Lead in pipeline: ${leads.length}. Ultimi 5:`,
    "",
    ...latest.map(
      (l) => `• ${l.company} (${l.category || "?"}, ${l.city || "?"}) — ${STAGE_LABELS[l.stage]}`,
    ),
  ].join("\n");
}

/** Diagnostica/setup (bearer CRON_SECRET, mai aperto):
 *  - GET → username del bot configurato in env (getMe), senza token.
 *  - GET ?register=1 → registra il webhook di QUESTO deployment sul
 *    bot delle env, con TELEGRAM_WEBHOOK_SECRET come secret_token.
 *  Serve perché le env Telegram su Vercel sono sensitive (write-only):
 *  solo l'app può usarle per identificare il bot e auto-registrarsi. */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!token) {
    return NextResponse.json(
      { success: false, error: "TELEGRAM_BOT_TOKEN non configurato" },
      { status: 500 },
    );
  }
  try {
    const me = await (
      await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(10_000),
      })
    ).json();
    const bot = me?.result?.username ?? null;
    if (!me?.ok || !bot) {
      return NextResponse.json(
        { success: false, error: "getMe fallito: token non valido?" },
        { status: 500 },
      );
    }

    const url = new URL(req.url);
    if (url.searchParams.get("register") !== "1") {
      return NextResponse.json({ success: true, bot });
    }

    if (!secret) {
      return NextResponse.json(
        { success: false, bot, error: "TELEGRAM_WEBHOOK_SECRET non configurato" },
        { status: 500 },
      );
    }
    const host = req.headers.get("host");
    const webhookUrl = `https://${host}/api/telegram/webhook`;
    const set = await (
      await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: secret,
          allowed_updates: ["message"],
          drop_pending_updates: true,
        }),
        signal: AbortSignal.timeout(10_000),
      })
    ).json();
    return NextResponse.json({
      success: !!set?.ok,
      bot,
      webhook_url: webhookUrl,
      telegram: set?.description ?? set,
    });
  } catch (err) {
    console.error("[telegram/webhook] diag:", (err as Error).message);
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    const header = req.headers.get("x-telegram-bot-api-secret-token");
    // Senza secret configurato il webhook è chiuso (mai aperto di default).
    if (!secret || header !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const update = await req.json().catch((err) => {
      console.error("[telegram/webhook] body JSON non valido:", (err as Error).message);
      return null;
    });
    const message = update?.message;
    if (!message?.text) return NextResponse.json({ ok: true });

    const chatId = String(message.chat?.id ?? "");
    const allowed = process.env.TELEGRAM_CHAT_ID?.trim();
    if (!allowed || chatId !== allowed) {
      // Chat non in whitelist: nessuna risposta, nessun leak.
      return NextResponse.json({ ok: true });
    }

    const cmd = String(message.text).trim().toLowerCase().split(/[\s@]/)[0];

    let reply: string;
    let sent = false;
    switch (cmd) {
      case "/brief": {
        const brief = await buildMorningBrief();
        reply = brief.text;
        break;
      }
      case "/pipeline":
        reply = await pipelineText();
        break;
      case "/agenda":
        reply = await agendaText();
        break;
      case "/leads":
        reply = await leadsText();
        break;
      default:
        reply = HELP;
    }
    sent = await sendTelegram(reply, chatId);

    return NextResponse.json({ ok: true, sent });
  } catch (err) {
    // 200 comunque: Telegram non deve ritentare in loop.
    console.error("[telegram/webhook]", (err as Error).message);
    return NextResponse.json({ ok: true });
  }
}
