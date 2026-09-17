import type {
  OpportunityReason,
  WebsiteAnalysis,
  WebsiteStatus,
} from "@/types/factory";

// ============================================================
// Analisi del sito esistente → punteggio di OPPORTUNITÀ 0-100.
//
// Alto = vale la pena proporre un sito nuovo. Ogni punto ha una
// `reason` con codice, etichetta e valore MISURATO: il punteggio
// non è mai un numero opaco sputato da un modello, è la somma di
// controlli verificabili. Nessuna AI qui dentro: solo HTTP e HTML.
//
// La rete sta in fetchSite(); il punteggio in scoreWebsite() su una
// struttura pura, così è testabile senza uscire dal processo.
// ============================================================

/** Timeout richiesta: oltre questa soglia il sito è comunque un problema. */
export const FETCH_TIMEOUT_MS = 12_000;
/** Oltre questo tempo di risposta il sito è considerato lento. */
export const SLOW_MS = 3_000;
/** Peso massimo: il punteggio resta in 0-100. */
export const MAX_SCORE = 100;

/** Segnali grezzi osservati sulla pagina. Niente rete, niente AI. */
export interface SiteProbe {
  url: string;
  reachable: boolean;
  http_status: number | null;
  response_ms: number | null;
  https: boolean;
  html: string;
  error: string;
}

const CONTACT_RE = /(?:tel:|mailto:|whatsapp|wa\.me|\+39[\s.\-]?\d{6,})/i;
const CTA_RE =
  /(?:prenota|contatta(?:ci)?|chiama(?:ci)?|richiedi|scrivi(?:ci)?|prendi appuntamento|book now|contact us)/i;
