import { gemini, COMPLEX_MODEL } from "@/lib/gemini";
import { extractFromHtml } from "@/lib/factory/extract";
import { providerPredefinito, type BrowserWorkerProvider } from "./browser";
import { componiIdentita, valutaCandidato, type ContestoBrand } from "./brand";
import { classificaGuasto, guastoDiConfigurazione, type Guasto } from "./guasti";
import { urlDalleCitazioni, risolvi, type RispostaGrounded } from "./ricerca";
import type {
  BrandCandidate, BrandIdentity, EsitoFonte, FontiBrand, IdentitySignal,
  MotivoBlocco,
} from "@/types/dossier";

// ============================================================
// L'esecuzione della scoperta del marchio. Le REGOLE stanno in
// lib/collector/brand.ts; qui si interrogano le fonti.
//
// QUATTRO FONTI, E DUE NON SI POSSONO INTERROGARE.
//
//  1. SITO UFFICIALE — favicon, logo dichiarato, og:image, <img> con
//     «logo» nel percorso o nell'alt. E la fonte forte: se il file e
//     servito dall'host ufficiale verificato, la provenienza e provata,
//     non stimata.
//
//  2. SOCIAL CONFERMATI — l'avatar di un profilo gia `confirmed`.
//     Leggerlo richiede un browser: Instagram e Facebook non servono
//     l'avatar in HTML statico. Senza `RemoteBrowserProvider` (backlog)
//     non c'e niente da chiedere, e la fonte e `not_applicable`: non
//     «fallita», perche non e stata tentata e non potrebbe esserlo.
//
//  3. FOTOGRAFIE PLACES — NON INTERROGABILE, e non per un limite
//     tecnico. Un `BrandCandidate` contiene `detected_text` e
//     `candidate_colors`: e per definizione contenuto semantico
//     DERIVATO da un'immagine di Google e CONSERVATO. E esattamente
//     cio che §3.2.3(c) porta come esempio. La decisione di costruire
//     l'analisi effimera toglie questa fonte dalla scoperta del
//     marchio, e non e un effetto collaterale: e la stessa regola letta
//     due volte.
//
//     Cio che resta e il segnale: l'analisi delle fotografie marca
//     `possibile_marchio` e manda quella foto a una persona. Un
//     segnale per cercare altrove, che non si conferma e non si
//     conserva.
//
//  4. RICERCA GROUNDED — una interrogazione sola, e si accettano
//     soltanto gli URL citati. Poi si apre la pagina citata e si
//     estraggono i suoi asset come per il sito ufficiale. E il punto
//     in cui entra la locandina del film, ed e per questo che ogni
//     candidato passa da `valutaCandidato`, che senza un ancoraggio al
//     luogo o alla persona non arriva mai a `confirmed`.
// ============================================================

export interface EsitoScoperta {
  identita: BrandIdentity;
  fonti: FontiBrand;
  /** Perche una fonte e bloccata. Vuoto se nessuna lo e. */
  blocco: MotivoBlocco;
  costo: { pagine: number; query: number; token: number; ms: number };
}

export interface OpzioniScoperta {
  provider?: BrowserWorkerProvider;
  /** Iniettabile per i test: la stessa forma della risposta grounded. */
  cerca?: (query: string) => Promise<RispostaGrounded>;
  /** false = non si spende la ricerca. La fonte resta `pending`, che e
   *  la verita: esiste e non e stata interrogata. */
  usaRicerca?: boolean;
  /** Profili social gia confermati, se ce ne sono. */
  socialConfermati?: number;
}

/** Una interrogazione sola per il marchio. La scoperta social ne ha
 *  quattro perche cerca quattro piattaforme; qui l'oggetto e uno. */
export const MAX_QUERY_MARCHIO = 1;

/** Pagine citate che si aprono davvero. Oltre, si paga una lettura per
 *  ogni risultato di ricerca, e i risultati dopo il terzo non sono mai
 *  stati il sito di nessuno. */
export const MAX_PAGINE_CITATE = 3;

