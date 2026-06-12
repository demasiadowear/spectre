// ============================================================
// SPECTRE AUTOPILOT — worker WhatsApp (outreach + classificatore).
// Gira su VPS/macchina locale con sessione persistente sul numero
// WA Business AYROMEX. NON gira su Vercel.
// SPECTRE non builda demo: il worker invia solo i link demo che
// Puccio prepara fuori e approva in dashboard (demo_url).
//
//   npm start  -> worker WA (unico processo)
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
  chatHistory,
  dailyCap,
  demosToSend,
  findLeadByPhone,
  getSettings,
  getTodayCounters,
  hasHumanInbound,
  logWaMessage,
  outboundWithinMinutes,
  pipelineByStage,
  readyForOutreach,
  romeDay,
  secondsSinceLastOutbound,
  setSetting,
  setWaMessageStatus,
  setWaMessageStatusByWaId,
  undeliveredTodayCount,
  waMessageExists,
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
  CLASSIFY_INBOUND_PROMPT,
  CONVERSATION_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
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

/** Invio tracciato: log su wa_messages, contatori, anomaly detection.
 *  skipChatLock: SOLO per il messaggio di sblocco auto-reply, che per
 *  natura parte pochi secondi dopo il nostro outreach (il lock per-chat
 *  lo bloccherebbe sempre). La sicurezza lì è bypass_sent_at: massimo
 *  1 tentativo per lead, per sempre. */
