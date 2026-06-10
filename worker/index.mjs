// ============================================================
// SPECTRE AUTOPILOT — worker WhatsApp (Stadio 2 + invii Stadio 3).
// Gira su VPS/macchina locale con sessione persistente sul numero
// WA Business AYROMEX. NON gira su Vercel.
//
//   npm start          -> worker WA (outreach + bot conversazione)
//   npm run build-runner -> processo build demo (Playwright/Vercel)
//
// Sicurezza operativa:
// - warm-up: cap contatti/giorno da autopilot_settings (10 -> 15)
// - solo fasce 9-13 / 16-20 Europe/Rome, no weekend
// - delay random 60-240s tra messaggi
// - kill switch globale (dashboard) controllato a ogni tick
// - anomalie (invii falliti / non consegnati / disconnect) ->
//   alert + auto kill switch
// ============================================================
import "dotenv/config";
import pkg from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import {
  addAlert,
  alertExists,
  bumpCounters,
  buildsByStatus,
  chatHistory,
  createBuildTask,
  dailyCap,
  findLeadByPhone,
  getSettings,
  getTodayCounters,
  hasInbound,
  logWaMessage,
  pipelineByStage,
  pipelineLead,
  readyForOutreach,
  romeDay,
  setSetting,
  setWaMessageStatus,
  setWaMessageStatusByWaId,
  undeliveredTodayCount,
  updateBuild,
  updateLeadStatus,
  updatePipeline,
} from "./lib/db.mjs";
import { geminiJSON } from "./lib/gemini.mjs";
import {
  ARCHIVE_AFTER_DAYS,
  FOLLOWUP_1_DAYS,
  FOLLOWUP_2_DAYS,
  daysSince,
  inSendWindow,
  randomDelayMs,
  sleep,
} from "./lib/schedule.mjs";
import {
  CONVERSATION_SYSTEM_PROMPT,
  DEFAULT_TEMPLATE,
  SUMMARY_SYSTEM_PROMPT,
  TEMPLATE_BY_CATEGORY,
  archiveReject,
  demoReady,
  followup1,
  followup2,
} from "./lib/prompts.mjs";

const { Client, LocalAuth } = pkg;

const PUCCIO = (process.env.PUCCIO_WA_NUMBER ?? "").replace(/\D/g, "");
const SESSION_DIR = process.env.WA_SESSION_DIR ?? "./.wwebjs_auth";

let consecutiveFailures = 0;
let waReady = false;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// ----- Helpers -----------------------------------------------

function chatIdFor(phone) {
  let digits = String(phone).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!digits.startsWith("39")) digits = `39${digits}`;
  return `${digits}@c.us`;
}

async function triggerKillSwitch(reason) {
  await setSetting("kill_switch", "1");
  await addAlert("anomaly", `KILL SWITCH AUTOMATICO: ${reason}`);
  await notifyPuccio(`⚠️ AUTOPILOT FERMATO automaticamente: ${reason}`);
  console.error("[worker] kill switch automatico:", reason);
}

async function notifyPuccio(text) {
  if (!PUCCIO || !waReady) return;
  try {
    await client.sendMessage(`${PUCCIO}@c.us`, text);
  } catch (err) {
    console.error("[worker] notifica a Puccio fallita:", err.message);
  }
}

/** Invio tracciato: log su wa_messages, contatori, anomaly detection. */
async function sendToLead(lead, body, { aiGenerated = false, newContact = false } = {}) {
  const chatId = chatIdFor(lead.phone);
  if (!chatId) {
    await updatePipeline(String(lead.lead_id), {
      stage: "archiviato",
      archived_reason: "telefono mancante/non valido",
    });
    return false;
  }
  const msgId = await logWaMessage({
    leadId: String(lead.lead_id),
    direction: "out",
    body,
    aiGenerated,
  });
  try {
    const sent = await client.sendMessage(chatId, body);
    await setWaMessageStatus(msgId, "sent", sent.id?._serialized ?? "");
    await bumpCounters({ newContact, sent: true });
    consecutiveFailures = 0;
    // Il primo invio in assoluto fa partire il warm-up.
    const settings = await getSettings();
    if (!settings.warmup_started_at) {
      await setSetting("warmup_started_at", new Date().toISOString());
    }
    return true;
  } catch (err) {
    console.error("[worker] invio fallito:", lead.company, err.message);
    await setWaMessageStatus(msgId, "failed");
    consecutiveFailures++;
    if (consecutiveFailures >= 3) {
      await triggerKillSwitch(
        `3 invii consecutivi falliti (ultimo: ${err.message.slice(0, 120)})`,
      );
    }
    return false;
  }
}

