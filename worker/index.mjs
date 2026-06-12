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
// - solo fascia lun-sab 9:00-20:00 Europe/Rome (domenica esclusa)
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
  hasHumanInbound,
  logWaMessage,
  outboundWithinMinutes,
  pipelineByStage,
  pipelineLead,
  readyForOutreach,
  romeDay,
  setSetting,
  setWaMessageStatus,
  setWaMessageStatusByWaId,
  undeliveredTodayCount,
  waMessageExists,
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
  greetingNow,
  inSendWindow,
  randomDelayMs,
  sleep,
} from "./lib/schedule.mjs";
import {
  CONVERSATION_SYSTEM_PROMPT,
  DEFAULT_TEMPLATE,
  SUMMARY_SYSTEM_PROMPT,
  TEMPLATE_BY_CATEGORY,
} from "./lib/prompts.mjs";
import { tpl } from "./lib/templates.mjs";

const { Client, LocalAuth } = pkg;

const PUCCIO = (process.env.PUCCIO_WA_NUMBER ?? "").replace(/\D/g, "");
const SESSION_DIR = process.env.WA_SESSION_DIR ?? "./.wwebjs_auth";

/** LOCK PER-CHAT: mai più di 1 messaggio in uscita per chat in questa
 *  finestra, QUALUNQUE sia il chiamante (outreach, follow-up, bot,
 *  demo). Rete di sicurezza contro doppi eventi/processi/bug. */
const PER_CHAT_GAP_MIN = 30;

// ----- Single instance lock ----------------------------------
// Un solo worker per sessione: un secondo processo sugli stessi
// eventi = messaggi doppi ai lead. Lockfile con PID, controllo
// liveness all'avvio (lock orfani da crash vengono rimossi).
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const LOCK_FILE = "./.worker.lock";

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

(function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    const pid = Number(readFileSync(LOCK_FILE, "utf8").trim());
    if (pid && pid !== process.pid && pidAlive(pid)) {
      console.error(
        `[worker] ABORT: un altro worker è già attivo (PID ${pid}). ` +
          `Se è un errore, chiudi quel processo o elimina ${LOCK_FILE}.`,
      );
      process.exit(1);
    }
    console.log("[worker] lockfile orfano rimosso (processo morto).");
  }
  writeFileSync(LOCK_FILE, String(process.pid));
})();

function releaseLock() {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    /* già rimosso */
  }
}
process.on("exit", releaseLock);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    releaseLock();
    process.exit(0);
  });
}

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
  await notifyPuccio("kill_switch_notify", { MOTIVO: reason });
  console.error("[worker] kill switch automatico:", reason);
}

/** Notifica WA a Puccio dal template indicato. Il testo vive in
 *  message_templates; un template rotto NON deve mai bloccare il
 *  flusso chiamante (es. il kill switch resta attivo comunque). */
async function notifyPuccio(templateKey, vars = {}) {
  if (!PUCCIO || !waReady) return;
  try {
    const text = await tpl(templateKey, vars);
    await client.sendMessage(`${PUCCIO}@c.us`, text);
  } catch (err) {
    console.error("[worker] notifica a Puccio fallita:", err.message);
  }
}

/** Saluto risolto AL MOMENTO dell'invio: sostituisce il placeholder
 *  {SALUTO} dei messaggi generati da Study; retrocompatibilità per i
 *  messaggi già in coda che aprono con un saluto statico. */
function applyGreeting(body) {
  const greeting = greetingNow();
  if (body.includes("{SALUTO}")) return body.replaceAll("{SALUTO}", greeting);
  return body.replace(
    /^\s*(buongiorno|buon pomeriggio|buonasera)[!,.]?\s*/i,
    `${greeting} `,
  );
}

