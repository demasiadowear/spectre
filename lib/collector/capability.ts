// ============================================================
// Che cosa questo runtime sa fare davvero.
//
// Serve perche il codice gira in un posto (Vercel) e viene scritto in un
// altro, e l'unico modo onesto di sapere se una chiave c'e e chiederlo
// al runtime che la possiede.
//
// REGOLA ASSOLUTA: da qui escono booleani e nomi di variabili. Mai un
// valore, mai un prefisso, mai una lunghezza, mai un hash. Un prefisso
// di quattro caratteri e gia un pezzo di segreto, e una lunghezza
// racconta quale servizio l'ha emessa.
// ============================================================

import { authState, ENV_AUTH_PASSWORD, ENV_AUTH_SECRET } from "@/lib/auth-mode";
import type { CapabilityReport } from "@/types/dossier";
import type { DiagnosiDatabase } from "./diagnostica";

/** Presenza, e basta. Il valore non esce da questa funzione. */
function configurata(env: NodeJS.ProcessEnv, nome: string): boolean {
  const v = env[nome];
  return typeof v === "string" && v.trim().length > 0;
}

/** Nome della variabile che alimenta le API Google. Non e una chiave
 *  "Places": il codice la usa anche per PageSpeed Insights, quindi e
 *  una chiave di progetto Google Cloud. */
export const ENV_GOOGLE = "GOOGLE_PLACES_API_KEY";
export const ENV_DB_URL = "TURSO_DATABASE_URL";
export const ENV_DB_TOKEN = "TURSO_AUTH_TOKEN";
/** Storage oggetti per i media. Non esiste ancora: vedi ADR-001. */
export const ENV_STORAGE = "MEDIA_STORAGE_URL";
/** Browser Playwright remoto: la fase successiva del collector. */
export const ENV_BROWSER = "BROWSER_WORKER_URL";

/**
 * `diagnosi` arriva da chi ha gia interrogato il database: qui non si
 * tocca la rete, cosi questa funzione resta pura e testabile. Senza
 * diagnosi si riporta solo cio che si sa dalle variabili, e
 * raggiungibilita e schema restano falsi — che e la verita, non un
 * ottimismo.
 */
export function capabilities(
  env: NodeJS.ProcessEnv = process.env,
  diagnosi?: DiagnosiDatabase,
): CapabilityReport {
  const auth = authState(env);
  const google = configurata(env, ENV_GOOGLE);
  const db = configurata(env, ENV_DB_URL) && configurata(env, ENV_DB_TOKEN);
  const storage = configurata(env, ENV_STORAGE);
  const browser = configurata(env, ENV_BROWSER);

  // Lo scope conta quanto il nome: una variabile presente in Production
  // e assente in Preview fa fallire il branch e non la produzione, e
  // senza questa riga si passerebbe un'ora a cercare il motivo.
  const scope = auth.scope;
  const missing: CapabilityReport["missing"] = [];
  for (const n of auth.missing) missing.push({ name: n, scope });
  if (!google) missing.push({ name: ENV_GOOGLE, scope });
  if (!configurata(env, ENV_DB_URL)) missing.push({ name: ENV_DB_URL, scope });
  if (!configurata(env, ENV_DB_TOKEN)) missing.push({ name: ENV_DB_TOKEN, scope });
  if (!storage) missing.push({ name: ENV_STORAGE, scope });
  if (!browser) missing.push({ name: ENV_BROWSER, scope });

  return {
    // `enforced` e l'unico stato in cui l'autenticazione protegge
    // qualcosa: `dev_open` e aperta per scelta, `not_configured` e
    // chiusa perche rotta, e nessuna delle due e "configurata".
    authentication_configured: auth.mode === "enforced",
    database_configured: db,
    database_reachable: diagnosi
      ? diagnosi.stato !== "database_not_configured" && diagnosi.stato !== "database_unreachable"
      : false,
    database_schema_present: diagnosi
      ? diagnosi.stato === "database_empty" || diagnosi.stato === "database_ready"
      : false,
    google_places_configured: google,
    storage_configured: storage,
    browser_worker_configured: browser,
    missing,
  };
}

export { ENV_AUTH_PASSWORD, ENV_AUTH_SECRET };

/** Quello che si puo fare senza una capacita, detto in italiano, per la
 *  dashboard. Nessuna capacita mancante deve produrre un errore opaco. */
export function spiegaCapacita(c: CapabilityReport): string[] {
  const note: string[] = [];
  if (!c.authentication_configured) {
    note.push(`Autenticazione non in vigore: servono ${ENV_AUTH_PASSWORD} e ${ENV_AUTH_SECRET}. Finche non ci sono, nessuna azione e abilitata.`);
  }
  if (!c.google_places_configured) {
    note.push(`${ENV_GOOGLE} non configurata in questo scope: senza, la fonte Places non parte e il dossier non ha un'ancora.`);
  }
  if (!c.database_configured) {
    note.push(`${ENV_DB_URL} o ${ENV_DB_TOKEN} non configurate: il dossier si produce ma non si salva.`);
  }
  if (!c.storage_configured) {
    note.push(`${ENV_STORAGE} non configurata: i media restano riferimenti, nessun byte viene conservato. E il comportamento previsto finche non esiste lo storage (ADR-001).`);
  }
  if (!c.browser_worker_configured) {
    note.push(`${ENV_BROWSER} non configurata: i profili che richiedono un browser vero restano 'browser_required' invece di essere dichiarati inesistenti.`);
  }
  return note;
}
