// ============================================================
// Scoperta di profili social tramite Gemini con Google Search
// grounding.
//
// Nasce da un limite visto sul primo lead reale: la scoperta social
// parte dai link SUL sito ufficiale, e quel lead un sito non ce l'ha.
// Zero profili trovati, nemmeno incerti — mentre l'attivita
// probabilmente un Instagram ce l'ha.
//
// DUE REGOLE CHE REGGONO TUTTO IL MODULO:
//
//  1. Si accettano SOLO gli URL presenti nelle citazioni della
//     risposta grounded (`groundingChunks`). Mai un URL scritto nel
//     testo del modello: quello e generato, e un URL generato che
//     sembra giusto e il modo piu diretto di attribuire il profilo di
//     un'altra attivita al nostro cliente.
//
//  2. Gemini SCOPRE, non verifica. Tutto cio che esce di qui e un
//     candidato, e deve passare dai due segnali forti di
//     lib/collector/identity.ts come qualunque altro link.
//
// Nessuna variabile d'ambiente nuova: usa `GEMINI_API_KEY`, gia
// presente e gia usata altrove.
// ============================================================

import { gemini, COMPLEX_MODEL } from "@/lib/gemini";
import { controlloUrl } from "./ssrf";
import { eUrlDiProfilo, normalizzaUrlProfilo, piattaformaDi } from "./identity";
import type { Platform } from "@/types/dossier";

/** Tetto duro: quattro interrogazioni per lead, non una di piu. */
export const MAX_QUERY_PER_LEAD = 4;

export type EsitoRicerca =
  | "ok"
  | "search_unavailable"   // il grounding non e disponibile qui
  | "not_configured"       // nessuna chiave Gemini
  | "no_results";

export interface CandidatoScoperto {
  url: string;
  platform: Platform;
  /** La query che l'ha prodotto: serve a capire perche e qui. */
  query_index: number;
}

export interface RisultatoRicerca {
  esito: EsitoRicerca;
  candidati: CandidatoScoperto[];
  /** Quante interrogazioni sono partite davvero. */
  queries_used: number;
  /** Token consumati, quando il modello li dichiara. */
  tokens: number;
  ms: number;
  /** Perche non ha funzionato, in una riga. Mai l'URL di nessuno. */
  detail: string;
}

export interface ContestoRicerca {
  nome: string;
  citta: string;
  indirizzo: string;
  telefono: string;
  categoria: string;
}

/** Le quattro interrogazioni, in ordine di resa. Nome esatto sempre:
 *  senza, si raccolgono profili di attivita omonime. */
export function queryPerLead(c: ContestoRicerca): string[] {
  const nome = `"${c.nome}"`;
  const dove = c.citta || c.indirizzo;
  const q: string[] = [];
  if (dove) q.push(`${nome} ${dove} Instagram profilo ufficiale`);
  const ancora = c.indirizzo || c.telefono;
  if (ancora) q.push(`${nome} ${ancora} Facebook pagina ufficiale`);
  if (dove) q.push(`${nome} ${dove} TikTok`);
  if (c.categoria && dove) q.push(`${nome} ${c.categoria} ${dove} sito e social`);
  return q.slice(0, MAX_QUERY_PER_LEAD);
}

/** La forma della risposta che ci interessa. Il tipo del SDK non copre
 *  il grounding, quindi si legge difensivamente. */
export interface RispostaGrounded {
  candidates?: {
    groundingMetadata?: {
      groundingChunks?: { web?: { uri?: string; title?: string } }[];
    };
  }[];
  usageMetadata?: { totalTokenCount?: number };
}

/** Gli URL delle citazioni, e nient'altro.
 *  Esportata perche e LA regola del modulo, e una regola che non si
 *  puo verificare e una regola che prima o poi salta. */
export function urlDalleCitazioni(r: RispostaGrounded): string[] {
  const out: string[] = [];
  for (const c of r.candidates ?? []) {
    for (const g of c.groundingMetadata?.groundingChunks ?? []) {
      const u = g.web?.uri;
      if (typeof u === "string" && u) out.push(u);
    }
  }
  return out;
}

/**
 * Le citazioni di Gemini arrivano come URL di reindirizzamento del
 * servizio di grounding, non come indirizzo finale. Per sapere se un
 * candidato e un profilo Instagram bisogna seguire il salto.
 *
 * Si segue con la guardia SSRF, come qualunque altro URL che arriva da
 * fuori: un reindirizzamento e pur sempre un indirizzo scelto da
 * qualcun altro.
 */
