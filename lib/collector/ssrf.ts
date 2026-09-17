// ============================================================
// Protezione SSRF per il collector.
//
// Il collector scarica URL che arrivano da Google Places e dall'HTML di
// siti di terzi. Nessuna di queste fonti e fidata: un `websiteUri` su
// una scheda Maps lo scrive chi rivendica l'attivita, e un `<a href>`
// lo scrive chiunque abbia scritto quella pagina.
//
// Un fetch verso `http://169.254.169.254/` dal runtime di produzione
// restituisce le credenziali dell'istanza. Verso `http://127.0.0.1:…`
// raggiunge servizi interni che nessuno ha mai esposto. Quindi qui non
// si filtra "per prudenza": si filtra perche senza filtro il collector
// e una macchina per esfiltrare segreti su richiesta di terzi.
//
// Tre livelli, e servono tutti e tre:
//  1. schema e forma dell'URL;
//  2. l'host: nome sospetto o letterale IP dentro una rete privata;
//  3. DNS: `evil.com` puo risolvere a 127.0.0.1, quindi si controlla
//     l'indirizzo RISOLTO, non il nome. E si ricontrolla a ogni
//     redirect, perche il primo salto puo essere onesto e il secondo no.
// ============================================================

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type SsrfRejection =
  | "schema_non_ammesso"
  | "url_non_valido"
  | "host_locale"
  | "rete_privata"
  | "metadata_endpoint"
  | "porta_non_ammessa"
  | "dns_non_risolto"
  | "troppi_redirect"
  | "troppo_grande"
  | "timeout";

export interface SsrfVerdict {
  ok: boolean;
  reason: SsrfRejection | "";
  detail: string;
  /** Indirizzi a cui l'host risolve. Vuoto se non si e arrivati al DNS. */
  addresses: string[];
}

/** Endpoint di metadati delle piattaforme cloud: la ragione per cui
 *  questo modulo esiste. */
const METADATA_HOSTS = new Set([
  "169.254.169.254",          // AWS, Azure, GCP, DigitalOcean
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "100.100.100.200",          // Alibaba
]);

const HOST_LOCALI = new Set([
  "localhost", "127.0.0.1", "::1", "0.0.0.0", "[::1]",
  "localhost.localdomain", "ip6-localhost", "ip6-loopback",
]);

/** Porte ammesse: quelle del web. Un URL che punta a 6379 o 5432 non
 *  sta cercando una pagina. */
const PORTE_AMMESSE = new Set(["", "80", "443", "8080", "8443"]);

/** Un IPv4 dentro una rete non instradabile su Internet. */
function ipv4Privato(ip: string): string {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return "indirizzo malformato";
  }
  const [a, b] = p;
  if (a === 10) return "10.0.0.0/8";
  if (a === 127) return "127.0.0.0/8 (loopback)";
  if (a === 0) return "0.0.0.0/8";
  if (a === 172 && b >= 16 && b <= 31) return "172.16.0.0/12";
  if (a === 192 && b === 168) return "192.168.0.0/16";
  if (a === 169 && b === 254) return "169.254.0.0/16 (link-local)";
  if (a === 100 && b >= 64 && b <= 127) return "100.64.0.0/10 (CGNAT)";
  if (a === 192 && b === 0) return "192.0.0.0/24";
  if (a >= 224) return "multicast o riservato";
  return "";
}

/** Un IPv6 dentro una rete non instradabile, incluse le forme che
 *  incapsulano un IPv4 (::ffff:127.0.0.1 e loopback a tutti gli effetti). */
function ipv6Privato(ip: string): string {
  const x = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (x === "::1" || x === "::") return "loopback";
  // IPv4 mappato o compatibile: si giudica l'IPv4 che contiene.
  const m = x.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return ipv4Privato(m[1]) || "";
  if (/^f[cd]/.test(x)) return "fc00::/7 (unique local)";
  if (/^fe[89ab]/.test(x)) return "fe80::/10 (link-local)";
  if (/^ff/.test(x)) return "multicast";
  return "";
}

