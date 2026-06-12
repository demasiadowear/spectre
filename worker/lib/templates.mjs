// TEMPLATE MANAGER — accesso del worker a message_templates.
// Lettura LIVE dal DB a OGNI invio (zero cache): un salvataggio in
// /templates vale dal messaggio successivo. Template mancante o
// vuoto = errore esplicito, MAI testo di fallback hardcoded.
// Resolver gemello di lib/templates/registry.ts (tenere allineati).
import { db } from "./db.mjs";

/** Sostituisce i placeholder passati; {SALUTO} resta com'è:
 *  lo risolve sendToLead (applyGreeting) al momento dell'invio. */
export function renderTemplate(content, vars = {}) {
  let out = content;
  for (const [name, value] of Object.entries(vars)) {
    if (value === undefined || value === null) continue;
    out = out.replaceAll(`{${name}}`, String(value));
  }
  return out;
}

/** Contenuto live di un template; throw se mancante/vuoto. */
export async function getTemplateContent(key) {
  const res = await db.execute({
    sql: "SELECT content FROM message_templates WHERE key = ? LIMIT 1",
    args: [key],
  });
  const content = res.rows[0] ? String(res.rows[0].content ?? "") : "";
  if (!content.trim()) {
    throw new Error(
      `template "${key}" mancante o vuoto: compilalo in /templates`,
    );
  }
  return content;
}

/** Fetch + render in un colpo solo (uso tipico nel worker). */
export async function tpl(key, vars = {}) {
  return renderTemplate(await getTemplateContent(key), vars);
}
