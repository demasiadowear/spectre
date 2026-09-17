// ============================================================
// Come il collector guarda una pagina.
//
// Dentro una Vercel Function non si installa Chromium alla cieca: pesa
// centinaia di megabyte, fa sforare il limite del bundle e allunga il
// cold start di ogni rotta del progetto, incluse quelle che col
// collector non c'entrano niente.
//
// Quindi due implementazioni dietro una sola interfaccia:
//
//  - DirectHtmlProvider — `fetch` piu parsing. Basta per la stragrande
//    maggioranza dei siti di attivita locali, che sono HTML servito dal
//    server. E quello che si usa ora.
//
//  - RemoteBrowserProvider — contratto verso un browser Playwright che
//    gira ALTROVE. Serve per i siti che si disegnano in JavaScript e
//    per i profili social, che senza browser non si leggono.
//
// La regola che conta: quando serve un browser vero e non c'e, si
// registra `browser_required`. NON si dichiara che il profilo non
// esiste, e non si inventa niente. «Non ho potuto guardare» e
// un'informazione; «non c'e» detto senza aver guardato e una bugia che
// finisce dentro un dossier.
//
// Il provider remoto e anche il motivo per cui il collector potra
// funzionare dal telefono a PC spento: il browser non sta nel telefono
// e non sta nella function, sta in un servizio che risponde sempre.
// ============================================================

import { fetchSicuro, LIMITI, type SsrfRejection } from "./ssrf";

export type EsitoPagina =
  | "ok"
  | "browser_required"
  | "blocked"
  | "not_found"
  | "error";

export interface PaginaRaccolta {
  url: string;
  /** URL finale dopo i redirect. */
  final_url: string;
  esito: EsitoPagina;
  status: number;
  html: string;
  /** Perche non si e potuto leggere, quando non si e potuto. */
  detail: string;
  /** Il tipo di rifiuto della guardia SSRF, se e stata lei a fermarsi. */
  ssrf: SsrfRejection | "";
  ms: number;
}

export interface BrowserWorkerProvider {
  readonly nome: string;
  /** true = puo eseguire JavaScript e quindi leggere pagine dinamiche. */
  readonly esegueJavaScript: boolean;
  apri(url: string): Promise<PaginaRaccolta>;
}

/** Host che senza un browser vero non restituiscono contenuto utile:
 *  rispondono con uno scheletro e un muro di login. Elencarli serve a
 *  distinguere «non leggibile senza browser» da «non esiste». */
const RICHIEDONO_BROWSER = [
  "instagram.com", "facebook.com", "fb.com", "tiktok.com",
  "linkedin.com", "x.com", "twitter.com", "threads.net",
];