export async function scopriMarchio(
  ctx: ContestoBrand,
  opts: OpzioniScoperta = {},
): Promise<EsitoScoperta> {
  const t0 = Date.now();
  const provider = opts.provider ?? providerPredefinito();
  const candidati: BrandCandidate[] = [];
  let pagine = 0;
  let query = 0;
  let token = 0;
  let blocco: MotivoBlocco = "";

  const fonti: FontiBrand = {
    sito_ufficiale: "not_applicable",
    social_confermati: "not_applicable",
    // Vedi la nota 3 in testa al modulo: non e «non trovato», e
    // «non si puo costruire».
    foto_places: "not_applicable",
    ricerca_grounded: "pending",
  };

  const annota = (g: Guasto): EsitoFonte => {
    if (g.esito === "permanent_error" && !blocco) blocco = g.blocco;
    return g.esito;
  };

  // ----- 1. Sito ufficiale ------------------------------------------
  if (ctx.official_host) {
    const url = /^https?:\/\//i.test(ctx.official_host)
      ? ctx.official_host : `https://${ctx.official_host}`;
    const r = await leggiAsset(provider, url, "official_site", ctx, true);
    pagine += r.pagine;
    fonti.sito_ufficiale = r.guasto ? annota(r.guasto)
      : r.candidati.length > 0 ? "success_candidates" : "success_no_results";
    candidati.push(...r.candidati);
  }

  // ----- 2. Social confermati ---------------------------------------
  // Restano `not_applicable`: senza browser remoto l'avatar non e
  // leggibile, e una fonte che non si puo interrogare non e una fonte
  // aperta. Tenerla `pending` bloccherebbe ogni lead per sempre in
  // attesa di una capacita che e in backlog.

  // ----- 4. Ricerca grounded ----------------------------------------
  if (opts.usaRicerca !== false) {
    const r = await cercaMarchio(ctx, provider, opts.cerca);
    query += r.query;
    token += r.token;
    pagine += r.pagine;
    fonti.ricerca_grounded = r.guasto ? annota(r.guasto)
      : r.candidati.length > 0 ? "success_candidates" : "success_no_results";
    candidati.push(...r.candidati);
  }

  return {
    identita: componiIdentita(candidati, fonti),
    fonti,
    blocco,
    costo: { pagine, query, token, ms: Date.now() - t0 },
  };
}

// ----- Estrazione degli asset da una pagina --------------------------

interface LetturaAsset {
  candidati: BrandCandidate[];
  pagine: number;
  guasto: Guasto | null;
}

/**
 * Apre una pagina e ne estrae i candidati marchio.
 *
 * `ufficiale` cambia tutto: dallo stesso HTML, servito dall'host
 * verificato, esce un candidato `confirmed`; servito da una pagina
 * qualunque trovata da una ricerca, esce un candidato che deve ancora
 * guadagnarsi ogni punto.
 */
async function leggiAsset(
  provider: BrowserWorkerProvider,
  url: string,
  origine: BrandCandidate["source_type"],
  ctx: ContestoBrand,
  ufficiale: boolean,
): Promise<LetturaAsset> {
  let pagina;
  try {
    pagina = await provider.apri(url);
  } catch (err) {
    return { candidati: [], pagine: 1, guasto: classificaGuasto(err) };
  }
  if (pagina.esito !== "ok" || !pagina.html) {
    // Un sito che non risponde non e un marchio che non c'e.
    return {
      candidati: [], pagine: 1,
      guasto: pagina.status >= 400
        ? classificaGuasto({ status: pagina.status, message: pagina.detail })
        : { esito: "transient_error", blocco: "" },
    };
  }

  const base = pagina.final_url || url;
  const grezzi = assetDiMarchio(pagina.html, base);
  const testo = testoDiContesto(pagina.html);
  const out: BrandCandidate[] = [];

  for (const a of grezzi) {
    const segnali: IdentitySignal[] = [];
    if (ufficiale) segnali.push("same_domain");
    if (a.kind === "logo" && a.metodo === "json_ld") segnali.push("declared_username");

    const parziale = {
      kind: a.kind,
      source_type: origine,
      source_url: a.url,
      provider_reference: "",
      discovered_via: origine,
      identity_signals: segnali,
      detected_text: a.alt,
      contesto_testo: testo,
      // Un file servito dal sito del cliente resta suo: si mostra
      // perche e la sua identita, e non lo si rivende.
      rights_status: ufficiale
        ? ("official_public_pending_approval" as const)
        : ("unknown" as const),
    };
    const v = valutaCandidato(parziale, ctx);
    out.push({
      kind: a.kind,
      source_type: origine,
      source_url: a.url,
      provider_reference: "",
      discovered_via: origine,
      identity_signals: segnali,
      image_width: 0,
      image_height: 0,
      has_transparency: /\.(png|svg|webp)(\?|$)/i.test(a.url),
      detected_text: a.alt,
      candidate_colors: [],
      rights_status: parziale.rights_status,
      confidence: v.confidence,
      status: v.status,
      rejection_reason: v.rejection_reason,
      retrieved_at: new Date().toISOString(),
    });
  }
  return { candidati: out, pagine: 1, guasto: null };
}

interface AssetGrezzo {
  url: string;
  kind: BrandCandidate["kind"];
  alt: string;
  metodo: "json_ld" | "link" | "meta" | "img";
}

/**
 * Gli asset di marchio di una pagina HTML. Funzione pura: nessuna rete.
 *
 * L'ordine e quello della forza della dichiarazione: il logo dichiarato
 * nei dati strutturati e un'affermazione del sito su se stesso;
 * `og:image` e l'anteprima social, che spesso e una fotografia e non un
 * marchio, quindi entra come candidato debole e non come logo.
 */
