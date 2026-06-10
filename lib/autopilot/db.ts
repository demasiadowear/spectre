import { turso } from "@/lib/turso";
import type {
  ApprovalStatus,
  AutopilotAlert,
  AutopilotBuild,
  AutopilotCounters,
  AutopilotLead,
  AutopilotSettings,
  AutopilotStage,
  AutopilotStats,
  AutopilotStudy,
  AutopilotTier,
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
    tier: str(r.tier) as AutopilotTier,
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
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
    name: str(r.name),
    company: str(r.company),
    phone: str(r.phone),
    rating: num(meta.rating),
    reviews: num(meta.reviews),
    address: str(meta.address),
  };
}

const PIPELINE_SELECT = `
  SELECT p.*, l.name, l.company, l.phone, l.meta
  FROM autopilot_pipeline p
  JOIN leads l ON l.id = p.lead_id`;

// ----- Settings ----------------------------------------------

export async function getSettings(): Promise<AutopilotSettings> {
  const defaults: AutopilotSettings = {
    kill_switch: false,
    warmup_started_at: null,
    warmup_daily_cap: 10,
    steady_daily_cap: 15,
    warmup_days: 14,
  };
  if (!turso) return defaults;
  const res = await turso.execute("SELECT key, value FROM autopilot_settings");
  const map = new Map(res.rows.map((r) => [str(r.key), str(r.value)]));
  return {
    kill_switch: map.get("kill_switch") === "1",
    warmup_started_at: map.get("warmup_started_at") || null,
    warmup_daily_cap: Number(map.get("warmup_daily_cap")) || defaults.warmup_daily_cap,
    steady_daily_cap: Number(map.get("steady_daily_cap")) || defaults.steady_daily_cap,
    warmup_days: Number(map.get("warmup_days")) || defaults.warmup_days,
  };
}

