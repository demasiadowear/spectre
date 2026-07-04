import { turso } from "@/lib/turso";
import type {
  IntentLead,
  IntentPlatform,
  IntentStage,
  IntentStats,
} from "@/types/intent";
import { INTENT_STAGES } from "./constants";

// ============================================================
// Intent Scout data access (Turso). Come lib/autopilot/db.ts:
// senza Turso le letture tornano vuote e le scritture sono no-op.
// ============================================================

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? "" : String(v));
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

function rowToIntentLead(r: Row): IntentLead {
  return {
    lead_id: str(r.lead_id),
    stage: str(r.stage) as IntentStage,
    platform: str(r.platform) as IntentPlatform,
    source_url: str(r.source_url),
    title: str(r.title),
    body: str(r.body),
    category: str(r.category),
    zone: str(r.zone),
    budget: str(r.budget),
    published_at: str(r.published_at),
    score: num(r.score),
    hook: str(r.hook),
    notified: num(r.notified) === 1,
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
    name: str(r.name),
    company: str(r.company),
    phone: str(r.phone),
    email: str(r.email),
  };
}

const INTENT_SELECT = `
  SELECT p.*, l.name, l.company, l.phone, l.email
  FROM intent_pipeline p
  JOIN leads l ON l.id = p.lead_id`;

export async function getIntentPipeline(): Promise<IntentLead[]> {
  if (!turso) return [];
  const res = await turso.execute(
    `${INTENT_SELECT} ORDER BY p.score DESC, p.updated_at DESC`,
  );
  return res.rows.map((r) => rowToIntentLead(r as Row));
}

// ----- Dedup --------------------------------------------------

/** URL annuncio già in pipeline (dedup primario). */
export async function knownIntentUrls(): Promise<Set<string>> {
  if (!turso) return new Set();
  const res = await turso.execute(
    "SELECT source_url FROM intent_pipeline WHERE source_url IS NOT NULL",
  );
  return new Set(res.rows.map((r) => str(r.source_url)).filter(Boolean));
}

/** Chiave contenuto piattaforma+titolo normalizzato: para il caso di
 *  URL diverso per lo stesso annuncio (repost, tracking param). */
export function intentKey(platform: string, title: string): string {
  return `${platform}|${title.toLowerCase().replace(/[^a-z0-9à-ù]+/g, " ").trim()}`;
}

export async function knownIntentKeys(): Promise<Set<string>> {
  if (!turso) return new Set();
  const res = await turso.execute(
    "SELECT platform, title FROM intent_pipeline",
  );
  return new Set(
    res.rows.map((r) => intentKey(str(r.platform), str(r.title))),
  );
}

// ----- Insert / update ----------------------------------------

export interface NewIntentRow {
  lead_id: string;
  platform: IntentPlatform;
  source_url: string;
  title: string;
  body: string;
  category: string;
  zone: string;
  budget: string;
  published_at: string;
  score: number;
}

/** True se la riga è stata davvero inserita. False = collisione sul
 *  vincolo UNIQUE di source_url (es. run sovrapposte): il chiamante
 *  deve rimuovere il lead orfano appena creato e trattarla da duplicato. */
export async function insertIntentRow(row: NewIntentRow): Promise<boolean> {
  if (!turso) return false;
  const res = await turso.execute({
    sql: `INSERT OR IGNORE INTO intent_pipeline
            (lead_id, stage, platform, source_url, title, body, category,
             zone, budget, published_at, score)
          VALUES (?, 'intent_found', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.lead_id,
      row.platform,
      row.source_url,
      row.title,
      row.body,
      row.category,
      row.zone,
      row.budget,
      row.published_at || null,
      row.score,
    ],
  });
  return res.rowsAffected > 0;
}

/** Rimuove un lead rimasto orfano (insert intent_pipeline perso per
 *  race con una run sovrapposta): non deve sporcare il CRM. */
export async function deleteOrphanLead(leadId: string): Promise<void> {
  if (!turso) return;
  await turso.execute({
    sql: "DELETE FROM leads WHERE id = ?",
    args: [leadId],
  });
}

/** Righe senza gancio (run precedente morta prima dello Study):
 *  backfill bounded a inizio run. */
export async function getIntentLeadsMissingHook(
  limit = 10,
): Promise<IntentLead[]> {
  if (!turso) return [];
  const res = await turso.execute({
    sql: `${INTENT_SELECT} WHERE p.hook = '' ORDER BY p.created_at DESC LIMIT ?`,
    args: [limit],
  });
  return res.rows.map((r) => rowToIntentLead(r as Row));
}

export async function setIntentHook(
  leadId: string,
  hook: string,
): Promise<void> {
  if (!turso) return;
  await turso.execute({
    sql: `UPDATE intent_pipeline
          SET hook = ?, updated_at = datetime('now') WHERE lead_id = ?`,
    args: [hook, leadId],
  });
}

export async function markIntentNotified(leadId: string): Promise<void> {
  if (!turso) return;
  await turso.execute({
    sql: `UPDATE intent_pipeline
          SET notified = 1, updated_at = datetime('now') WHERE lead_id = ?`,
    args: [leadId],
  });
}

/** Cambio colonna dal kanban. Stage whitelisted a runtime.
 *  True solo se una riga è stata davvero aggiornata: il client usa il
 *  false per fare rollback dell'update ottimistico. */
export async function updateIntentStage(
  leadId: string,
  stage: IntentStage,
): Promise<boolean> {
  if (!turso) return false;
  if (!INTENT_STAGES.includes(stage)) return false;
  const res = await turso.execute({
    sql: `UPDATE intent_pipeline
          SET stage = ?, updated_at = datetime('now') WHERE lead_id = ?`,
    args: [stage, leadId],
  });
  return res.rowsAffected > 0;
}

// ----- Stats --------------------------------------------------

export async function getIntentStats(): Promise<IntentStats> {
  const by_stage = Object.fromEntries(
    INTENT_STAGES.map((s) => [s, 0]),
  ) as Record<IntentStage, number>;
  if (turso) {
    const res = await turso.execute(
      "SELECT stage, COUNT(*) AS n FROM intent_pipeline GROUP BY stage",
    );
    for (const r of res.rows) {
      const stage = str(r.stage) as IntentStage;
      if (stage in by_stage) by_stage[stage] = num(r.n);
    }
  }
  return { by_stage };
}