export function assetDiMarchio(html: string, base: string): AssetGrezzo[] {
  const out: AssetGrezzo[] = [];
  const visti = new Set<string>();
  const aggiungi = (u: string, kind: AssetGrezzo["kind"], alt: string, metodo: AssetGrezzo["metodo"]) => {
    const abs = assoluto(u, base);
    if (!abs || visti.has(abs)) return;
    visti.add(abs);
    out.push({ url: abs, kind, alt, metodo });
  };

  const est = extractFromHtml(html, base);
  for (const l of est.logo.slice(0, 3)) aggiungi(l.value, "logo", l.evidence ?? "", "json_ld");

  // Favicon e apple-touch-icon: quasi sempre il marchio ridotto, e
  // quasi sempre l'unico file di marchio che un sito piccolo pubblica.
  const re = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < 12) {
    const tag = m[0];
    const rel = (tag.match(/\brel=["']([^"']+)["']/i)?.[1] ?? "").toLowerCase();
    if (!/\b(icon|shortcut icon|apple-touch-icon|mask-icon)\b/.test(rel)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? "";
    if (href) aggiungi(href, "favicon", "", "link");
  }

  const og = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i)?.[1]
    ?? "";
  if (og) aggiungi(og, "color_reference", "og:image", "meta");

  for (const i of est.images.slice(0, 6)) {
    if (!/logo|brand|marchio|insegna/i.test(`${i.value} ${i.evidence ?? ""}`)) continue;
    aggiungi(i.value, "logo", i.evidence ?? "", "img");
  }
  return out.slice(0, 12);
}

function assoluto(u: string, base: string): string {
  const s = (u || "").trim();
  if (!s || /^(data|about|javascript|blob):/i.test(s)) return "";
  if (/^https?:\/\//i.test(s)) return s;
  try {
    const abs = new URL(s, base).toString();
    return /^https?:\/\//i.test(abs) ? abs : "";
  } catch { return ""; }
}

/** Il testo della pagina, ridotto. Serve solo a cercare un ancoraggio:
 *  la citta, l'indirizzo, il nome della titolare. Non si conserva. */
function testoDiContesto(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 4000);
}

// ----- Fonte 4: ricerca grounded -------------------------------------

interface EsitoRicercaMarchio {
  candidati: BrandCandidate[];
  query: number;
  token: number;
  pagine: number;
  guasto: Guasto | null;
}

/** La query: nome esatto fra virgolette piu il luogo. Senza il luogo si
 *  cerca l'omonimo, che e il difetto che questo modulo esiste per non
 *  avere. */
export function queryMarchio(ctx: ContestoBrand): string {
  const dove = ctx.citta || (ctx.indirizzo || "").split(",")[0] || "";
  return `"${ctx.nome}" ${dove} logo insegna sito ufficiale`.replace(/\s+/g, " ").trim();
}

async function cercaMarchio(
  ctx: ContestoBrand,
  provider: BrowserWorkerProvider,
  iniettata?: (q: string) => Promise<RispostaGrounded>,
): Promise<EsitoRicercaMarchio> {
  const vuoto = { candidati: [], query: 0, token: 0, pagine: 0 };
  const cerca = iniettata ?? chiamaGrounded;
  if (!iniettata && !gemini) {
    // Nessuna chiave: non si chiama e non si finge. E un blocco, non un
    // «non trovato», e il rimedio e una riga di configurazione.
    return { ...vuoto, guasto: guastoDiConfigurazione() };
  }

  let risposta: RispostaGrounded;
  try {
    risposta = await cerca(queryMarchio(ctx));
  } catch (err) {
    return { ...vuoto, query: 1, guasto: classificaGuasto(err) };
  }

  const token = risposta.usageMetadata?.totalTokenCount ?? 0;
  // SOLO le citazioni. Un URL scritto nel testo del modello e generato,
  // e un URL generato che sembra giusto e il modo piu diretto di
  // attribuire il marchio di un'altra attivita al nostro cliente.
  const citati = urlDalleCitazioni(risposta);
  if (citati.length === 0) {
    return { ...vuoto, query: 1, token, guasto: null };
  }

  const candidati: BrandCandidate[] = [];
  const host = new Set<string>();
  let pagine = 0;

  for (const grezzo of citati) {
    if (pagine >= MAX_PAGINE_CITATE) break;
    const finale = await risolvi(grezzo).catch(() => "");
    if (!finale) continue;
    let h: string;
    try { h = new URL(finale).host.toLowerCase().replace(/^www\./, ""); } catch { continue; }
    if (host.has(h)) continue;
    host.add(h);

    const r = await leggiAsset(provider, finale, "grounded_search", ctx, false);
    pagine += r.pagine;
    candidati.push(...r.candidati);
  }

  return { candidati, query: 1, token, pagine, guasto: null };
}

async function chiamaGrounded(query: string): Promise<RispostaGrounded> {
  const m = gemini!.getGenerativeModel({
    model: COMPLEX_MODEL,
    tools: [{ googleSearch: {} }] as never,
  });
  const r = await m.generateContent({
    contents: [{ role: "user", parts: [{ text: query }] }],
    generationConfig: { temperature: 0 },
  });
  return r.response as unknown as RispostaGrounded;
}
