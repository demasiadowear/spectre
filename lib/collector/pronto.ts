// ============================================================
// Si puo lavorare, si o no.
//
// Una sola funzione, usata sia dalle rotte sia dalla dashboard, cosi
// non esistono due idee diverse di «pronto»: se il bottone e acceso,
// la rotta accetta; se e spento, la rotta rifiuta con lo stesso motivo
// scritto nello stesso modo.
//
// Il motivo e la parte che conta. «Non disponibile» costringe a
// indovinare; qui si dice quale condizione manca e in quale scope.
// ============================================================

import { authState } from "@/lib/auth-mode";
import { capabilities } from "./capability";
import { databasePronto, diagnosticaDatabase, type DiagnosiDatabase } from "./diagnostica";
import type { CapabilityReport } from "@/types/dossier";

export interface StatoOperativo {
  /** Tutte le condizioni per eseguire sono soddisfatte. */
  pronto: boolean;
  /** Perche non lo e. Vuoto quando lo e. */
  motivi: string[];
  capability: CapabilityReport;
  database: DiagnosiDatabase;
  auth_mode: string;
  scope: string;
}

export async function statoOperativo(
  env: NodeJS.ProcessEnv = process.env,
): Promise<StatoOperativo> {
  const auth = authState(env);
  const database = await diagnosticaDatabase(env);
  const capability = capabilities(env, database);

  const motivi: string[] = [];

  // L'autenticazione viene prima di tutto: senza, non c'e un operatore,
  // c'e chiunque abbia l'URL.
  if (auth.mode === "not_configured") {
    motivi.push(`Autenticazione non configurata in ${auth.scope}: mancano ${auth.missing.join(" e ")}. Nessuna azione e abilitata.`);
  }
  if (!databasePronto(database.stato)) {
    motivi.push(`Database: ${database.stato} — ${database.detail}`);
  }
  if (!capability.google_places_configured) {
    motivi.push(`GOOGLE_PLACES_API_KEY non configurata in ${auth.scope}: senza Places la raccolta non ha un'ancora.`);
  }

  return {
    pronto: motivi.length === 0,
    motivi,
    capability,
    database,
    auth_mode: auth.mode,
    scope: auth.scope,
  };
}
