import type { EsitoFonte, MotivoBlocco } from "@/types/dossier";

// ============================================================
// Da un guasto a un esito operativo, e da li a un rimedio.
//
// LA DISTINZIONE CHE QUESTO MODULO ESISTE PER FARE.
//
// «Non ha funzionato» e tre cose diverse che si somigliano nei log:
//
//   transient_error   non ha risposto. Si riprova, e probabilmente
//                     la seconda volta va.
//   permanent_error   manca una configurazione, un'autorizzazione o
//                     una capacita. Riprovare non cambia niente
//                     finche qualcuno non tocca l'ambiente.
//   success_no_results  ha risposto, e la risposta e «non c'e».
//
// Il terzo non passa mai di qui: e un esito, non un guasto. Il primo
// diventa RETRY_REQUIRED, il secondo BLOCKED. Confonderli produce le
// due patologie opposte — un lead che ritenta all'infinito una chiave
// che non c'e, e un lead dichiarato NOT_FOUND perche un server ha
// impiegato un secondo di troppo.
//
// BLOCKED NON ENTRA NELLA REVISIONE UMANA. Non c'e niente da decidere
// guardando: c'e da aggiungere una credenziale o cambiare un modello.
// Mandarlo a una persona significa darle una coda di cose su cui non
// puo fare nulla, che e il modo in cui una coda smette di essere letta.
//
// NIENTE DI QUESTO MODULO RESTITUISCE IL TESTO DELL'ERRORE. Un
// messaggio di un provider contiene quasi sempre l'URL chiamato, e
// l'URL contiene la chiave in query. Qui si legge il testo per
// classificarlo e lo si butta: escono un enum e un enum.
// ============================================================

export interface Guasto {
  esito: EsitoFonte;
  /** Vuoto quando l'esito non e `permanent_error`. */
  blocco: MotivoBlocco;
}

export const RITENTABILE: Guasto = { esito: "transient_error", blocco: "" };

const bloccato = (blocco: MotivoBlocco): Guasto => ({ esito: "permanent_error", blocco });

/**
 * I segni, cercati nel testo del guasto. Sono frasi che i provider
 * scrivono davvero: `API key not valid`, `is not found for API version`,
 * `RESOURCE_EXHAUSTED`. Non si indovina, si riconosce.
 */
const SEGNI = {
  // Una credenziale assente o rifiutata. Non e un permesso negato su
  // una risorsa: e l'ambiente che non e configurato.
  configurazione: /(api[ _-]?key not valid|invalid api key|api key not found|api key expired|unauthenticated|missing credential|credential not found|no api key)/i,
  // Il modello o la capacita non esiste in questo progetto.
  modello: /(is not found for api version|not supported for|unsupported|no such model|unknown name|model not found|does not support)/i,
  // La policy del fornitore ha rifiutato la richiesta.
  policy: /(safety|blocked by|prohibited|policy|recitation|content filter|blocklist)/i,
  // Credito o quota finiti. Diverso da un rate limit: il primo non si
  // risolve aspettando, il secondo si.
  quota: /(billing|free tier|exceeded your current quota|quota exceeded|insufficient (credit|funds)|payment required)/i,
  // Il server c'era e non ha risposto in tempo, o non c'era affatto.
  transitorio: /(timeout|timed out|deadline|aborted|econnreset|etimedout|enotfound|socket hang up|network|fetch failed|unavailable|overloaded|try again)/i,
} as const;

/**
 * Dallo stato HTTP del provider all'esito operativo.
 *
 * Il corpo si legge SOLO per scegliere fra due letture dello stesso
 * stato — un 403 puo essere una chiave sbagliata o una policy, e sono
 * due rimedi opposti. Non viene restituito e non viene registrato.
 */
export function guastoDaHttp(status: number, corpo = ""): Guasto {
  const t = corpo || "";

  if (status === 401) return bloccato("configuration_missing");
  if (status === 403) {
    if (SEGNI.policy.test(t)) return bloccato("policy_restricted");
    return bloccato("configuration_missing");
  }
  if (status === 404) return bloccato("provider_unsupported");
  if (status === 400) {
    if (SEGNI.modello.test(t)) return bloccato("provider_unsupported");
    if (SEGNI.configurazione.test(t)) return bloccato("configuration_missing");
    if (SEGNI.policy.test(t)) return bloccato("policy_restricted");
    // Un 400 che non sappiamo leggere e un nostro difetto, non un
    // blocco dell'ambiente: non si dichiara BLOCKED per ignoranza.
    return RITENTABILE;
  }
  if (status === 402) return bloccato("quota_exhausted");
  if (status === 429) {
    // Un rate limit e transitorio; una quota finita no. Distinguerli
    // e la differenza fra aspettare trenta secondi e aspettare per
    // sempre.
    return SEGNI.quota.test(t) ? bloccato("quota_exhausted") : RITENTABILE;
  }
  if (status >= 500) return RITENTABILE;
  return RITENTABILE;
}

/** Nessuna credenziale in ambiente: e il caso in cui non si chiama
 *  nemmeno il provider, e si sa gia com'e andata. */
export function guastoDiConfigurazione(): Guasto {
  return bloccato("configuration_missing");
}

/**
 * Da un'eccezione qualunque all'esito operativo.
 *
 * In dubbio si sceglie `transient_error`. Sbagliare verso il ritentabile
 * costa una chiamata; sbagliare verso il blocco ferma un lead finche
 * qualcuno non se ne accorge — e nessuno se ne accorge.
 */
export function classificaGuasto(err: unknown): Guasto {
  const status = statusDa(err);
  const testo = testoDa(err);
  if (status > 0) return guastoDaHttp(status, testo);

  // Lo stato puo essere solo nel testo: gli SDK lo interpolano nel
  // messaggio invece di esporlo.
  const nelTesto = /\[(\d{3})[^\]]*\]|status[: ]+(\d{3})|\b(4\d{2}|5\d{2})\b/.exec(testo);
  const s = Number(nelTesto?.[1] ?? nelTesto?.[2] ?? nelTesto?.[3] ?? 0);
  if (s >= 400 && s < 600) return guastoDaHttp(s, testo);

  if (SEGNI.configurazione.test(testo)) return bloccato("configuration_missing");
  if (SEGNI.modello.test(testo)) return bloccato("provider_unsupported");
  if (SEGNI.quota.test(testo)) return bloccato("quota_exhausted");
  if (SEGNI.policy.test(testo)) return bloccato("policy_restricted");
  if (SEGNI.transitorio.test(testo)) return RITENTABILE;
  return RITENTABILE;
}

function statusDa(err: unknown): number {
  if (!err || typeof err !== "object") return 0;
  const o = err as Record<string, unknown>;
  for (const k of ["status", "statusCode", "code"]) {
    const v = Number(o[k]);
    if (Number.isInteger(v) && v >= 400 && v < 600) return v;
  }
  const r = o.response as Record<string, unknown> | undefined;
  if (r) {
    const v = Number(r.status);
    if (Number.isInteger(v) && v >= 400 && v < 600) return v;
  }
  return 0;
}

/** Il testo si usa e si butta. Non esce da questo modulo. */
function testoDa(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return `${err.name} ${err.message}`;
  if (err && typeof err === "object") {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

/** `permanent_error` significa che si e fermi finche non cambia
 *  l'ambiente. E la condizione che porta a BLOCKED, e l'unica. */
export function eBloccante(g: Guasto): boolean {
  return g.esito === "permanent_error";
}