// ----- Bot conversazione (inbound) ---------------------------

async function handleInbound(msg) {
  if (msg.fromMe || !msg.from?.endsWith("@c.us")) return;
  const digits = msg.from.replace("@c.us", "");
  if (digits === PUCCIO) return;

  const lead = await findLeadByPhone(digits);
  if (!lead) return; // numero non in pipeline: ignora

  const leadId = String(lead.lead_id);
  const body = (msg.body ?? "").trim();
  await logWaMessage({ leadId, direction: "in", body, status: "delivered" });

  const settings = await getSettings();
  if (settings.kill_switch || Number(lead.bot_paused) === 1) return;
  if (lead.stage === "archiviato" || lead.stage === "escalation") return;

  const history = await chatHistory(leadId);
  const transcript = history
    .map((m) => `${m.direction === "out" ? "TU" : "CLIENTE"}: ${m.body}`)
    .join("\n");

  const decision = await geminiJSON(
    CONVERSATION_SYSTEM_PROMPT,
    `Attività: ${lead.company} (${lead.category}, ${lead.city})\n\nCHAT FINORA:\n${transcript}\n\nRispondi all'ultimo messaggio del cliente.`,
  );

  // Senza decisione affidabile non si improvvisa: passa a Puccio.
  const intent = decision?.intent ?? "escalation";

  if (intent === "escalation" || (intent !== "rifiuto" && !decision?.reply)) {
    const reason =
      decision?.escalation_reason || "richiesta da gestire di persona";
    await updatePipeline(leadId, {
      stage: "escalation",
      escalated_at: new Date().toISOString(),
      escalation_reason: reason,
      bot_paused: 1,
    });
    await updateLeadStatus(leadId, "negotiating");
    const summary = await geminiJSON(SUMMARY_SYSTEM_PROMPT, transcript);
    await addAlert("escalation", `${lead.company}: ${reason}`, leadId);
    await notifyPuccio(
      `🔥 ESCALATION — ${lead.company} (${lead.phone})\nMotivo: ${reason}\n\n${summary?.summary ?? transcript.slice(-500)}`,
    );
    return; // il bot si ferma su questa chat
  }

  if (intent === "rifiuto") {
    await sendToLead(lead, decision?.reply || archiveReject(), {
      aiGenerated: true,
    });
    await updatePipeline(leadId, {
      stage: "archiviato",
      archived_reason: "non_interessato",
    });
    await updateLeadStatus(leadId, "lost");
    return;
  }

  // Risposta del bot (positivo / domanda / neutro).
  await sendToLead(lead, decision.reply, { aiGenerated: true });

  if (intent === "positivo" && lead.stage !== "demo_richiesta") {
    await updatePipeline(leadId, { stage: "demo_richiesta" });
    await updateLeadStatus(leadId, "replied");
    const template =
      TEMPLATE_BY_CATEGORY[String(lead.category)] ?? DEFAULT_TEMPLATE;
    const source = String(lead.category).includes("ristorante")
      ? "justeat"
      : "maps";
    await createBuildTask(leadId, template, source);
    await addAlert("info", `${lead.company} ha chiesto la demo: build in coda.`, leadId);
    await notifyPuccio(
      `✅ DEMO RICHIESTA — ${lead.company} (${lead.city}). Build automatica in coda.`,
    );
  } else {
    await updateLeadStatus(leadId, "replied");
  }
}

// ----- Tick outreach -----------------------------------------

async function anomalySweep() {
  const undelivered = await undeliveredTodayCount();
  if (undelivered >= 5) {
    const key = `non consegnati ${romeDay()}`;
    if (!(await alertExists(key))) {
      await addAlert(
        "anomaly",
        `Pattern anomalo (${key}): ${undelivered} messaggi inviati ma non consegnati da 30+ minuti. Possibile warning Meta.`,
      );
      await triggerKillSwitch(`${undelivered} messaggi non consegnati oggi`);
    }
  }
}

/** Notifica (una sola volta) le demo deployate in attesa di approvazione. */
async function notifyDeployedDemos() {
  for (const b of await buildsByStatus("deployed")) {
    const key = `demo pronta ${b.id}`;
    if (await alertExists(key)) continue;
    await addAlert("demo_ready", `demo pronta ${b.id}: ${b.preview_url}`, b.lead_id);
    await notifyPuccio(
      `🖥️ Demo pronta: ${b.preview_url}\nApprova dalla dashboard SPECTRE per inviarla al cliente.`,
    );
  }
}