async function sendToLead(
  lead,
  body,
  { aiGenerated = false, newContact = false, skipChatLock = false } = {},
) {
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
  // NON si invia. Unica eccezione: skipChatLock (vedi sopra).
  if (!skipChatLock && (await outboundWithinMinutes(String(lead.lead_id), PER_CHAT_GAP_MIN))) {
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

// Opt-out esplicito: archivio gentile senza scomodare Gemini.
const OPTOUT_PATTERNS = [
  /non\s+(sono|siamo)\s+interessat/i,
  /non\s+(mi|ci)\s+interessa/i,
  /non\s+scrive(temi|rmi|teci)\s*(più)?/i,
  /non\s+contattate(mi|ci)/i,
  /smettete\s+di\s+scrivere/i,
  /cancell(a|ate)(mi|ci)/i,
  /toglie(temi|teci)|rimuove(temi|teci)/i,
  /^\s*stop\s*$/i,
  /lasciate\s+perdere/i,
];

function isOptOut(text) {
  return OPTOUT_PATTERNS.some((re) => re.test(text));
}

// Tipi messaggio WhatsApp tipici dei risponditori Business (menu
// interattivi, liste opzioni, bottoni): nessun umano li manda a mano.
const MENU_MESSAGE_TYPES = new Set([
  "list",
  "list_response",
  "buttons_response",
  "template_button_reply",
  "interactive",
]);

/** Latenza sotto cui un inbound è considerato macchina: nessun umano
 *  legge e risponde al nostro outreach in meno di 3 secondi. */
const AUTOREPLY_LATENCY_S = 3;

/**
 * Classificatore a 3 vie: "auto" | "human" | "optout".
 * Ordine: euristiche certe prima (gratis), Gemini solo nei dubbi.
 * REGOLA FERREA: qualunque dubbio o errore -> "human".
 */
async function classifyInbound(lead, msg, body) {
  if (isOptOut(body)) return "optout";
  if (isAutoReply(body)) return "auto";
  if (MENU_MESSAGE_TYPES.has(msg.type ?? "")) return "auto";

  const sinceOut = await secondsSinceLastOutbound(String(lead.lead_id));
  if (sinceOut !== null && sinceOut >= 0 && sinceOut < AUTOREPLY_LATENCY_S) {
    return "auto";
  }

  // Zona grigia: decide Gemini, freddo (temperature bassa).
  const verdict = await geminiJSON(
    CLASSIFY_INBOUND_PROMPT,
    `Attività: ${lead.company} (${lead.category}, ${lead.city})\n` +
      `Secondi trascorsi dal nostro ultimo messaggio: ${sinceOut === null ? "sconosciuti" : Math.round(sinceOut)}\n\n` +
      `MESSAGGIO DEL CLIENTE:\n${body}`,
    0.1,
  );
  if (!verdict) return "human"; // Gemini giù: si tratta come umano
  const conf = Number(verdict.confidence) || 0;
  if (verdict.classification === "auto_reply" && conf >= 0.75) return "auto";
  if (verdict.classification === "opt_out" && conf >= 0.6) return "optout";
  return "human";
}

/** Lead di test e2e (meta.test = true): il numero di Puccio può fare
 *  da lead solo se esiste questa riga, altrimenti resta ignorato. */
function isTestLead(lead) {
  try {
    return lead != null && JSON.parse(String(lead.meta ?? "{}")).test === true;
  } catch {
    return false;
  }
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

/** Sblocco auto-reply: il bot manda UN solo messaggio (template
 *  bypass_autoreply) per scavalcare il risponditore automatico, poi
 *  tace per sempre: il lead resta in attesa di risposta umana.
 *  bypass_sent_at su DB = garanzia hard; il Set in-flight para i
 *  doppi eventi ravvicinati (welcome card + away message insieme). */
const bypassInFlight = new Set();

async function handleAutoReplyUnlock(lead) {
  const leadId = String(lead.lead_id);
  if (lead.bypass_sent_at || bypassInFlight.has(leadId)) return;
  bypassInFlight.add(leadId);
  try {
    const settings = await getSettings();
    if (settings.kill_switch) return;
    if (await hasHumanInbound(leadId)) return; // c'è già un umano in chat
    const body = await tpl("bypass_autoreply");
    const ok = await sendToLead(lead, body, {
      aiGenerated: true,
      skipChatLock: true,
    });
    if (ok) {
      await updatePipeline(leadId, { bypass_sent_at: new Date().toISOString() });
      console.log("[worker] sblocco auto-reply inviato:", lead.company);
    }
  } catch (err) {
    console.error("[worker] sblocco auto-reply fallito:", err.message);
  } finally {
    bypassInFlight.delete(leadId);
  }
}

/** @returns true se il messaggio è stato loggato (per il sync). */
async function handleInbound(msg, knownLead = null) {
  if (msg.fromMe) return false;
  const from = msg.from ?? "";
  if (!from.endsWith("@c.us") && !from.endsWith("@lid")) return false;

  let lead = knownLead;
  if (!lead) {
    const digits = await phoneDigitsFor(msg);
    if (!digits) return false;
    lead = await findLeadByPhone(digits);
    // Il numero personale di Puccio fa da lead SOLO nel test e2e
    // (riga pipeline con meta.test = true), mai in produzione.
    if (digits === PUCCIO && !isTestLead(lead)) return false;
  }
  if (!lead) return false; // numero non in pipeline: ignora

  const leadId = String(lead.lead_id);
  const body = (msg.body ?? "").trim();
  const waId = msg.id?._serialized ?? "";
  // Dedup: message + message_create + syncMissedInbound possono
  // ripresentare lo stesso messaggio (anche tra restart).
  if (waId && (await waMessageExists(waId))) return false;

  // Messaggi senza testo (media, vcard, card di benvenuto Business):
  // in chat col placeholder, nessuna conversazione. I menu interattivi
  // senza testo sono però auto-reply a tutti gli effetti: tentano lo
  // sblocco come gli altri.
  if (!body) {
    const isMenu = MENU_MESSAGE_TYPES.has(msg.type ?? "");
    await logWaMessage({
      leadId,
      direction: "in",
      body: isMenu ? "[menu automatico]" : "[contenuto non testuale]",
      status: "delivered",
      waId,
      aiGenerated: true,
    });
    if (isMenu) await handleAutoReplyUnlock(lead);
    else console.log("[worker] inbound non testuale, nessuna risposta:", lead.company);
    return true;
  }

  // ----- CLASSIFICATORE 3 VIE ---------------------------------
  // auto  -> nessuna notifica, 1 solo messaggio di sblocco, poi tace
  // human -> notifica immediata a Puccio, bot muto, kanban manuale
  // optout-> archivio gentile, nessuna notifica
  const cls = await classifyInbound(lead, msg, body);

  await logWaMessage({
    leadId,
    direction: "in",
    body,
    status: "delivered",
    waId,
    aiGenerated: cls === "auto",
  });

  if (cls === "auto") {
    console.log("[worker] auto-reply rilevato:", lead.company);
    await handleAutoReplyUnlock(lead);
    return true;
  }

  const settings = await getSettings();

  if (cls === "optout") {
    if (!settings.kill_switch) {
      await sendToLead(lead, await tpl("archive_reject"), { aiGenerated: true });
    }
    await updatePipeline(leadId, {
      stage: "archiviato",
      archived_reason: "opt-out",
      bot_paused: 1,
    });
    await updateLeadStatus(leadId, "lost");
    console.log("[worker] opt-out, archivio gentile:", lead.company);
    return true;
  }

  // ----- RISPOSTA UMANA ---------------------------------------
  // Bot conversazionale OFF (default): il bot si AMMUTOLISCE per
  // sempre su questa chat, Puccio prende in mano. La notifica parte
  // anche a kill switch attivo: è verso di noi, non verso il lead.
  if (!settings.bot_conversational) {
    if (
      lead.stage === "risposto_manuale" ||
      lead.stage === "escalation" ||
      lead.stage === "archiviato"
    ) {
      return true; // già in mani umane: solo log, zero rumore
    }
    await updatePipeline(leadId, { stage: "risposto_manuale", bot_paused: 1 });
    await updateLeadStatus(leadId, "replied");
    await addAlert(
      "human_reply",
      `${lead.company} ha risposto: "${body.slice(0, 160)}"`,
      leadId,
    );
    const digits = chatIdFor(lead.phone)?.replace("@c.us", "") ?? "";
    await notifyPuccio("human_reply_notify", {
      NOME_ATTIVITA: lead.company,
      TELEFONO: lead.phone,
      MESSAGGIO: body.slice(0, 300),
      LINK_CHAT: digits ? `https://wa.me/${digits}` : "",
    });
    console.log("[worker] risposta umana, passo a manuale:", lead.company);
    return true;
  }

  // ----- Bot conversazionale (legacy, solo con flag ON) --------
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
    // La build NON parte mai da sola: solo il bottone "Genera demo"
    // in dashboard la mette in coda. Qui solo stato + notifica.
    await updatePipeline(leadId, { stage: "demo_richiesta" });
    await updateLeadStatus(leadId, "replied");
    await addAlert(
      "info",
      `${lead.company} ha chiesto la demo: genera la build dalla dashboard.`,
      leadId,
    );
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

/** Invia i link demo che Puccio ha incollato e approvato in dashboard
 *  (demo_url presente, demo_sent_at vuoto). SPECTRE non builda nulla:
 *  la demo la prepara Puccio fuori, qui parte solo il messaggio WA. */
async function sendManualDemos() {
  for (const row of await demosToSend(3)) {
    const body = await tpl("demo_ready", {
      NOME_ATTIVITA: String(row.company),
      URL_DEMO: String(row.demo_url),
    });
    const ok = await sendToLead(row, body);
    if (ok) {
      await updatePipeline(String(row.lead_id), {
        demo_sent_at: new Date().toISOString(),
        stage: "demo_richiesta",
      });
      await updateLeadStatus(String(row.lead_id), "preview_sent");
      console.log("[worker] demo inviata:", row.company);
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

  if (!inSendWindow()) return false;

  await sendManualDemos();

  if (await processFollowups()) return true;

  const counters = await getTodayCounters();
  const cap = dailyCap(settings);

  // Nuovo contatto (primo messaggio) — rispetta il cap giornaliero.
  // Cap esaurito con approvati ancora in coda: Puccio lo deve sapere
  // (alert una sola volta al giorno), altrimenti la coda sembra rotta.
  if (counters.new_contacts >= cap) {
    const [waiting] = await readyForOutreach(1);
    if (waiting) {
      const key = `cap esaurito ${romeDay()}`;
      if (!(await alertExists(key))) {
        await addAlert(
          "info",
          `Cap giornaliero esaurito (${key}): i messaggi approvati restano in coda fino a domani.`,
        );
      }
    }
    return false;
  }
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
  const stages = ["contattato", "risposto_manuale", "demo_richiesta", "escalation"];
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
    // Heartbeat SEMPRE, anche senza sessione WA: la dashboard mostra
    // "WORKER OFFLINE" quando questo timestamp invecchia oltre 3 min.
    // È il fix del bug "approvati fermi in coda e nessuno se ne accorge".
    try {
      await setSetting("worker_heartbeat", new Date().toISOString());
      await setSetting("worker_wa_ready", waReady ? "1" : "0");
    } catch (err) {
      console.error("[worker] heartbeat:", err.message);
    }
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