const VIEWPORT_RE = /<meta[^>]+name=["']?viewport["']?/i;
/** Tecnologie che datano il sito: Flash, tabelle di layout, jQuery 1.x. */
const OUTDATED_RE =
  /(?:<frameset|<marquee|<font\b|application\/x-shockwave-flash|jquery[-.]1\.\d|<table[^>]+(?:width=["']?100%["']?)[^>]*>\s*<tr)/i;

/** Scarica la pagina senza eseguire JS: basta l'HTML per i segnali. */
export async function fetchSite(url: string): Promise<SiteProbe> {
  const probe: SiteProbe = {
    url,
    reachable: false,
    http_status: null,
    response_ms: null,
    https: url.toLowerCase().startsWith("https://"),
    html: "",
    error: "",
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // User agent onesto: nessun mascheramento, nessuna evasione.
        "User-Agent": "SpecterSiteAudit/1.0 (+audit interno AYROMEX)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    probe.response_ms = Date.now() - started;
    probe.http_status = res.status;
    probe.reachable = true;
    // L'URL finale conta: un http:// che redirige a https:// è sicuro.
    probe.https = res.url.toLowerCase().startsWith("https://");
    if (res.ok) {
      const body = await res.text();
      // Tetto di memoria: i segnali stanno tutti nei primi 500 KB.
      probe.html = body.slice(0, 500_000);
    }
  } catch (err) {
    probe.response_ms = Date.now() - started;
    probe.error =
      (err as Error).name === "AbortError"
        ? `timeout oltre ${FETCH_TIMEOUT_MS} ms`
        : (err as Error).message;
  } finally {
    clearTimeout(timer);
  }
  return probe;
}

function add(
  reasons: OpportunityReason[],
  code: string,
  label: string,
  points: number,
  measured?: string,
): void {
  reasons.push({ code, label, points, measured });
}

/** Punteggio deterministico dai segnali osservati. Funzione pura. */
export function scoreWebsite(probe: SiteProbe | null): WebsiteAnalysis {
  const checkedAt = new Date().toISOString();
  const reasons: OpportunityReason[] = [];

  // Nessun sito: massima opportunità, nessun altro controllo ha senso.
  if (!probe || !probe.url) {
    add(reasons, "no_website", "Nessun sito web presente su Google", 100);
    return {
      url: "",
      status: "no_website",
      opportunity_score: 100,
      reasons,
      http_status: null,
      response_ms: null,
      https: false,
      has_viewport: false,
      has_cta: false,
      has_contacts: false,
      html_bytes: 0,
      checked_at: checkedAt,
      error: "",
    };
  }

  const base = {
    url: probe.url,
    http_status: probe.http_status,
    response_ms: probe.response_ms,
    https: probe.https,
    html_bytes: probe.html.length,
    checked_at: checkedAt,
    error: probe.error,
  };

  // Irraggiungibile: il sito c'è sulla scheda ma non risponde.
  if (!probe.reachable) {
    add(reasons, "offline", "Il sito non risponde", 90, probe.error || "nessuna risposta");
    return {
      ...base,
      status: "offline",
      opportunity_score: 90,
      reasons,
      has_viewport: false,
      has_cta: false,
      has_contacts: false,
    };
  }

  const status5xx = (probe.http_status ?? 0) >= 500;
  const status4xx = (probe.http_status ?? 0) >= 400 && (probe.http_status ?? 0) < 500;
  if (status5xx || status4xx) {
    const label = status5xx ? "Errore server sul sito" : "Pagina non trovata";
    add(reasons, status5xx ? "server_error" : "not_found", label, 85, `HTTP ${probe.http_status}`);
    return {
      ...base,
      status: status4xx ? "blocked" : "offline",
      opportunity_score: 85,
      reasons,
      has_viewport: false,
      has_cta: false,
      has_contacts: false,
    };
  }

  // Risponde ma non dà HTML (paywall, bot-wall, redirect a social).
  if (!probe.html) {
    add(reasons, "blocked", "Il sito non restituisce contenuto leggibile", 60, `HTTP ${probe.http_status}`);
    return {
      ...base,
      status: "blocked",
      opportunity_score: 60,
      reasons,
      has_viewport: false,
      has_cta: false,
      has_contacts: false,
    };
  }

  const html = probe.html;
  const hasViewport = VIEWPORT_RE.test(html);
  const hasCta = CTA_RE.test(html);
  const hasContacts = CONTACT_RE.test(html);
  const outdated = OUTDATED_RE.test(html);
  const thin = html.length < 4_000;
  const slow = (probe.response_ms ?? 0) > SLOW_MS;

  if (!probe.https) add(reasons, "insecure", "Sito senza HTTPS", 25, probe.url);
  if (!hasViewport) add(reasons, "not_mobile", "Nessun viewport: non adatto a mobile", 30);
  if (outdated) add(reasons, "outdated", "Tecnologie datate nel markup", 20);
  if (!hasCta) add(reasons, "no_cta", "Nessuna call to action riconoscibile", 15);
  if (!hasContacts) add(reasons, "no_contacts", "Nessun contatto cliccabile", 15);
  if (slow) add(reasons, "slow", "Risposta lenta", 15, `${probe.response_ms} ms`);
  if (thin) add(reasons, "thin", "Contenuto molto scarno", 10, `${html.length} byte`);

  const score = Math.min(
    MAX_SCORE,
    reasons.reduce((sum, r) => sum + r.points, 0),
  );

  // Lo stato racconta il problema PRINCIPALE, in ordine di gravità
  // commerciale: mobile prima di tutto, poi sicurezza, poi il resto.
  let status: WebsiteStatus = "acceptable";
  if (!hasViewport) status = "not_mobile";
  else if (!probe.https) status = "insecure";
  else if (outdated) status = "outdated";
  else if (slow) status = "slow";
  else if (!hasContacts) status = "no_contacts";
  else if (!hasCta) status = "no_cta";

  if (status === "acceptable") {
    add(reasons, "acceptable", "Sito sostanzialmente a posto", 0);
  }

  return {
    ...base,
    status,
    opportunity_score: score,
    reasons,
    has_viewport: hasViewport,
    has_cta: hasCta,
    has_contacts: hasContacts,
  };
}

/** Soglia sopra la quale il lead entra in produzione demo. */
export const ELIGIBLE_SCORE = 40;

export function isEligible(analysis: WebsiteAnalysis): boolean {
  return analysis.opportunity_score >= ELIGIBLE_SCORE && analysis.status !== "acceptable";
}

/** Analisi completa (rete + punteggio). `url` vuoto = nessun sito. */
export async function analyzeWebsite(url: string): Promise<WebsiteAnalysis> {
  const clean = (url || "").trim();
  if (!clean) return scoreWebsite(null);
  let normalized = clean;
  if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
  try {
    // Scarta URL malformati prima di sprecare una richiesta.
    new URL(normalized);
  } catch {
    return scoreWebsite(null);
  }
  return scoreWebsite(await fetchSite(normalized));
}