export async function setSetting(key: string, value: string): Promise<void> {
  if (!turso) return;
  await turso.execute({
    sql: `INSERT INTO autopilot_settings (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [key, value],
  });
}

/** Warm-up attivo: primi `warmup_days` giorni dal primo invio. */
export function isWarmupActive(settings: AutopilotSettings): boolean {
  if (!settings.warmup_started_at) return true; // mai partiti: prudenza
  const elapsed = Date.now() - new Date(settings.warmup_started_at).getTime();
  return elapsed < settings.warmup_days * 24 * 60 * 60 * 1000;
}

export function dailyCap(settings: AutopilotSettings): number {
  return isWarmupActive(settings)
    ? settings.warmup_daily_cap
    : settings.steady_daily_cap;
}

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
  tier: AutopilotTier;
  place_id: string;
  category: string;
  city: string;
}

export async function insertPipelineRow(row: NewPipelineRow): Promise<void> {
  if (!turso) return;
  await turso.execute({
    sql: `INSERT OR IGNORE INTO autopilot_pipeline
            (lead_id, stage, tier, place_id, category, city)
          VALUES (?, 'nuovo', ?, ?, ?, ?)`,
    args: [row.lead_id, row.tier, row.place_id, row.category, row.city],
  });
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

export async function updatePipeline(
  leadId: string,
  fields: Partial<{
    stage: AutopilotStage;
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
  }>,
): Promise<void> {
  if (!turso) return;
  const entries = Object.entries(fields);
  if (entries.length === 0) return;
  const setClause = entries.map(([k]) => `${k} = ?`).join(", ");
  await turso.execute({
    sql: `UPDATE autopilot_pipeline
          SET ${setClause}, updated_at = datetime('now')
          WHERE lead_id = ?`,
    args: [...entries.map(([, v]) => v as string | number), leadId],
  });
}

// ----- Coda approvazioni -------------------------------------

export async function getApprovalQueue(): Promise<AutopilotLead[]> {
  if (!turso) return [];
  const res = await turso.execute(
    `${PIPELINE_SELECT}
     WHERE p.stage = 'studiato' AND p.approval_status = 'pending'
     ORDER BY p.tier ASC, p.updated_at ASC`,
  );
  return res.rows.map((r) => rowToAutopilotLead(r as Row));
}

export async function approveMessage(
  leadId: string,
  editedMessage?: string,
): Promise<void> {
  const fields: Parameters<typeof updatePipeline>[1] = {
    approval_status: "approved",
    approved_at: new Date().toISOString(),
  };
  if (editedMessage && editedMessage.trim()) {
    fields.wa_first_message = editedMessage.trim();
  }
  await updatePipeline(leadId, fields);
}

export async function rejectMessage(leadId: string): Promise<void> {
  await updatePipeline(leadId, {
    approval_status: "rejected",
    stage: "archiviato",
    archived_reason: "messaggio rifiutato in review",
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

// ----- Builds ------------------------------------------------

function rowToBuild(r: Row): AutopilotBuild {
  return {
    id: str(r.id),
    lead_id: str(r.lead_id),
    status: str(r.status) as AutopilotBuild["status"],
    template: str(r.template),
    source: str(r.source),
    manifest_json: str(r.manifest_json),
    preview_url: str(r.preview_url),
    error: str(r.error),
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
  };
}

export async function getBuilds(): Promise<AutopilotBuild[]> {
  if (!turso) return [];
  const res = await turso.execute(
    "SELECT * FROM autopilot_builds ORDER BY created_at DESC LIMIT 100",
  );
  return res.rows.map((r) => rowToBuild(r as Row));
}

export async function createBuildTask(
  leadId: string,
  template: string,
  source: string,
): Promise<void> {
  if (!turso) return;
  await turso.execute({
    sql: `INSERT INTO autopilot_builds (id, lead_id, status, template, source)
          VALUES (?, ?, 'pending', ?, ?)`,
    args: [`build-${crypto.randomUUID()}`, leadId, template, source],
  });
}

/** Approvazione manuale di Puccio: il worker invierà il link demo. */
export async function approveBuild(buildId: string): Promise<void> {
  if (!turso) return;
  await turso.execute({
    sql: `UPDATE autopilot_builds
          SET status = 'approved', updated_at = datetime('now')
          WHERE id = ? AND status = 'deployed'`,
    args: [buildId],
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

// ----- Counters / stats --------------------------------------

/** Giorno corrente YYYY-MM-DD in Europe/Rome (i cap sono "per giornata italiana"). */
export function romeDay(date = new Date()): string {
  return date.toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
}

export async function getTodayCounters(): Promise<AutopilotCounters> {
  const day = romeDay();
  if (!turso) return { day, new_contacts: 0, messages_sent: 0 };
  const res = await turso.execute({
    sql: "SELECT * FROM autopilot_counters WHERE day = ? LIMIT 1",
    args: [day],
  });
  const r = res.rows[0] as Row | undefined;
  return {
    day,
    new_contacts: r ? num(r.new_contacts) : 0,
    messages_sent: r ? num(r.messages_sent) : 0,
  };
}

export async function getStats(): Promise<AutopilotStats> {
  const settings = await getSettings();
  const today = await getTodayCounters();
  const by_stage = Object.fromEntries(
    AUTOPILOT_STAGES.map((s) => [s, 0]),
  ) as Record<AutopilotStage, number>;
  let pending = 0;
  let unread = 0;
  if (turso) {
    const stages = await turso.execute(
      "SELECT stage, COUNT(*) AS n FROM autopilot_pipeline GROUP BY stage",
    );
    for (const r of stages.rows) {
      const stage = str(r.stage) as AutopilotStage;
      if (stage in by_stage) by_stage[stage] = num(r.n);
    }
    const p = await turso.execute(
      "SELECT COUNT(*) AS n FROM autopilot_pipeline WHERE stage = 'studiato' AND approval_status = 'pending'",
    );
    pending = num((p.rows[0] as Row).n);
    const a = await turso.execute(
      "SELECT COUNT(*) AS n FROM autopilot_alerts WHERE read = 0",
    );
    unread = num((a.rows[0] as Row).n);
  }
  return {
    by_stage,
    today,
    daily_cap: dailyCap(settings),
    warmup_active: isWarmupActive(settings),
    pending_approvals: pending,
    unread_alerts: unread,
    kill_switch: settings.kill_switch,
  };
}