export async function risolvi(url: string): Promise<string> {
  if (!/grounding-api-redirect|vertexaisearch/i.test(url)) return url;
  const v = await controlloUrl(url);
  if (!v.ok) return "";
  try {
    const res = await fetch(url, { redirect: "manual" });
    const loc = res.headers.get("location");
    if (loc) {
      const assoluto = new URL(loc, url).toString();
      const vv = await controlloUrl(assoluto);
      return vv.ok ? assoluto : "";
    }
    return res.url && res.url !== url ? res.url : "";
  } catch {
    return "";
  }
}

const ISTRUZIONI =
  "Sei uno strumento di ricerca. Cerca i profili social UFFICIALI "
  + "dell'attivita indicata. Non inventare indirizzi: limitati a cercare "
  + "e a citare le fonti. Rispondi con un elenco brevissimo.";

/**
 * Esegue fino a quattro interrogazioni e restituisce solo i profili
 * citati. Non fallisce mai in modo rumoroso: se il grounding non e
 * disponibile con questo modello o questo progetto, lo dichiara e il
 * collector prosegue senza.
 */
export async function scopriProfili(
  ctx: ContestoRicerca,
  opts: { maxQuery?: number } = {},
): Promise<RisultatoRicerca> {
  const t0 = Date.now();
  const vuoto: RisultatoRicerca = {
    esito: "not_configured", candidati: [], queries_used: 0, tokens: 0, ms: 0, detail: "",
  };

  if (!gemini) {
    return { ...vuoto, detail: "GEMINI_API_KEY non configurata: scoperta social saltata", ms: Date.now() - t0 };
  }
  if (!ctx.nome.trim()) {
    return { ...vuoto, esito: "no_results", detail: "nome dell'attivita mancante", ms: Date.now() - t0 };
  }

  const queries = queryPerLead(ctx).slice(0, Math.min(opts.maxQuery ?? MAX_QUERY_PER_LEAD, MAX_QUERY_PER_LEAD));
  if (queries.length === 0) {
    return { ...vuoto, esito: "no_results", detail: "dati insufficienti per formulare una ricerca", ms: Date.now() - t0 };
  }

  let modello;
  try {
    modello = gemini.getGenerativeModel({
      model: COMPLEX_MODEL,
      systemInstruction: ISTRUZIONI,
      // Il tool di ricerca non e nei tipi del SDK legacy: si passa
      // esplicitamente, e se il modello non lo supporta la chiamata
      // fallisce e viene dichiarata `search_unavailable`.
      //
      // Il nome del campo e verificato contro l'API vera: su v1beta la
      // validazione dello schema precede quella della chiave, e
      // `googleSearch` supera la prima con `gemini-2.5-flash`. Un campo
      // inesistente risponderebbe «Cannot find field».
      tools: [{ googleSearch: {} }] as unknown as never,
    });
  } catch (e) {
    return { ...vuoto, esito: "search_unavailable", ms: Date.now() - t0,
      detail: `grounding non disponibile: ${(e as Error).message.slice(0, 120)}` };
  }

  const grezzi: { url: string; query_index: number }[] = [];
  let usate = 0;
  let tokens = 0;

  for (let i = 0; i < queries.length; i++) {
    try {
      const r = await modello.generateContent(queries[i]);
      usate++;
      const risposta = r.response as unknown as RispostaGrounded;
      tokens += risposta.usageMetadata?.totalTokenCount ?? 0;
      for (const u of urlDalleCitazioni(risposta)) grezzi.push({ url: u, query_index: i });
    } catch (e) {
      const m = (e as Error).message ?? "";
      // Un modello o un progetto senza grounding: si dichiara e si
      // smette, invece di consumare le altre tre interrogazioni.
      if (/tool|search|grounding|not supported|invalid/i.test(m)) {
        return {
          esito: "search_unavailable", candidati: [], queries_used: usate, tokens,
          ms: Date.now() - t0,
          detail: "Google Search grounding non disponibile con il modello o il progetto corrente",
        };
      }
      // Un errore isolato non deve buttare via le query gia riuscite.
    }
  }

  // Si risolvono i reindirizzamenti e si tiene solo cio che e un
  // profilo, deduplicato.
  const visti: string[] = [];
  const candidati: CandidatoScoperto[] = [];
  for (const g of grezzi) {
    const finale = await risolvi(g.url);
    if (!finale || !eUrlDiProfilo(finale)) continue;
    const norm = normalizzaUrlProfilo(finale);
    if (visti.indexOf(norm) !== -1) continue;
    visti.push(norm);
    candidati.push({ url: norm, platform: piattaformaDi(norm), query_index: g.query_index });
  }

  return {
    esito: candidati.length ? "ok" : "no_results",
    candidati,
    queries_used: usate,
    tokens,
    ms: Date.now() - t0,
    detail: candidati.length ? "" : "nessun profilo nelle citazioni",
  };
}
