import { turso } from "@/lib/turso";
import { classifyPhone } from "@/lib/pitch";
import type {
  ApprovalStatus,
  AutopilotAlert,
  AutopilotLead,
  AutopilotStage,
  AutopilotStats,
  AutopilotStudy,
  WaMessage,
} from "@/types/autopilot";
import { AUTOPILOT_STAGES } from "./constants";

// ============================================================
// Autopilot data access (Turso). A differenza dei moduli storici
// non c'è mock store: senza Turso le letture tornano vuote e le
// scritture sono no-op — la dashboard mostra "DB non configurato".
// ============================================================

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? "" : String(v));
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

function parseStudy(raw: unknown): AutopilotStudy | null {
  try {
    const parsed = JSON.parse(str(raw) || "{}");
    return parsed && Object.keys(parsed).length > 0
      ? (parsed as AutopilotStudy)
      : null;
  } catch {
    return null;
  }
}

function rowToAutopilotLead(r: Row): AutopilotLead {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(str(r.meta) || "{}");
  } catch {
    /* meta corrotta: ignora */
  }
  return {
    lead_id: str(r.lead_id),
    stage: str(r.stage) as AutopilotStage,
    place_id: str(r.place_id),
    category: str(r.category),
    city: str(r.city),
    brief: str(r.brief),
    study: parseStudy(r.study_json),
    wa_first_message: str(r.wa_first_message),
    approval_status: str(r.approval_status) as ApprovalStatus,
    approved_at: r.approved_at ? str(r.approved_at) : null,
    contacted_at: r.contacted_at ? str(r.contacted_at) : null,
    followup1_at: r.followup1_at ? str(r.followup1_at) : null,
    followup2_at: r.followup2_at ? str(r.followup2_at) : null,
    escalated_at: r.escalated_at ? str(r.escalated_at) : null,
    escalation_reason: str(r.escalation_reason),
    archived_reason: str(r.archived_reason),
    bot_paused: num(r.bot_paused) === 1,
    bypass_sent_at: r.bypass_sent_at ? str(r.bypass_sent_at) : null,
    demo_url: str(r.demo_url),
    demo_sent_at: r.demo_sent_at ? str(r.demo_sent_at) : null,
    next_action: str(r.next_action),
    next_action_at: r.next_action_at ? str(r.next_action_at) : null,
    lost_reason: str(r.lost_reason),
    notes: str(r.notes),
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
    price: meta.price == null || meta.price === "" ? null : num(meta.price),
    name: str(r.name),
    company: str(r.company),
    phone: str(r.phone),
    rating: num(meta.rating),
    reviews: num(meta.reviews),
    address: str(meta.address),
    lat: typeof meta.lat === "number" ? meta.lat : null,
    lng: typeof meta.lng === "number" ? meta.lng : null,
    // Tipo salvato (scout/study/retroattivo); fallback al volo se assente,
    // così il badge è corretto anche su righe non ancora classificate.
    phone_type:
      meta.phone_type === "mobile" || meta.phone_type === "fisso"
        ? meta.phone_type
        : classifyPhone(str(r.phone)),
  };
}

const PIPELINE_SELECT = `
  SELECT p.*, l.name, l.company, l.phone, l.meta, l.notes
  FROM autopilot_pipeline p
  JOIN leads l ON l.id = p.lead_id`;

// ----- Pipeline ----------------------------------------------

export async function getPipeline(
  stage?: AutopilotStage,
): Promise<AutopilotLead[]> {
  if (!turso) return [];
  const res = stage
    ? await turso.execute({
        sql: `${PIPELINE_SELECT} WHERE p.stage = ? ORDER BY p.updated_at DESC`,
        args: [stage],
      })
    : await turso.execute(`${PIPELINE_SELECT} ORDER BY p.updated_at DESC`);
  return res.rows.map((r) => rowToAutopilotLead(r as Row));
}

