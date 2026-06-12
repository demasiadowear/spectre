import { isTursoConnected, turso } from "@/lib/turso";
import {
  TEMPLATE_KEYS,
  type MessageTemplate,
  type TemplateKey,
} from "./registry";

// ============================================================
// TEMPLATE MANAGER — accesso DB lato app (dashboard + Study).
// Lettura SEMPRE live da Turso, zero cache: un salvataggio da
// /templates vale subito ovunque. Il worker ha il suo accesso
// gemello in worker/lib/templates.mjs.
// ============================================================

function ensureDb() {
  if (!isTursoConnected() || !turso) {
    throw new Error("Turso non configurato: i template richiedono il DB.");
  }
  return turso;
}

function rowToTemplate(r: Record<string, unknown>): MessageTemplate {
  let variables: string[] = [];
  try {
    const parsed = JSON.parse(String(r.variables ?? "[]"));
    if (Array.isArray(parsed)) variables = parsed.map(String);
  } catch {
    /* variables corrotte: lista vuota, il template resta usabile */
  }
  return {
    key: String(r.key) as TemplateKey,
    label: String(r.label ?? r.key),
    content: String(r.content ?? ""),
    variables,
    updated_at: String(r.updated_at ?? ""),
  };
}

export async function listTemplates(): Promise<MessageTemplate[]> {
  const db = ensureDb();
  const res = await db.execute(
    "SELECT key, label, content, variables, updated_at FROM message_templates ORDER BY key",
  );
  return res.rows.map((r) => rowToTemplate(r as Record<string, unknown>));
}

/** Contenuto di un template. Manca o è vuoto = errore esplicito:
 *  niente fallback hardcoded, il testo vive SOLO nel DB. */
export async function getTemplateContent(key: TemplateKey): Promise<string> {
  const db = ensureDb();
  const res = await db.execute({
    sql: "SELECT content FROM message_templates WHERE key = ? LIMIT 1",
    args: [key],
  });
  const content = res.rows[0] ? String(res.rows[0].content ?? "") : "";
  if (!content.trim()) {
    throw new Error(
      `Template "${key}" mancante o vuoto: compilalo in /templates (o esegui scripts/setup-templates.mjs).`,
    );
  }
  return content;
}

export async function updateTemplateContent(
  key: string,
  content: string,
): Promise<void> {
  if (!TEMPLATE_KEYS.includes(key as TemplateKey)) {
    throw new Error(`Template key sconosciuta: ${key}`);
  }
  const db = ensureDb();
  const res = await db.execute({
    sql: `UPDATE message_templates
          SET content = ?, updated_at = datetime('now')
          WHERE key = ?`,
    args: [content, key],
  });
  if (res.rowsAffected === 0) {
    throw new Error(
      `Template "${key}" non trovato nel DB: esegui scripts/setup-templates.mjs.`,
    );
  }
}