/** Un indirizzo gia risolto e raggiungibile senza rischi? */
export function indirizzoAmmesso(ip: string): { ok: boolean; reason: SsrfRejection | ""; detail: string } {
  if (METADATA_HOSTS.has(ip)) {
    return { ok: false, reason: "metadata_endpoint", detail: `${ip} e un endpoint di metadati cloud` };
  }
  const v = isIP(ip);
  if (v === 4) {
    const rete = ipv4Privato(ip);
    return rete
      ? { ok: false, reason: "rete_privata", detail: `${ip} sta in ${rete}` }
      : { ok: true, reason: "", detail: "" };
  }
  if (v === 6) {
    const rete = ipv6Privato(ip);
    return rete
      ? { ok: false, reason: "rete_privata", detail: `${ip} sta in ${rete}` }
      : { ok: true, reason: "", detail: "" };
  }
  return { ok: false, reason: "url_non_valido", detail: `${ip} non e un indirizzo IP` };
}

/** Controlli che non richiedono rete. Separati apposta: sono puri e si
 *  testano senza DNS. */
export function controlloStatico(raw: string): SsrfVerdict {
  const no = (reason: SsrfRejection, detail: string): SsrfVerdict =>
    ({ ok: false, reason, detail, addresses: [] });

  const grezzo = (raw || "").trim();
  if (!grezzo) return no("url_non_valido", "URL vuoto");

  // Sulla stringa grezza, prima di qualunque parsing: `new URL()`
  // accetta javascript: e file: senza battere ciglio.
  if (/^\s*(?:javascript|data|vbscript|file|blob|ftp|gopher|dict|ldap):/i.test(grezzo)) {
    return no("schema_non_ammesso", `schema rifiutato in ${grezzo.slice(0, 24)}`);
  }

  let u: URL;
  try {
    u = new URL(grezzo);
  } catch {
    return no("url_non_valido", "non e un URL assoluto");
  }

  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return no("schema_non_ammesso", `schema ${u.protocol}`);
  }
  if (!PORTE_AMMESSE.has(u.port)) {
    return no("porta_non_ammessa", `porta ${u.port}`);
  }

  const host = u.hostname.toLowerCase();
  if (HOST_LOCALI.has(host)) return no("host_locale", `${host} e locale`);
  if (METADATA_HOSTS.has(host)) return no("metadata_endpoint", `${host} e un endpoint di metadati`);
  // `.localhost` e riservato dalla RFC 6761 e risolve sempre a loopback.
  if (host === "localhost" || host.endsWith(".localhost")) {
    return no("host_locale", `${host} risolve a loopback per definizione`);
  }
  if (host.endsWith(".internal") || host.endsWith(".local")) {
    return no("host_locale", `${host} e un nome di rete interna`);
  }

  // Host scritto direttamente come IP: si giudica subito, senza DNS.
  const nudo = host.replace(/^\[|\]$/g, "");
  if (isIP(nudo)) {
    const v = indirizzoAmmesso(nudo);
    if (!v.ok) return no(v.reason as SsrfRejection, v.detail);
  }

  return { ok: true, reason: "", detail: "", addresses: [] };
}

/** Controllo completo: statico piu DNS. `evil.com` che punta a
 *  127.0.0.1 passa il controllo statico e va fermato qui. */
export async function controlloUrl(raw: string): Promise<SsrfVerdict> {
  const statico = controlloStatico(raw);
  if (!statico.ok) return statico;

  const host = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(host)) return { ...statico, addresses: [host] };

  let risolti: string[];
  try {
    const res = await lookup(host, { all: true, verbatim: true });
    risolti = res.map((r) => r.address);
  } catch (e) {
    return { ok: false, reason: "dns_non_risolto", detail: `${host}: ${(e as Error).message}`, addresses: [] };
  }
  if (risolti.length === 0) {
    return { ok: false, reason: "dns_non_risolto", detail: `${host} non risolve`, addresses: [] };
  }

  // TUTTI gli indirizzi devono essere ammessi: un host che ne espone
  // due, di cui uno privato, e un host che puo servire quello privato.
  for (const ip of risolti) {
    const v = indirizzoAmmesso(ip);
    if (!v.ok) return { ok: false, reason: v.reason as SsrfRejection, detail: v.detail, addresses: risolti };
  }
  return { ok: true, reason: "", detail: "", addresses: risolti };
}