export async function getPipelineLead(
  leadId: string,
): Promise<AutopilotLead | null> {
  if (!turso) return null;
  const res = await turso.execute({
    sql: `${PIPELINE_SELECT} WHERE p.lead_id = ? LIMIT 1`,
    args: [leadId],
  });
  return res.rows[0] ? rowToAutopilotLead(res.rows[0] as Row) : null;
}

export interface NewPipelineRow {
  lead_id: string;
  place_id: string;
  category: string;
  city: string;
}

export async function insertPipelineRow(row: NewPipelineRow): Promise<void> {
  if (!turso) return;
  // place_id vuoto -> NULL: la colonna è UNIQUE e in SQLite due '' collidono,
  // due NULL no. tier resta '' (colonna storica, non più usata).
  await turso.execute({
    sql: `INSERT OR IGNORE INTO autopilot_pipeline
            (lead_id, stage, tier, place_id, category, city)
          VALUES (?, 'da_contattare', '', ?, ?, ?)`,
    args: [row.lead_id, row.place_id || null, row.category, row.city],
  });
}

/** True se un place_id è già presente in pipeline (dedup post-risoluzione). */
export async function placeIdInPipeline(placeId: string): Promise<boolean> {
  if (!turso || !placeId) return false;
  const res = await turso.execute({
    sql: "SELECT 1 FROM autopilot_pipeline WHERE place_id = ? LIMIT 1",
    args: [placeId],
  });
  return res.rows.length > 0;
}

export async function knownPlaceIds(): Promise<Set<string>> {
  if (!turso) return new Set();
  const res = await turso.execute(
    "SELECT place_id FROM autopilot_pipeline WHERE place_id IS NOT NULL",
  );
  return new Set(res.rows.map((r) => str(r.place_id)).filter(Boolean));
}

/** Telefoni normalizzati (solo cifre, senza prefisso) di TUTTI i leads —
 *  dedup contro il CRM esistente, non solo contro l'autopilot. */
export async function knownPhones(): Promise<Set<string>> {
  if (!turso) return new Set();
  const res = await turso.execute(
    "SELECT phone FROM leads WHERE phone IS NOT NULL AND phone != ''",
  );
  return new Set(
    res.rows.map((r) => normalizePhone(str(r.phone))).filter(Boolean),
  );
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("39") ? digits.slice(2) : digits;
}

/** Colonne aggiornabili: whitelist runtime. I nomi finiscono concatenati
 *  nella SQL (libSQL parametrizza i valori, non gli identificatori), quindi
 *  qualunque chiave fuori da qui viene scartata — niente SQL injection
 *  latente se la firma cresce o viene aggirata con un cast. */
const UPDATABLE_PIPELINE_FIELDS = new Set([
  "stage",
  "place_id",
  "brief",
  "study_json",
  "wa_first_message",
  "approval_status",
  "approved_at",
  "contacted_at",
  "followup1_at",
  "followup2_at",
  "escalated_at",
  "escalation_reason",
  "archived_reason",
  "bot_paused",
  "demo_url",
  "next_action",
  "next_action_at",
  "lost_reason",
]);

export async function updatePipeline(
  leadId: string,
  fields: Partial<{
    stage: AutopilotStage;
    place_id: string;
    brief: string;
    study_json: string;
    wa_first_message: string;
    approval_status: ApprovalStatus;
    approved_at: string;
    contacted_at: string;
    followup1_at: string;
    followup2_at: string;
    escalated_at: string;
    escalation_reason: string;
    archived_reason: string;
    bot_paused: number;
    demo_url: string;
    next_action: string;
    next_action_at: string | null;
    lost_reason: string;
  }>,
): Promise<void> {
  if (!turso) return;
  const entries = Object.entries(fields).filter(([k]) =>
    UPDATABLE_PIPELINE_FIELDS.has(k),
  );
  if (entries.length === 0) return;
  const setClause = entries.map(([k]) => `${k} = ?`).join(", ");
  await turso.execute({
    sql: `UPDATE autopilot_pipeline
          SET ${setClause}, updated_at = datetime('now')
          WHERE lead_id = ?`,
    args: [...entries.map(([, v]) => v as string | number | null), leadId],
  });
}

