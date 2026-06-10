// Accesso Turso del worker (stesso DB dell'app SPECTRE).
import { createClient } from "@libsql/client";
import { randomUUID } from "node:crypto";

const url = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
if (!url || !authToken) {
  console.error("[worker] TURSO_DATABASE_URL / TURSO_AUTH_TOKEN mancanti.");
  process.exit(1);
}

export const db = createClient({ url, authToken });

// ----- Settings ----------------------------------------------

export async function getSettings() {
  const res = await db.execute("SELECT key, value FROM autopilot_settings");
  const map = new Map(res.rows.map((r) => [String(r.key), String(r.value)]));
  return {
    kill_switch: map.get("kill_switch") === "1",
    warmup_started_at: map.get("warmup_started_at") || null,
    warmup_daily_cap: Number(map.get("warmup_daily_cap")) || 10,
    steady_daily_cap: Number(map.get("steady_daily_cap")) || 15,
    warmup_days: Number(map.get("warmup_days")) || 14,
  };
}

export async function setSetting(key, value) {
  await db.execute({
    sql: `INSERT INTO autopilot_settings (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [key, value],
  });
}

export function isWarmupActive(settings) {
  if (!settings.warmup_started_at) return true;
  const elapsed = Date.now() - new Date(settings.warmup_started_at).getTime();
  return elapsed < settings.warmup_days * 24 * 60 * 60 * 1000;
}

export function dailyCap(settings) {
  return isWarmupActive(settings)
    ? settings.warmup_daily_cap
    : settings.steady_daily_cap;
}

// ----- Counters ----------------------------------------------

export function romeDay(date = new Date()) {
  return date.toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
}

export async function getTodayCounters() {
  const day = romeDay();
  const res = await db.execute({
    sql: "SELECT * FROM autopilot_counters WHERE day = ? LIMIT 1",
    args: [day],
  });
  const r = res.rows[0];
  return {
    day,
    new_contacts: r ? Number(r.new_contacts) : 0,
    messages_sent: r ? Number(r.messages_sent) : 0,
  };
}

export async function bumpCounters({ newContact = false, sent = false }) {
  await db.execute({
    sql: `INSERT INTO autopilot_counters (day, new_contacts, messages_sent)
          VALUES (?, ?, ?)
          ON CONFLICT(day) DO UPDATE SET
            new_contacts = new_contacts + excluded.new_contacts,
            messages_sent = messages_sent + excluded.messages_sent`,
    args: [romeDay(), newContact ? 1 : 0, sent ? 1 : 0],
  });
}

// ----- Pipeline ----------------------------------------------

const PIPELINE_SELECT = `
  SELECT p.*, l.name, l.company, l.phone, l.meta
  FROM autopilot_pipeline p JOIN leads l ON l.id = p.lead_id`;

export async function pipelineByStage(stage, limit = 50) {
  const res = await db.execute({
    sql: `${PIPELINE_SELECT} WHERE p.stage = ? ORDER BY p.tier ASC, p.updated_at ASC LIMIT ?`,
    args: [stage, limit],
  });
  return res.rows;
}

/** Lead pronti al primo contatto: studiati + messaggio approvato o auto. */
export async function readyForOutreach(limit = 5) {
  const res = await db.execute({
    sql: `${PIPELINE_SELECT}
          WHERE p.stage = 'studiato'
            AND p.approval_status IN ('approved', 'auto')
            AND p.wa_first_message != ''
          ORDER BY p.tier ASC, p.approved_at ASC
          LIMIT ?`,
    args: [limit],
  });
  return res.rows;
}

export async function pipelineLead(leadId) {
  const res = await db.execute({
    sql: `${PIPELINE_SELECT} WHERE p.lead_id = ? LIMIT 1`,
    args: [leadId],
  });
  return res.rows[0] ?? null;
}

export async function findLeadByPhone(digits) {
  // Confronto sulle ultime 9 cifre: regge +39 / 0039 / spazi.
  const tail = digits.replace(/\D/g, "").slice(-9);
  if (!tail) return null;
  const res = await db.execute({
    sql: `${PIPELINE_SELECT}
          WHERE replace(replace(replace(l.phone, ' ', ''), '+', ''), '-', '') LIKE ?
          LIMIT 1`,
    args: [`%${tail}`],
  });
  return res.rows[0] ?? null;
}

export async function updatePipeline(leadId, fields) {
  const entries = Object.entries(fields);
  if (entries.length === 0) return;
  const setClause = entries.map(([k]) => `${k} = ?`).join(", ");
  await db.execute({
    sql: `UPDATE autopilot_pipeline SET ${setClause}, updated_at = datetime('now')
          WHERE lead_id = ?`,
    args: [...entries.map(([, v]) => v), leadId],
  });
}

/** Tiene allineato anche il CRM storico (leads.status / last_contact). */
export async function updateLeadStatus(leadId, status) {
  await db.execute({
    sql: `UPDATE leads SET status = ?, last_contact = datetime('now'),
          updated_at = datetime('now') WHERE id = ?`,
    args: [status, leadId],
  });
}

// ----- Messaggi WA (logging completo) ------------------------

export async function logWaMessage({
  leadId,
  direction,
  body,
  status = "queued",
  waId = "",
  aiGenerated = false,
}) {
  const id = `wa-${randomUUID()}`;
  await db.execute({
    sql: `INSERT INTO wa_messages (id, lead_id, direction, body, status, wa_id, ai_generated)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, leadId, direction, body, status, waId, aiGenerated ? 1 : 0],
  });
  return id;
}