export function richiedeBrowser(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return RICHIEDONO_BROWSER.some((d) => h === d || h.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/** Segnali che una pagina e uno scheletro riempito da JavaScript: poco
 *  testo e molti script. Non e una certezza, ed e per questo che
 *  produce `browser_required` e non un verdetto. */
export function sembraRenderizzataDaJs(html: string): boolean {
  if (!html) return true;
  const senzaScript = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  const testo = senzaScript.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const script = (html.match(/<script/gi) ?? []).length;
  return testo.length < 350 && script >= 3;
}

/** Il provider di oggi: HTTP e parsing, nessun browser. */
export class DirectHtmlProvider implements BrowserWorkerProvider {
  readonly nome = "DirectHtmlProvider";
  readonly esegueJavaScript = false;

  constructor(private readonly maxBytes = LIMITI.maxBytes) {}

  async apri(url: string): Promise<PaginaRaccolta> {
    const base: PaginaRaccolta = {
      url, final_url: url, esito: "error", status: 0,
      html: "", detail: "", ssrf: "", ms: 0,
    };

    // Le piattaforme social si dichiarano subito: scaricarne l'HTML
    // produrrebbe uno scheletro, e leggere uno scheletro come «profilo
    // vuoto» sarebbe peggio che non leggerlo.
    if (richiedeBrowser(url)) {
      return { ...base, esito: "browser_required",
        detail: "piattaforma che senza un browser vero non restituisce contenuto: serve RemoteBrowserProvider" };
    }

    const r = await fetchSicuro(url, { maxBytes: this.maxBytes });
    base.ms = r.ms;
    base.status = r.status;
    base.final_url = r.url;

    if (r.reason) {
      return { ...base, esito: "blocked", ssrf: r.reason, detail: r.detail };
    }
    if (r.status === 404 || r.status === 410) {
      return { ...base, esito: "not_found", detail: `HTTP ${r.status}` };
    }
    if (!r.ok) {
      // 401/403 su un sito normale: c'e un muro, non un'assenza.
      const muro = r.status === 401 || r.status === 403 || r.status === 429;
      return { ...base, esito: muro ? "blocked" : "error", detail: `HTTP ${r.status}` };
    }
    if (!/text\/html|application\/xhtml/i.test(r.contentType)) {
      return { ...base, esito: "error", detail: `tipo non HTML: ${r.contentType || "sconosciuto"}` };
    }
    if (sembraRenderizzataDaJs(r.body)) {
      return { ...base, esito: "browser_required", html: r.body,
        detail: "pagina quasi priva di testo e piena di script: probabilmente disegnata in JavaScript" };
    }
    return { ...base, esito: "ok", html: r.body, detail: "" };
  }
}

/** Configurazione del browser remoto. Non c'e ancora un servizio
 *  dall'altra parte: il contratto serve perche il collector sia gia
 *  scritto per usarlo, e perche il giorno che esiste non si debba
 *  toccare nient'altro. */
export interface RemoteBrowserConfig {
  /** Endpoint del servizio. Da `BROWSER_WORKER_URL`. */
  endpoint: string;
  /** Token del servizio. Non viene mai registrato ne restituito. */
  token: string;
  timeoutMs: number;
}

/**
 * Contratto verso un browser Playwright remoto.
 *
 * Il servizio riceve `{url}` e restituisce `{status, html, final_url}`.
 * Deliberatamente povero: tutto il ragionamento sta qui dentro, di la
 * sta solo un browser che apre una pagina e restituisce quello che
 * vede. Cosi il servizio si puo sostituire senza toccare il collector.
 *
 * Finche `BROWSER_WORKER_URL` non e configurata, `apri()` non fallisce:
 * restituisce `browser_required`, che e la verita.
 */
export class RemoteBrowserProvider implements BrowserWorkerProvider {
  readonly nome = "RemoteBrowserProvider";
  readonly esegueJavaScript = true;

  constructor(private readonly cfg: RemoteBrowserConfig | null) {}

  static daEnv(env: NodeJS.ProcessEnv = process.env): RemoteBrowserProvider {
    const endpoint = (env.BROWSER_WORKER_URL ?? "").trim();
    if (!endpoint) return new RemoteBrowserProvider(null);
    return new RemoteBrowserProvider({
      endpoint,
      token: (env.BROWSER_WORKER_TOKEN ?? "").trim(),
      timeoutMs: 30_000,
    });
  }

  get configurato(): boolean {
    return this.cfg !== null;
  }

  async apri(url: string): Promise<PaginaRaccolta> {
    const base: PaginaRaccolta = {
      url, final_url: url, esito: "error", status: 0,
      html: "", detail: "", ssrf: "", ms: 0,
    };
    if (!this.cfg) {
      return { ...base, esito: "browser_required",
        detail: "BROWSER_WORKER_URL non configurata: nessun browser remoto a cui chiedere" };
    }

    // L'URL da aprire va comunque validato: il browser remoto e dentro
    // un'altra rete, e mandarcelo contro sarebbe lo stesso problema di
    // SSRF spostato di un chilometro.
    const { controlloUrl } = await import("./ssrf");
    const v = await controlloUrl(url);
    if (!v.ok) return { ...base, esito: "blocked", ssrf: v.reason, detail: v.detail };

    const t0 = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(this.cfg.endpoint, {
        method: "POST",
        signal: ac.signal,
        headers: {
          "Content-Type": "application/json",
          ...(this.cfg.token ? { Authorization: `Bearer ${this.cfg.token}` } : {}),
        },
        body: JSON.stringify({ url, wait: "networkidle" }),
      });
      clearTimeout(timer);
      base.ms = Date.now() - t0;
      if (!res.ok) {
        return { ...base, esito: "error", status: res.status, detail: `browser remoto HTTP ${res.status}` };
      }
      const j = (await res.json()) as Record<string, unknown>;
      return {
        ...base,
        esito: "ok",
        status: typeof j.status === "number" ? j.status : 200,
        html: typeof j.html === "string" ? j.html : "",
        final_url: typeof j.final_url === "string" ? j.final_url : url,
        ms: Date.now() - t0,
      };
    } catch (e) {
      clearTimeout(timer);
      const abortito = (e as Error).name === "AbortError";
      return { ...base, esito: "error", ms: Date.now() - t0,
        detail: abortito ? "timeout del browser remoto" : (e as Error).message };
    }
  }
}

/**
 * Prova prima senza browser; passa al remoto solo quando serve e solo
 * se esiste. L'ordine non e un'ottimizzazione: e il modo di non pagare
 * un browser per leggere una pagina che e gia HTML.
 */
export class ProviderCombinato implements BrowserWorkerProvider {
  readonly nome = "ProviderCombinato";
  constructor(
    private readonly diretto: BrowserWorkerProvider,
    private readonly remoto: RemoteBrowserProvider,
  ) {}

  get esegueJavaScript(): boolean {
    return this.remoto.configurato;
  }

  async apri(url: string): Promise<PaginaRaccolta> {
    const primo = await this.diretto.apri(url);
    if (primo.esito !== "browser_required") return primo;
    if (!this.remoto.configurato) return primo;
    const secondo = await this.remoto.apri(url);
    // Se anche il remoto non ce la fa, resta `browser_required`: non si
    // degrada a «non esiste».
    return secondo.esito === "ok" ? secondo : { ...secondo, esito: "browser_required" };
  }
}

export function providerPredefinito(env: NodeJS.ProcessEnv = process.env): BrowserWorkerProvider {
  return new ProviderCombinato(new DirectHtmlProvider(), RemoteBrowserProvider.daEnv(env));
}