// ----- Trattativa (stati manuali di Puccio) -------------------

/** Stage selezionabili a mano dal drawer + mapping verso lo status
 *  del CRM storico (leads.status, funnel Visor). */
export interface DealUpdate {
  stage?: AutopilotStage;
  next_action?: string;
  next_action_at?: string | null;
  lost_reason?: string;
  notes?: string;
}

/** Aggiornamento trattativa dal drawer: stage + prossima azione + note.
 *  Sorgente unica = autopilot_pipeline.stage; le note vivono su
 *  leads.notes. Niente più sync con leads.status (storico). */
export async function updateDeal(leadId: string, upd: DealUpdate): Promise<void> {
  if (!turso) return;
  const fields: Parameters<typeof updatePipeline>[1] = {};
  if (upd.stage) fields.stage = upd.stage;
  if (upd.next_action !== undefined) fields.next_action = upd.next_action;
  if (upd.next_action_at !== undefined) fields.next_action_at = upd.next_action_at;
  if (upd.lost_reason !== undefined) fields.lost_reason = upd.lost_reason;
  await updatePipeline(leadId, fields);

  if (upd.notes !== undefined) {
    await turso.execute({
      sql: "UPDATE leads SET notes = ?, updated_at = datetime('now') WHERE id = ?",
      args: [upd.notes, leadId],
    });
  }
}

/** Prezzo manuale del lead (€), deciso da Puccio. null = nessun prezzo.
 *  Vive in leads.meta.price; nessun prezzo automatico dal sistema. */
export async function setLeadPrice(leadId: string, price: number | null): Promise<void> {
  if (!turso) return;
  const res = await turso.execute({
    sql: "SELECT meta FROM leads WHERE id = ? LIMIT 1",
    args: [leadId],
  });
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(str(res.rows[0]?.meta) || "{}");
  } catch {
    /* meta corrotta: riparte da zero */
  }
  if (price == null) delete meta.price;
  else meta.price = price;
  await turso.execute({
    sql: "UPDATE leads SET meta = ?, updated_at = datetime('now') WHERE id = ?",
    args: [JSON.stringify(meta), leadId],
  });
}

/** Archivio manuale dalla dashboard (qualsiasi stadio). */
export async function archiveLead(leadId: string): Promise<void> {
  await updatePipeline(leadId, {
    stage: "archiviato",
    archived_reason: "archiviato manualmente",
  });
}

// ----- Messaggi WA -------------------------------------------

export async function getWaMessages(leadId: string): Promise<WaMessage[]> {
  if (!turso) return [];
  const res = await turso.execute({
    sql: "SELECT * FROM wa_messages WHERE lead_id = ? ORDER BY created_at ASC",
    args: [leadId],
  });
  return res.rows.map((r) => ({
    id: str(r.id),
    lead_id: str(r.lead_id),
    direction: str(r.direction) as WaMessage["direction"],
    body: str(r.body),
    status: str(r.status) as WaMessage["status"],
    wa_id: str(r.wa_id),
    ai_generated: num(r.ai_generated) === 1,
    created_at: str(r.created_at),
  }));
}

/** Registra un messaggio in chat (copilota manuale: Puccio invia/riceve
 *  su WhatsApp, qui si tiene solo lo storico). `direction` "out" = nostro,
 *  "in" = del cliente. Nessun wa_id reale: lo scrive l'operatore. */
