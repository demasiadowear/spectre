// ============================================================
// In che stato e il database, detto con precisione.
//
// «Nessun lead disponibile» univa quattro cause diverse che si
// sistemano in quattro modi diversi: variabili non configurate, host
// irraggiungibile, schema mai applicato, tabella vuota. Chi legge quel
// messaggio non sa quale delle quattro sia, e le prova tutte.
//
// Qui sono cinque stati distinti, ognuno con la sua azione.
// ============================================================

import { turso } from "@/lib/turso";
import { ENV_DB_TOKEN, ENV_DB_URL } from "./capability";

export type StatoDatabase =
  | "database_not_configured"
  | "database_unreachable"
  | "database_schema_missing"
  | "database_empty"
  | "database_ready";

export interface DiagnosiDatabase {
  stato: StatoDatabase;
  /** Cosa significa e cosa fare, in una riga. */
  detail: string;
  /** Nomi delle variabili mancanti. Nomi, mai valori. */
  missing: string[];
  /** Tabelle attese e non trovate. */
  tabelle_mancanti: string[];
  /** Quanti lead ci sono, quando si e potuto contarli. */
  lead: number;
  ms: number;
}

/** Tabelle senza le quali il collector non puo lavorare. */
const TABELLE_RICHIESTE = ["leads", "agent_jobs", "business_dossiers"];

const presente = (env: NodeJS.ProcessEnv, n: string): boolean =>
  typeof env[n] === "string" && (env[n] as string).trim().length > 0;

export async function diagnosticaDatabase(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DiagnosiDatabase> {
  const t0 = Date.now();
  const base: DiagnosiDatabase = {
    stato: "database_not_configured", detail: "", missing: [],
    tabelle_mancanti: [], lead: 0, ms: 0,
  };

  const missing: string[] = [];
  if (!presente(env, ENV_DB_URL)) missing.push(ENV_DB_URL);
  if (!presente(env, ENV_DB_TOKEN)) missing.push(ENV_DB_TOKEN);
  if (missing.length || !turso) {
    return {
      ...base,
      missing,
      detail: missing.length
        ? `mancano ${missing.join(" e ")} in questo scope: il client non viene nemmeno costruito`
        : "client non inizializzato benche le variabili risultino presenti",
      ms: Date.now() - t0,
    };
  }

  // Raggiungibilita: una query banale, che non dipende da nessuna
  // tabella. Se fallisce qui, il problema e la connessione.
  try {
    await turso.execute("select 1");
  } catch (e) {
    return {
      ...base,
      stato: "database_unreachable",
      detail: `il database non risponde: ${(e as Error).message.slice(0, 160)}`,
      ms: Date.now() - t0,
    };
  }

  // Schema: si chiede a sqlite_master, senza toccare le tabelle.
  let presenti: string[] = [];
  try {
    const rs = await turso.execute(
      "select name from sqlite_master where type = 'table'",
    );
    presenti = rs.rows.map((r) => String((r as Record<string, unknown>).name));
  } catch (e) {
    return {
      ...base,
      stato: "database_unreachable",
      detail: `connesso ma non interrogabile: ${(e as Error).message.slice(0, 160)}`,
      ms: Date.now() - t0,
    };
  }

  const mancanti = TABELLE_RICHIESTE.filter((t) => presenti.indexOf(t) === -1);
  if (mancanti.length) {
    return {
      ...base,
      stato: "database_schema_missing",
      tabelle_mancanti: mancanti,
      detail: `connesso, ma mancano le tabelle ${mancanti.join(", ")}: lo schema non e stato applicato in questo database`,
      ms: Date.now() - t0,
    };
  }

  let lead = 0;
  try {
    const rs = await turso.execute("select count(*) as n from leads");
    lead = Number((rs.rows[0] as Record<string, unknown>)?.n ?? 0);
  } catch (e) {
    return {
      ...base,
      stato: "database_unreachable",
      detail: `schema presente ma la lettura fallisce: ${(e as Error).message.slice(0, 160)}`,
      ms: Date.now() - t0,
    };
  }

  if (lead === 0) {
    return {
      ...base,
      stato: "database_empty",
      detail: "connesso, schema presente, ma la tabella dei lead e vuota: non c'e niente su cui raccogliere",
      lead: 0,
      ms: Date.now() - t0,
    };
  }

  return {
    ...base,
    stato: "database_ready",
    detail: `${lead} lead disponibili`,
    lead,
    ms: Date.now() - t0,
  };
}

/** Il database e in uno stato in cui si puo lavorare? */
export function databasePronto(s: StatoDatabase): boolean {
  return s === "database_ready";
}