/** Invio tracciato: log su wa_messages, contatori, anomaly detection. */
async function sendToLead(lead, body, { aiGenerated = false, newContact = false } = {}) {
  body = applyGreeting(body);
  const chatId = chatIdFor(lead.phone);
  if (!chatId) {
    await updatePipeline(String(lead.lead_id), {
      stage: "archiviato",
      archived_reason: "telefono mancante/non valido",
    });
    return false;
  }
  // LOCK PER-CHAT (hard, su DB quindi cross-processo): se è uscito
  // qualcosa verso questo lead negli ultimi PER_CHAT_GAP_MIN minuti,
  // NON si invia. Nessuna eccezione: follow-up e demo ritentano al
  // tick successivo, il bot risponderà al prossimo messaggio.
  if (await outboundWithinMinutes(String(lead.lead_id), PER_CHAT_GAP_MIN)) {
    console.log(
      `[worker] LOCK per-chat: invio bloccato (<${PER_CHAT_GAP_MIN}min dall'ultimo out):`,
      lead.company,
    );
    return false;
  }

  // Risolvi il destinatario via WhatsApp (LID-aware): post-migrazione
  // LID l'id "<numero>@c.us" da solo può fallire ("No LID for user").
  // Numero non registrato su WA -> archivio, niente retry infiniti in
  // testa alla coda né kill switch per colpa di un numero morto.
  let recipientId = chatId;
  try {
    const numberId = await client.getNumberId(chatId.replace("@c.us", ""));
    if (numberId?._serialized) {
      recipientId = numberId._serialized;
    } else {
      // Skip-list per review: alert in dashboard, NON conta come
      // fallimento di invio (il circuit breaker resta a zero).
      await updatePipeline(String(lead.lead_id), {
        stage: "archiviato",
        archived_reason: "numero non raggiungibile su WhatsApp",
      });
      await addAlert(
        "skipped_number",
        `numero non raggiungibile su WhatsApp: ${lead.company} (${lead.phone})`,
        String(lead.lead_id),
      );
      console.log("[worker] SKIP numero non su WhatsApp, archiviato:", lead.company, lead.phone);
      return false;
    }
  } catch (err) {
    // Risoluzione fallita per cause transitorie: si tenta col classico.
    console.error("[worker] getNumberId fallito:", lead.company, err.message);
  }

  const msgId = await logWaMessage({
    leadId: String(lead.lead_id),
    direction: "out",
    body,
    aiGenerated,
  });
  try {
    const sent = await client.sendMessage(recipientId, body);
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

// Risponditori automatici dei business (away message Meta, ecc.):
// si salvano in chat ma NON sono risposte umane. Niente bot, stato
// invariato, follow-up regolari. Nel dubbio si tratta come umano.
const AUTOREPLY_PATTERNS = [
  /grazie per aver(ci|la|e)? contattat/i,
  /grazie per (il (tuo|suo)|aver(ci)? (inviato|scritto))\s*(un\s*)?messaggio/i,
  /(facci|fateci|ci faccia) sapere come possiamo aiutar/i,
  /come possiamo aiutart/i,
  /(ti|le|vi) risponderem(o|à)/i,
  /risponderemo (al più presto|il prima possibile|appena possibile|presto)/i,
  /messaggio (automatico|generato automaticamente)/i,
  /risposta automatica/i,
  /risponditore automatico/i,
  /orari (di |d['’])?apertura/i,
  /siamo (chiusi|momentaneamente chiusi|attualmente chiusi)/i,
  /fuori orario/i,
  /al momento non (siamo disponibili|possiamo rispondere)/i,
  /benvenut[oaie]\s+(a|al|alla|allo|da|in|nel|presso)\b/i,
  /siamo lieti di accoglier/i,
];

function isAutoReply(text) {
  return AUTOREPLY_PATTERNS.some((re) => re.test(text));
}

/** Numero (solo cifre) del mittente. Le chat WhatsApp nuove usano il
 *  LID (`...@lid`) al posto del numero: lì il telefono va risolto via
 *  contatto, l'id LID non è derivato dal numero. */
async function phoneDigitsFor(msg) {
  const from = msg.from ?? "";
  if (from.endsWith("@c.us")) return from.replace("@c.us", "");
  if (from.endsWith("@lid")) {
    try {
      const contact = await msg.getContact();
      const num = contact?.number ?? "";
      if (num) return num.replace(/\D/g, "");
    } catch (err) {
      console.error("[worker] risoluzione contatto LID fallita:", err.message);
    }
  }
  return null; // gruppi/broadcast/ignoto: ignora
}

/** @returns true se il messaggio è stato loggato (per il sync). */
async function handleInbound(msg, knownLead = null) {
  if (msg.fromMe) return false;
  const from = msg.from ?? "";
  if (!from.endsWith("@c.us") && !from.endsWith("@lid")) return false;

  let lead = knownLead;
  if (!lead) {
    const digits = await phoneDigitsFor(msg);
    if (!digits || digits === PUCCIO) return false;
    lead = await findLeadByPhone(digits);
  }
  if (!lead) return false; // numero non in pipeline: ignora

  const leadId = String(lead.lead_id);
  const body = (msg.body ?? "").trim();
  const waId = msg.id?._serialized ?? "";
  // Dedup: message + message_create + syncMissedInbound possono
  // ripresentare lo stesso messaggio (anche tra restart).
  if (waId && (await waMessageExists(waId))) return false;

  // Messaggi senza testo (media, vcard, card di benvenuto Business):
  // in chat col placeholder, NESSUNA risposta del bot (Gemini non deve
  // conversare col nulla). Flag ai_generated cosicché i follow-up
  // continuino come da piano.
  if (!body) {
    await logWaMessage({
      leadId,
      direction: "in",
      body: "[contenuto non testuale]",
      status: "delivered",
      waId,
      aiGenerated: true,
    });
    console.log("[worker] inbound non testuale, nessuna risposta:", lead.company);
    return true;
  }

  // Auto-reply: in chat con flag ai_generated (= messaggio macchina),
  // niente bot, stato invariato — resta "in attesa di risposta umana".
  const autoReply = isAutoReply(body);
  await logWaMessage({
    leadId,
    direction: "in",
    body,
    status: "delivered",
    waId,
    aiGenerated: autoReply,
  });
  if (autoReply) {
    console.log("[worker] auto-reply rilevato, nessuna risposta:", lead.company);
    return true;
  }

  const settings = await getSettings();
  if (settings.kill_switch || Number(lead.bot_paused) === 1) return true;
  if (lead.stage === "archiviato" || lead.stage === "escalation") return true;

  const history = await chatHistory(leadId);
  const transcript = history
    .map((m) => `${m.direction === "out" ? "TU" : "CLIENTE"}: ${m.body}`)
    .join("\n");

  // Ora corrente nel prompt: le risposte sono generate live e il
  // saluto (se serve) deve essere coerente con l'orario.
  const nowRome = new Date().toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const decision = await geminiJSON(
    CONVERSATION_SYSTEM_PROMPT,
    `Attività: ${lead.company} (${lead.category}, ${lead.city})\nOra attuale (Europe/Rome): ${nowRome}\n\nCHAT FINORA:\n${transcript}\n\nRispondi all'ultimo messaggio del cliente.`,
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
    await notifyPuccio("escalation_notify", {
      NOME_ATTIVITA: lead.company,
      TELEFONO: lead.phone,
      MOTIVO: reason,
      RIASSUNTO: summary?.summary ?? transcript.slice(-500),
    });
    return true; // il bot si ferma su questa chat
  }

  if (intent === "rifiuto") {
    await sendToLead(lead, decision?.reply || (await tpl("archive_reject")), {
      aiGenerated: true,
    });
    await updatePipeline(leadId, {
      stage: "archiviato",
      archived_reason: "non_interessato",
    });
    await updateLeadStatus(leadId, "lost");
    return true;
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
    await notifyPuccio("demo_request_notify", {
      NOME_ATTIVITA: lead.company,
      CITTA: lead.city,
    });
  } else {
    await updateLeadStatus(leadId, "replied");
  }
  return true;
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
    await notifyPuccio("demo_ready_notify", { URL_DEMO: b.preview_url });
  }
}

/** Invia le demo approvate da Puccio in dashboard. */
async function sendApprovedDemos() {
  for (const b of await buildsByStatus("approved", 3)) {
    const row = await pipelineLead(String(b.lead_id));
    if (!row || !b.preview_url) continue;
    const body = await tpl("demo_ready", {
      NOME_ATTIVITA: String(row.company),
      URL_DEMO: String(b.preview_url),
    });
    const ok = await sendToLead(row, body);
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
    if (await hasHumanInbound(leadId)) continue;
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
      const body = await tpl("followup_day7", { NOME_ATTIVITA: String(lead.company) });
      if (await sendToLead(lead, body)) {
        await updatePipeline(leadId, { followup2_at: new Date().toISOString() });
      }
      return true; // un solo invio per tick
    }
    if (days >= FOLLOWUP_1_DAYS && !lead.followup1_at) {
      const body = await tpl("followup_day3", { NOME_ATTIVITA: String(lead.company) });
      if (await sendToLead(lead, body)) {
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

// ----- Sync messaggi persi -----------------------------------

/** Recupera dalla cronologia WhatsApp gli inbound arrivati mentre il
 *  worker era giù o durante una riconnessione (eventi persi). Scorre
 *  le chat dei lead contattati e ripassa a handleInbound i messaggi
 *  non ancora in wa_messages (dedup su wa_id: idempotente). */
async function syncMissedInbound() {
  const stages = ["contattato", "demo_richiesta", "escalation"];
  let recovered = 0;
  for (const stage of stages) {
    for (const lead of await pipelineByStage(stage)) {
      const chatId = chatIdFor(lead.phone);
      if (!chatId) continue;
      try {
        const chat = await client.getChatById(chatId);
        const msgs = await chat.fetchMessages({ limit: 20 });
        for (const m of msgs) {
          if (m.fromMe) continue;
          const waId = m.id?._serialized ?? "";
          if (!waId || (await waMessageExists(waId))) continue;
          // Lead noto dalla chat: niente matching dal from (che nelle
          // chat LID non contiene il numero).
          if (await handleInbound(m, lead)) recovered++;
        }
      } catch (err) {
        console.error(
          "[worker] sync chat fallito:",
          lead.company,
          err.message,
        );
      }
    }
  }
  if (recovered > 0) {
    console.log(`[worker] sync: recuperati ${recovered} messaggi in entrata persi`);
  }
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
  // Ripesca gli inbound persi mentre eravamo giù/riconnessi ("ready"
  // può scattare più volte: il sync è idempotente, dedup su wa_id).
  syncMissedInbound().catch((err) =>
    console.error("[worker] syncMissedInbound:", err.message),
  );
});

client.on("disconnected", async (reason) => {
  waReady = false;
  await triggerKillSwitch(`sessione WhatsApp disconnessa (${reason})`);
});

// Doppia sottoscrizione: dopo una riconnessione whatsapp-web.js a
// volte non emette più "message" — message_create copre il buco
// (fromMe filtrato in handleInbound, dedup su wa_id nel DB).
const onInbound = (msg) => {
  handleInbound(msg).catch((err) =>
    console.error("[worker] handleInbound:", err.message),
  );
};
client.on("message", onInbound);
client.on("message_create", (msg) => {
  if (!msg.fromMe) onInbound(msg);
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