export async function logWaMessage(msg: {
  leadId: string;
  direction: WaMessage["direction"];
  body: string;
  aiGenerated?: boolean;
  status?: WaMessage["status"];
}): Promise<void> {
  if (!turso) return;
  await turso.execute({
    sql: `INSERT INTO wa_messages (id, lead_id, direction, body, status, wa_id, ai_generated)
          VALUES (?, ?, ?, ?, ?, '', ?)`,
    args: [
      `wa-${crypto.randomUUID()}`,
      msg.leadId,
      msg.direction,
      msg.body,
      msg.status ?? (msg.direction === "out" ? "sent" : "delivered"),
      msg.aiGenerated ? 1 : 0,
    ],
  });
}

/** Primo contatto inviato a mano: la pipeline passa a "contattato".
 *  Idempotente: il guard `contacted_at IS NULL` non sovrascrive il
 *  timestamp di un contatto già segnato. */
export async function markContacted(leadId: string): Promise<void> {
  if (!turso) return;
  await turso.execute({
    sql: `UPDATE autopilot_pipeline
          SET stage = 'contattato', contacted_at = ?, updated_at = datetime('now')
          WHERE lead_id = ? AND contacted_at IS NULL`,
    args: [new Date().toISOString(), leadId],
  });
}

/** Demo inviata a mano (link incollato + mandato su WhatsApp da Puccio).
 *  La demo non è più uno stato: il lead resta "in trattativa", il
 *  dettaglio sta in next_action. */
export async function markDemoSent(leadId: string, demoUrl?: string): Promise<void> {
  if (!turso) return;
  await turso.execute({
    sql: `UPDATE autopilot_pipeline
          SET ${demoUrl ? "demo_url = ?, " : ""}demo_sent_at = datetime('now'),
              stage = 'in_trattativa', next_action = 'demo inviata, attesa risposta',
              updated_at = datetime('now')
          WHERE lead_id = ?`,
    args: demoUrl ? [demoUrl, leadId] : [leadId],
  });
}

// ----- Alerts ------------------------------------------------

export async function getAlerts(unreadOnly = false): Promise<AutopilotAlert[]> {
  if (!turso) return [];
  const res = await turso.execute(
    `SELECT * FROM autopilot_alerts ${unreadOnly ? "WHERE read = 0" : ""}
     ORDER BY created_at DESC LIMIT 50`,
  );
  return res.rows.map((r) => ({
    id: str(r.id),
    type: str(r.type),
    message: str(r.message),
    lead_id: r.lead_id ? str(r.lead_id) : null,
    read: num(r.read) === 1,
    created_at: str(r.created_at),
  }));
}

export async function addAlert(
  type: string,
  message: string,
  leadId?: string,
): Promise<void> {
  if (!turso) return;
  await turso.execute({
    sql: "INSERT INTO autopilot_alerts (id, type, message, lead_id) VALUES (?, ?, ?, ?)",
    args: [`alert-${crypto.randomUUID()}`, type, message, leadId ?? null],
  });
}

export async function markAlertsRead(): Promise<void> {
  if (!turso) return;
  await turso.execute("UPDATE autopilot_alerts SET read = 1 WHERE read = 0");
}

// ----- Stats -------------------------------------------------

export async function getStats(): Promise<AutopilotStats> {
  const by_stage = Object.fromEntries(
    AUTOPILOT_STAGES.map((s) => [s, 0]),
  ) as Record<AutopilotStage, number>;
  let unread = 0;
  if (turso) {
    const stages = await turso.execute(
      "SELECT stage, COUNT(*) AS n FROM autopilot_pipeline GROUP BY stage",
    );
    for (const r of stages.rows) {
      const stage = str(r.stage) as AutopilotStage;
      if (stage in by_stage) by_stage[stage] = num(r.n);
    }
    const a = await turso.execute(
      "SELECT COUNT(*) AS n FROM autopilot_alerts WHERE read = 0",
    );
    unread = num((a.rows[0] as Row).n);
  }
  return { by_stage, unread_alerts: unread };
}