/** Invia le demo approvate da Puccio in dashboard. */
async function sendApprovedDemos() {
  for (const b of await buildsByStatus("approved", 3)) {
    const row = await pipelineLead(String(b.lead_id));
    if (!row || !b.preview_url) continue;
    const ok = await sendToLead(row, demoReady(String(row.company), String(b.preview_url)));
    if (ok) {
      await updateBuild(String(b.id), { status: "sent" });
      await updateLeadStatus(String(b.lead_id), "preview_sent");
    }
    await sleep(randomDelayMs());
  }
}

/** Follow-up giorno 3 e 7 senza risposta, archivio al giorno 10. */
async function processFollowups() {
  for (const lead of await pipelineByStage("contattato")) {
    const leadId = String(lead.lead_id);
    if (await hasInbound(leadId)) continue;
    const days = daysSince(String(lead.contacted_at ?? ""));

    if (days >= ARCHIVE_AFTER_DAYS) {
      await updatePipeline(leadId, {
        stage: "archiviato",
        archived_reason: "nessuna risposta dopo 2 follow-up",
      });
      await updateLeadStatus(leadId, "lost");
      continue;
    }
    if (days >= FOLLOWUP_2_DAYS && !lead.followup2_at) {
      if (await sendToLead(lead, followup2(String(lead.company)))) {
        await updatePipeline(leadId, { followup2_at: new Date().toISOString() });
      }
      return true; // un solo invio per tick
    }
    if (days >= FOLLOWUP_1_DAYS && !lead.followup1_at) {
      if (await sendToLead(lead, followup1(String(lead.company)))) {
        await updatePipeline(leadId, { followup1_at: new Date().toISOString() });
      }
      return true;
    }
  }
  return false;
}

async function tick() {
  const settings = await getSettings();
  if (settings.kill_switch) return false;

  await anomalySweep();
  await notifyDeployedDemos();

  if (!inSendWindow()) return false;

  await sendApprovedDemos();

  if (await processFollowups()) return true;

  const counters = await getTodayCounters();
  const cap = dailyCap(settings);

  // Nuovo contatto (primo messaggio) — rispetta il cap giornaliero.
  if (counters.new_contacts >= cap) return false;
  const [lead] = await readyForOutreach(1);
  if (!lead) return false;

  const ok = await sendToLead(lead, String(lead.wa_first_message), {
    newContact: true,
  });
  if (ok) {
    await updatePipeline(String(lead.lead_id), {
      stage: "contattato",
      contacted_at: new Date().toISOString(),
    });
    await updateLeadStatus(String(lead.lead_id), "step1_sent");
    console.log("[worker] primo contatto:", lead.company);
  }
  return true;
}

// ----- Eventi client -----------------------------------------

client.on("qr", (qr) => {
  console.log("[worker] scansiona il QR col numero WA Business AYROMEX:");
  qrcode.generate(qr, { small: true });
  // Anche come PNG (worker/qr.png): alcuni terminali non rendono il QR
  // ASCII. Sovrascritto a ogni rigenerazione, eliminato a sessione pronta.
  QRCode.toFile("qr.png", qr, { width: 480, margin: 2 })
    .then(() => console.log("[worker] QR salvato anche in worker/qr.png"))
    .catch((err) => console.error("[worker] PNG QR fallito:", err.message));
});

client.on("ready", async () => {
  waReady = true;
  console.log("[worker] WhatsApp pronto. Loop outreach attivo.");
  // QR consumato: via il PNG, non serve più (e non deve restare in giro).
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink("qr.png");
  } catch {
    /* già assente */
  }
});

client.on("disconnected", async (reason) => {
  waReady = false;
  await triggerKillSwitch(`sessione WhatsApp disconnessa (${reason})`);
});

client.on("message", (msg) => {
  handleInbound(msg).catch((err) =>
    console.error("[worker] handleInbound:", err.message),
  );
});

// ack: 1 = server (sent), 2 = device (delivered), 3 = read.
client.on("message_ack", (msg, ack) => {
  const status = ack >= 3 ? "read" : ack >= 2 ? "delivered" : ack >= 1 ? "sent" : "failed";
  setWaMessageStatusByWaId(msg.id?._serialized ?? "", status).catch(() => {});
});

// ----- Main --------------------------------------------------

async function mainLoop() {
  for (;;) {
    let didSend = false;
    if (waReady) {
      try {
        didSend = await tick();
      } catch (err) {
        console.error("[worker] tick:", err.message);
      }
    }
    // Delay random 60-240s dopo un invio; check leggero ogni 60s altrimenti.
    await sleep(didSend ? randomDelayMs() : 60_000);
  }
}

console.log("[worker] avvio SPECTRE Autopilot worker…");
client.initialize();
mainLoop();
