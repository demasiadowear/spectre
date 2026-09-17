// ============================================================
// In che modalita gira l'autenticazione. Deciso qui, una volta sola.
//
// La regola precedente era `AUTH_DISABLED = !SPECTRE_PASSWORD`: senza
// password l'applicazione girava aperta, ovunque, Vercel compreso. Su
// un URL pubblico e un fail-open, non una comodita di sviluppo.
//
// Qui si inverte il difetto: la modalita aperta e un caso da chiedere
// esplicitamente, e tutto il resto senza segreti e un errore che
// CHIUDE. La differenza sta nel `default` di questa funzione: se non si
// riconosce l'ambiente, non si apre.
//
// Nessun accesso alla rete, nessun side effect: prende un oggetto env e
// restituisce una decisione, cosi si testa senza far girare niente.
// ============================================================

export type AuthMode =
  /** Segreti presenti: sessione obbligatoria. */
  | "enforced"
  /** Sviluppo locale, aperto, chiesto esplicitamente. */
  | "dev_open"
  /** Segreti mancanti dove servono: si chiude e si dichiara. */
  | "not_configured";

export interface AuthState {
  mode: AuthMode;
  /** Vero solo in `dev_open`. Non deriva mai dall'assenza di una env. */
  open: boolean;
  /** Perche siamo in questa modalita, in una riga. */
  reason: string;
  /** Nomi delle variabili che mancano. Nomi, mai valori. */
  missing: string[];
  /** Dove stiamo girando, per il messaggio d'errore. */
  scope: string;
}

export const ENV_AUTH_PASSWORD = "SPECTRE_PASSWORD";
export const ENV_AUTH_SECRET = "NEXTAUTH_SECRET";
export const ENV_AUTH_USER = "SPECTRE_USER";
export const ENV_ALLOW_DEV = "ALLOW_DEV_NO_AUTH";

const presente = (env: NodeJS.ProcessEnv, n: string): boolean =>
  typeof env[n] === "string" && (env[n] as string).trim().length > 0;

/** Girando su Vercel? Il runtime lo dichiara, e non solo con `VERCEL`. */
export function suVercel(env: NodeJS.ProcessEnv): boolean {
  return presente(env, "VERCEL")
    || presente(env, "VERCEL_ENV")
    || presente(env, "VERCEL_URL")
    || presente(env, "NEXT_PUBLIC_VERCEL_ENV");
}

export function scopeDi(env: NodeJS.ProcessEnv): string {
  if (presente(env, "VERCEL_ENV")) return `vercel:${env.VERCEL_ENV}`;
  if (suVercel(env)) return "vercel";
  return env.NODE_ENV === "production" ? "produzione" : "locale";
}

/**
 * La decisione.
 *
 * La modalita aperta richiede TUTTE e quattro le condizioni, e la prima
 * e un'opt-in esplicita: `ALLOW_DEV_NO_AUTH=1`. Non basta essere in
 * locale, e non basta che manchi la password — che era esattamente il
 * difetto.
 */
export function authState(env: NodeJS.ProcessEnv = process.env): AuthState {
  const scope = scopeDi(env);
  const vercel = suVercel(env);
  const produzione = env.NODE_ENV === "production";
  const password = presente(env, ENV_AUTH_PASSWORD);
  // Il segreto di firma non ha piu un valore di ripiego: con un
  // fallback fisso, e il repository pubblico, chiunque puo firmarsi un
  // token valido. Qui deve essere configurato o non si parte.
  const segreto = presente(env, ENV_AUTH_SECRET);

  const missing: string[] = [];
  if (!password) missing.push(ENV_AUTH_PASSWORD);
  if (!segreto) missing.push(ENV_AUTH_SECRET);

  if (password && segreto) {
    return { mode: "enforced", open: false, reason: "segreti presenti: sessione obbligatoria", missing: [], scope };
  }

  const optIn = (env[ENV_ALLOW_DEV] ?? "").trim() === "1";
  if (optIn && !produzione && !vercel) {
    return {
      mode: "dev_open",
      open: true,
      reason: `${ENV_ALLOW_DEV}=1 in ambiente locale non di produzione`,
      missing,
      scope,
    };
  }

  // Tutto il resto chiude, e dice quale condizione e mancata.
  const perche = vercel
    ? "l'applicazione gira su Vercel: la modalita aperta non e ammessa"
    : produzione
      ? "NODE_ENV=production: la modalita aperta non e ammessa"
      : `${ENV_ALLOW_DEV} non impostata a 1`;

  return {
    mode: "not_configured",
    open: false,
    reason: `autenticazione non configurata (${missing.join(", ")}) e ${perche}`,
    missing,
    scope,
  };
}

/** Corpo della risposta quando si chiude. Nomi di variabili, mai valori. */
export function corpo503(s: AuthState): {
  error: "authentication_not_configured";
  reason: string;
  missing: string[];
  scope: string;
} {
  return {
    error: "authentication_not_configured",
    reason: s.reason,
    missing: s.missing,
    scope: s.scope,
  };
}
