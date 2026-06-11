import { turso } from "@/lib/turso";
import type {
  DetectiveAnalysis,
  DetectiveCase,
  DetectiveLoss,
  DetectiveRawData,
  DetectiveScores,
  DetectiveStatus,
} from "@/types/detective";

// ============================================================
// Detective data access (Turso). Stesso contratto dell'autopilot:
// senza Turso le letture tornano vuote, le scritture sono no-op.
// ============================================================

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? "" : String(v));

export const DETECTIVE_STATUSES: DetectiveStatus[] = [
  "scouted",
  "investigated",
  "report_ready",
  "sent",
  "interested",
  "pilot",
  "archived",
];

function parseJson<T>(raw: unknown, fallback: T): T {
  try {
    const parsed = JSON.parse(str(raw) || "null");
    return parsed == null ||
      (typeof parsed === "object" && Object.keys(parsed).length === 0 && !Array.isArray(parsed))
      ? fallback
      : (parsed as T);
  } catch {
    return fallback;
  }
}

function rowToCase(r: Row): DetectiveCase {
  return {
    id: str(r.id),
    place_id: str(r.place_id),
    business_name: str(r.business_name),
    website_url: str(r.website_url),
    phone: str(r.phone),
    city: str(r.city),
    category: str(r.category),
    raw_data: parseJson<DetectiveRawData | null>(r.raw_data, null),
    scores: parseJson<DetectiveScores | null>(r.scores, null),
    losses: parseJson<DetectiveLoss[]>(r.losses, []),
    analysis: parseJson<DetectiveAnalysis | null>(r.analysis, null),
    report_slug: str(r.report_slug),
    status: str(r.status) as DetectiveStatus,
    wa_message: str(r.wa_message),
    error: str(r.error),
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
  };
}

/** Slug URL-safe non indovinabile (~95 bit), senza dipendenze nuove. */
export function generateSlug(): string {
  const alphabet =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

// ----- CRUD ---------------------------------------------------

export async function getCases(status?: DetectiveStatus): Promise<DetectiveCase[]> {
  if (!turso) return [];
  const res = status
    ? await turso.execute({
        sql: "SELECT * FROM detective_cases WHERE status = ? ORDER BY updated_at DESC",
        args: [status],
      })
    : await turso.execute(
        "SELECT * FROM detective_cases ORDER BY updated_at DESC LIMIT 300",
      );
  return res.rows.map((r) => rowToCase(r as Row));
}

export async function getCaseById(id: string): Promise<DetectiveCase | null> {
  if (!turso) return null;
  const res = await turso.execute({
    sql: "SELECT * FROM detective_cases WHERE id = ? LIMIT 1",
    args: [id],
  });
  return res.rows[0] ? rowToCase(res.rows[0] as Row) : null;
}

/** Lettura pubblica del report: SOLO per slug, solo casi con report. */
export async function getCaseBySlug(slug: string): Promise<DetectiveCase | null> {
  if (!turso || !slug) return null;
  const res = await turso.execute({
    sql: `SELECT * FROM detective_cases
          WHERE report_slug = ?
            AND status IN ('report_ready', 'sent', 'interested', 'pilot')
          LIMIT 1`,
    args: [slug],
  });
  return res.rows[0] ? rowToCase(res.rows[0] as Row) : null;
}

export interface NewCase {
  place_id: string;
  business_name: string;
  website_url: string;
  phone: string;
  city: string;
  category: string;
}

export async function insertCase(input: NewCase): Promise<string> {
  if (!turso) throw new Error("Turso non configurato.");
  const id = `det-${crypto.randomUUID()}`;
  await turso.execute({
    sql: `INSERT OR IGNORE INTO detective_cases
            (id, place_id, business_name, website_url, phone, city, category, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'scouted')`,
    args: [
      id,
      input.place_id,
      input.business_name,
      input.website_url,
      input.phone,
      input.city,
      input.category,
    ],
  });
  return id;
}

export async function updateCase(
  id: string,
  fields: Partial<{
    raw_data: string;
    scores: string;
    losses: string;
    analysis: string;
    report_slug: string;
    status: DetectiveStatus;
    wa_message: string;
    error: string;
  }>,
): Promise<void> {
  if (!turso) return;
  const entries = Object.entries(fields);
  if (entries.length === 0) return;
  const setClause = entries.map(([k]) => `${k} = ?`).join(", ");
  await turso.execute({
    sql: `UPDATE detective_cases SET ${setClause}, updated_at = datetime('now')
          WHERE id = ?`,
    args: [...entries.map(([, v]) => v as string), id],
  });
}

// ----- Dedup contro TUTTO il DB SPECTER ------------------------

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("39") ? digits.slice(2) : digits;
}

export interface DedupIndex {
  placeIds: Set<string>;
  phones: Set<string>;
  names: Set<string>;
}

/**
 * Indice di dedup obbligatoria pre-indagine: place_id (autopilot +
 * detective) e nome+telefono di QUALSIASI lead in SPECTER, qualunque
 * funnel/stato — chi è già stato contattato (es. AYROSUMMER26) sta
 * nel DB e viene escluso a monte.
 */
export async function buildDedupIndex(): Promise<DedupIndex> {
  const index: DedupIndex = {
    placeIds: new Set(),
    phones: new Set(),
    names: new Set(),
  };
  if (!turso) return index;

  const [apIds, detRows, leads] = await Promise.all([
    turso.execute(
      "SELECT place_id FROM autopilot_pipeline WHERE place_id IS NOT NULL",
    ),
    turso.execute(
      "SELECT place_id, business_name, phone FROM detective_cases",
    ),
    turso.execute("SELECT name, company, phone FROM leads"),
  ]);

  for (const r of apIds.rows) {
    const id = str((r as Row).place_id);
    if (id) index.placeIds.add(id);
  }
  for (const r of detRows.rows) {
    const row = r as Row;
    const id = str(row.place_id);
    if (id) index.placeIds.add(id);
    const phone = normalizePhone(str(row.phone));
    if (phone) index.phones.add(phone);
    const name = str(row.business_name).toLowerCase().trim();
    if (name) index.names.add(name);
  }
  for (const r of leads.rows) {
    const row = r as Row;
    const phone = normalizePhone(str(row.phone));
    if (phone) index.phones.add(phone);
    for (const key of ["name", "company"] as const) {
      const name = str(row[key]).toLowerCase().trim();
      if (name) index.names.add(name);
    }
  }
  return index;
}

export function isDuplicate(
  index: DedupIndex,
  candidate: { place_id: string; name: string; phone: string },
): boolean {
  if (candidate.place_id && index.placeIds.has(candidate.place_id)) return true;
  const phone = normalizePhone(candidate.phone);
  if (phone && index.phones.has(phone)) return true;
  // Nome esatto: in v1 meglio un'esclusione in più che indagare due
  // volte la stessa attività già contattata con altro place_id.
  const name = candidate.name.toLowerCase().trim();
  if (name && index.names.has(name)) return true;
  return false;
}