// ----- Fetch con i limiti ----------------------------------------

export interface LimitiFetch {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  userAgent: string;
}

/** Tetti prudenti. Non sono suggerimenti: il collector gira su un lead
 *  vero e non deve poter consumare il runtime. */
export const LIMITI: LimitiFetch = {
  timeoutMs: 12_000,
  maxBytes: 2_000_000,
  maxRedirects: 3,
  // Ci si identifica. Un collector che si traveste da browser sta
  // aggirando una decisione di chi ospita il sito.
  userAgent: "SpecterCollector/1.0 (+audit interno AYROMEX; contatto tramite il sito)",
};

export interface RisultatoFetch {
  ok: boolean;
  url: string;
  status: number;
  contentType: string;
  body: string;
  bytes: Uint8Array | null;
  reason: SsrfRejection | "";
  detail: string;
  /** La catena di redirect seguita, per l'audit. */
  hops: string[];
  ms: number;
}

/**
 * Scarica un URL rispettando la guardia SSRF a OGNI salto.
 *
 * `redirect: "manual"` non e un dettaglio: con `follow` il runtime
 * seguirebbe il redirect da solo e il secondo indirizzo non passerebbe
 * mai dal controllo. Un sito onesto che rimanda a 127.0.0.1 e proprio
 * il caso che si vuole intercettare.
 */
export async function fetchSicuro(
  raw: string,
  opts: Partial<LimitiFetch> & { binario?: boolean } = {},
): Promise<RisultatoFetch> {
  const lim = { ...LIMITI, ...opts };
  const t0 = Date.now();
  const hops: string[] = [];
  let url = raw;

  const ko = (reason: SsrfRejection | "", detail: string, status = 0): RisultatoFetch =>
    ({ ok: false, url, status, contentType: "", body: "", bytes: null, reason, detail, hops, ms: Date.now() - t0 });

  for (let salto = 0; salto <= lim.maxRedirects; salto++) {
    const v = await controlloUrl(url);
    if (!v.ok) return ko(v.reason, v.detail);
    hops.push(url);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), lim.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: ac.signal,
        headers: { "User-Agent": lim.userAgent, Accept: "*/*" },
      });
    } catch (e) {
      clearTimeout(timer);
      const msg = (e as Error).name === "AbortError" ? "timeout" : (e as Error).message;
      return ko((e as Error).name === "AbortError" ? "timeout" : "", msg);
    }
    clearTimeout(timer);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return ko("", `redirect ${res.status} senza Location`, res.status);
      url = new URL(loc, url).toString();
      continue;
    }

    const contentType = res.headers.get("content-type") ?? "";
    const dichiarato = Number(res.headers.get("content-length") ?? 0);
    if (dichiarato && dichiarato > lim.maxBytes) {
      return ko("troppo_grande", `dichiarati ${dichiarato} byte`, res.status);
    }

    // Il Content-Length dichiarato puo mentire o mancare: si conta
    // quello che arriva davvero e si taglia.
    const buf = await leggiConTetto(res, lim.maxBytes);
    if (buf === null) return ko("troppo_grande", `oltre ${lim.maxBytes} byte`, res.status);

    return {
      ok: res.ok,
      url,
      status: res.status,
      contentType,
      body: opts.binario ? "" : new TextDecoder("utf-8", { fatal: false }).decode(buf),
      bytes: opts.binario ? buf : null,
      reason: "",
      detail: "",
      hops,
      ms: Date.now() - t0,
    };
  }
  return ko("troppi_redirect", `oltre ${lim.maxRedirects} redirect`);
}

/** Legge il corpo fermandosi al tetto. `null` = ha sforato. */
async function leggiConTetto(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const reader = res.body?.getReader();
  if (!reader) {
    const ab = await res.arrayBuffer();
    return ab.byteLength > maxBytes ? null : new Uint8Array(ab);
  }
  const pezzi: Uint8Array[] = [];
  let totale = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totale += value.byteLength;
    if (totale > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    pezzi.push(value);
  }
  const out = new Uint8Array(totale);
  let off = 0;
  for (const p of pezzi) { out.set(p, off); off += p.byteLength; }
  return out;
}
