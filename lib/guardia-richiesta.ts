// ============================================================
// Chi puo far mutare qualcosa, e da dove.
//
// La sessione dice CHI sei, non CHI HA SCRITTO la richiesta. Un sito
// ostile aperto nella stessa finestra puo far partire una POST verso
// Specter usando i cookie di sessione dell'operatore: la sessione e
// valida, la richiesta no. E il CSRF.
//
// Quattro controlli, e servono tutti:
//
//  1. METODO — una GET non muta mai niente. Un `<img src>` o un
//     prefetch bastano a scatenare una GET, quindi una rotta che muta
//     su GET e vulnerabile per costruzione.
//  2. CONTENT-TYPE application/json — un form HTML puo inviare solo
//     `form-urlencoded`, `multipart` o `text/plain`, e non puo
//     impostare altri Content-Type senza preflight CORS. Pretendere
//     JSON esclude il form cross-site, che e il vettore classico.
//  3. ORIGIN coerente con l'host — se c'e, deve essere il nostro.
//  4. ORIGIN assente — rifiutato sulle rotte di browser: i browser
//     moderni mandano `Origin` su tutte le richieste non-GET, quindi
//     la sua assenza significa che la richiesta non viene da una
//     pagina. Per i client non-browser esiste il bearer dei cron, che
//     passa da un'altra porta.
//
// Nessuno di questi quattro e sufficiente da solo, ed e il motivo per
// cui ci sono tutti.
// ============================================================

export type EsitoGuardia =
  | { ok: true }
  | { ok: false; status: 405 | 415 | 403; error: string };

const eLocale = (host: string): boolean =>
  /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);

/**
 * ORIGINI legittime, schema compreso.
 *
 * Confrontare solo l'host lascerebbe passare `http://` verso un host
 * servito in `https://`: stessa macchina, canale diverso, e una
 * richiesta in chiaro non ha le stesse garanzie di una cifrata. Qui si
 * confronta l'origine intera.
 *
 * Lo schema atteso viene da `x-forwarded-proto`, che e cio che il
 * proxy davanti all'applicazione dichiara; in mancanza, `https` per
 * tutto tranne localhost, dove lo sviluppo gira in chiaro.
 */
function origini(req: Request, env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (host) {
    const proto = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase()
      || (eLocale(host) ? "http" : "https");
    out.push(`${proto}://${host}`);
    // In locale si lavora indifferentemente su http, e capita di
    // aprire la dashboard da 127.0.0.1 invece che da localhost.
    if (eLocale(host)) out.push(`http://${host}`);
  }
  for (const v of [env.NEXTAUTH_URL, env.FACTORY_PUBLIC_URL, env.VERCEL_URL]) {
    if (!v) continue;
    try {
      out.push(new URL(v.startsWith("http") ? v : `https://${v}`).origin.toLowerCase());
    } catch { /* valore non interpretabile: si ignora */ }
  }
  return out;
}

export interface OpzioniGuardia {
  /** Metodi ammessi. Tutto il resto risponde 405. */
  metodi?: string[];
  /** false = accetta anche senza `Origin` (client non-browser). */
  richiediOrigin?: boolean;
  env?: NodeJS.ProcessEnv;
}

/**
 * Da applicare a ogni rotta che modifica qualcosa, PRIMA di leggere il
 * corpo: se la richiesta non deve essere accettata, non la si legge
 * nemmeno.
 */
export function guardiaRichiesta(
  req: Request,
  opts: OpzioniGuardia = {},
): EsitoGuardia {
  const env = opts.env ?? process.env;
  const metodi = opts.metodi ?? ["POST"];
  const metodo = req.method.toUpperCase();

  if (metodi.indexOf(metodo) === -1) {
    return { ok: false, status: 405, error: `metodo ${metodo} non ammesso: questa rotta modifica dati e accetta solo ${metodi.join(", ")}` };
  }

  const tipo = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (tipo !== "application/json") {
    return { ok: false, status: 415, error: "serve Content-Type application/json" };
  }

  const origin = req.headers.get("origin");
  if (!origin) {
    if (opts.richiediOrigin === false) return { ok: true };
    return { ok: false, status: 403, error: "richiesta senza Origin: le rotte operatore accettano solo richieste che arrivano da una pagina" };
  }

  let suo: string;
  try {
    suo = new URL(origin).origin.toLowerCase();
  } catch {
    return { ok: false, status: 403, error: "Origin non interpretabile" };
  }
  // `new URL("null")` non lancia in ogni runtime: l'origine opaca va
  // rifiutata esplicitamente.
  if (!suo || suo === "null") {
    return { ok: false, status: 403, error: "Origin opaca: richiesta rifiutata" };
  }

  const ammesse = origini(req, env);
  if (ammesse.indexOf(suo) === -1) {
    // Non si ripete l'Origin ricevuto nel messaggio: sarebbe riflettere
    // input di terzi dentro una risposta.
    return { ok: false, status: 403, error: "Origin esterno: richiesta rifiutata" };
  }

  return { ok: true };
}