export async function setWaMessageStatus(id, status, waId) {
  await db.execute({
    sql: waId
      ? "UPDATE wa_messages SET status = ?, wa_id = ? WHERE id = ?"
      : "UPDATE wa_messages SET status = ? WHERE id = ?",
    args: waId ? [status, waId, id] : [status, id],
  });
}

export async function setWaMessageStatusByWaId(waId, status) {
  if (!waId) return;
  await db.execute({
    sql: "UPDATE wa_messages SET status = ? WHERE wa_id = ?",
    args: [status, waId],
  });
}

export async function chatHistory(leadId, limit = 20) {
  const res = await db.execute({
    sql: `SELECT direction, body FROM wa_messages
          WHERE lead_id = ? ORDER BY created_at DESC LIMIT ?`,
    args: [leadId, limit],
  });
  return res.rows.reverse();
}

export async function hasInbound(leadId) {
  const res = await db.execute({
    sql: "SELECT 1 FROM wa_messages WHERE lead_id = ? AND direction = 'in' LIMIT 1",
    args: [leadId],
  });
  return res.rows.length > 0;
}

/** Messaggi di oggi usciti ma mai consegnati (pattern anomalo Meta). */
export async function undeliveredTodayCount() {
  const res = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM wa_messages
          WHERE direction = 'out' AND status = 'sent'
            AND created_at < datetime('now', '-30 minutes')
            AND date(created_at) = date('now')`,
    args: [],
  });
  return Number(res.rows[0].n);
}

// ----- Builds ------------------------------------------------

export async function createBuildTask(leadId, template, source) {
  await db.execute({
    sql: `INSERT INTO autopilot_builds (id, lead_id, status, template, source)
          VALUES (?, ?, 'pending', ?, ?)`,
    args: [`build-${randomUUID()}`, leadId, template, source],
  });
}

export async function buildsByStatus(status, limit = 10) {
  const res = await db.execute({
    sql: "SELECT * FROM autopilot_builds WHERE status = ? ORDER BY created_at ASC LIMIT ?",
    args: [status, limit],
  });
  return res.rows;
}

export async function updateBuild(id, fields) {
  const entries = Object.entries(fields);
  const setClause = entries.map(([k]) => `${k} = ?`).join(", ");
  await db.execute({
    sql: `UPDATE autopilot_builds SET ${setClause}, updated_at = datetime('now') WHERE id = ?`,
    args: [...entries.map(([, v]) => v), id],
  });
}

// ----- Alerts ------------------------------------------------

export async function addAlert(type, message, leadId = null) {
  await db.execute({
    sql: "INSERT INTO autopilot_alerts (id, type, message, lead_id) VALUES (?, ?, ?, ?)",
    args: [`alert-${randomUUID()}`, type, message, leadId],
  });
}

export async function alertExists(needle) {
  const res = await db.execute({
    sql: "SELECT 1 FROM autopilot_alerts WHERE message LIKE ? LIMIT 1",
    args: [`%${needle}%`],
  });
  return res.rows.length > 0;
}
