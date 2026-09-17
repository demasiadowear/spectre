// ============================================================
// Media: diritti prima di tutto il resto.
//
// La domanda non e «questa immagine si puo scaricare». E «con che
// diritto la metto sul sito di un cliente». Sono due domande diverse e
// confonderle e il modo di far causa al proprio cliente.
//
// Una foto sul sito di un'attivita e quasi sempre dell'attivita, ma
// «quasi sempre» non e una licenza. Quindi entra come
// `official_public_pending_approval`: si puo mostrare nella DEMO
// PRIVATA noindex, per far vedere come starebbe, e non diventa un
// asset pubblico finche una persona non lo approva.
//
// Le foto di Google Places non si copiano. Places restituisce un
// riferimento opaco e un'attribuzione, e le condizioni del provider
// dicono di renderizzarle tramite il loro endpoint. Quindi
// `provider_rendered`: si conserva il riferimento, non il file.
//
// Riusa `checkImageUrl` da lib/factory/images.ts, che gia blocca gli
// schemi pericolosi, gli host di contenuti caricati dagli utenti, gli
// SVG di terzi e i pixel di tracciamento. Non si riscrive.
// ============================================================

import { createHash } from "node:crypto";
import { checkImageUrl, BLOCKED_IMAGE_HOSTS } from "@/lib/factory/images";
import type {
  MediaCandidate, MediaManifest, MediaRole, Platform,
  RightsStatus, UsageScope,
} from "@/types/dossier";

/** Un'immagine sotto queste misure non e utilizzabile in una pagina:
 *  e un'icona, un badge o una miniatura. */
export const MIN_LATO = 400;
export const MIN_AREA = 400 * 300;

/** Tetto di candidati per non trasformare il collector in uno scraper
 *  di massa su un sito altrui. */
export const MAX_CANDIDATI = 40;

export const AMBITO_PER_DIRITTO: Record<RightsStatus, UsageScope> = {
  customer_owned: "public",
  // Il punto dell'intera politica: trovata sui canali ufficiali NON
  // significa autorizzata. Solo demo privata, finche non si approva.
  official_public_pending_approval: "preview_only",
  provider_rendered: "preview_only",
  unknown: "blocked",
  forbidden: "blocked",
};

export interface CandidatoGrezzo {
  url: string;
  /** Pagina o profilo dove e stata trovata. */
  source_page: string;
  platform: Platform;
  alt?: string;
  /** Contesto testuale attorno all'immagine: serve a stimare il ruolo. */
  contesto?: string;
  /** Riferimento del provider, per le foto Places. */
  provider_reference?: string;
  attribution?: string;
  width?: number;
  height?: number;
}

const ID = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** Ruolo stimato dal nome del file, dall'alt e dal contesto. E una
 *  stima dichiarata tale: `probable_role`, non `role`. */
export function stimaRuolo(c: CandidatoGrezzo): MediaRole {
  const testo = `${c.url} ${c.alt ?? ""} ${c.contesto ?? ""}`.toLowerCase();
  const ha = (...p: string[]) => p.some((x) => testo.includes(x));

  if (ha("logo", "brand", "marchio", "favicon")) return "logo";
  if (ha("hero", "banner", "cover", "copertina", "header")) return "hero";
  if (ha("team", "staff", "equipe", "collaborat")) return "team";
  if (ha("titolare", "owner", "fondator", "chef", "proprietar")) return "owner";
  if (ha("piatto", "menu", "food", "dish", "pizza", "dolce", "portata")) return "food";
  if (ha("prodotto", "product", "shop", "listino")) return "product";
  if (ha("lavoro", "work", "portfolio", "prima-dopo", "before", "after", "taglio", "trattament")) return "work";
  if (ha("esterno", "insegna", "facciata", "vetrina", "exterior", "entrata")) return "exterior";
  if (ha("attrezzatur", "macchinar", "equipment", "poltrona", "postazione")) return "equipment";
  if (ha("sala", "interno", "locale", "ambiente", "venue", "dehors")) return "venue";
  return "unknown";
}

/** Qualita 0–100 da quello che si sa: dimensioni e proporzioni. Senza i
 *  byte si resta prudenti, e si dichiara. */
export function punteggioQualita(width: number, height: number): number {
  if (!width || !height) return 40; // non misurabile: ne alto ne basso
  const area = width * height;
  const lato = Math.min(width, height);
  let p = 0;
  p += Math.min(45, Math.round((area / (1600 * 1200)) * 45));
  p += Math.min(30, Math.round((lato / 1200) * 30));
  const rapporto = Math.max(width, height) / Math.min(width, height);
  // Una striscia lunghissima e un banner decorativo, non una fotografia.
  p += rapporto <= 2.2 ? 25 : rapporto <= 3.5 ? 12 : 0;
  return Math.max(0, Math.min(100, p));
}

export function orientamento(w: number, h: number): MediaCandidate["orientation"] {
  if (!w || !h) return "unknown";
  const r = w / h;
  if (r > 1.15) return "landscape";
  if (r < 0.87) return "portrait";
  return "square";
}

/**
 * Hash percettivo (dHash 8x8) sui byte, quando ci sono.
 *
 * Confronta la luminosita di pixel adiacenti: la stessa fotografia
 * ricompressa, riscalata o passata da un CDN diverso produce lo stesso
 * hash, mentre lo SHA-256 cambia. Serve proprio al caso reale, che e la
 * stessa foto servita da tre URL diversi.
 *
 * Qui c'e la versione che lavora su pixel gia decodificati: la
 * decodifica sta a monte, perche dipende da `sharp` e questo modulo
 * deve restare eseguibile ovunque.
 */
export function dHash(grigi: number[], larghezza: number, altezza: number): string {
  if (larghezza < 9 || altezza < 8 || grigi.length < larghezza * altezza) return "";
  const bit: number[] = [];
  const passoX = larghezza / 9, passoY = altezza / 8;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const ax = Math.floor(x * passoX), bx = Math.floor((x + 1) * passoX);
      const ay = Math.floor(y * passoY);
      const a = grigi[ay * larghezza + Math.min(ax, larghezza - 1)];
      const b = grigi[ay * larghezza + Math.min(bx, larghezza - 1)];
      bit.push(a > b ? 1 : 0);
    }
  }
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    hex += ((bit[i] << 3) | (bit[i + 1] << 2) | (bit[i + 2] << 1) | bit[i + 3]).toString(16);
  }
  return hex;
}

/** Quanti bit differiscono fra due hash percettivi. Sotto ~6 su 64 e
 *  ragionevolmente la stessa immagine. */
export function distanzaHamming(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

export const SOGLIA_SIMILI = 6;

export interface ContestoMedia {
  /** Host del sito ufficiale, senza `www`. */
  official_host: string;
  /** Host dei profili verificati come ufficiali. */
  host_ufficiali: string[];
  /** URL che l'operatore ha dichiarato forniti dal cliente. */
  forniti_dal_cliente: string[];
  nome_attivita: string;
  categoria: string;
}

function hostDi(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

/**
 * Decide i diritti. E l'unica funzione che puo assegnare
 * `customer_owned`, e lo fa solo su dichiarazione esplicita: nessuna
 * euristica puo concludere che un file e del cliente.
 */
export function classificaDiritti(
  c: CandidatoGrezzo,
  ctx: ContestoMedia,
): { rights: RightsStatus; scope: UsageScope; motivo: string } {
  const decidi = (rights: RightsStatus, motivo: string) =>
    ({ rights, scope: AMBITO_PER_DIRITTO[rights], motivo });

  // Dichiarato dal cliente: l'unica strada per `customer_owned`.
  if (ctx.forniti_dal_cliente.includes(c.url)) {
    return decidi("customer_owned", "fornito o autorizzato esplicitamente dal cliente");
  }

  // Foto di Google Places: riferimento e attribuzione, mai il file.
  if (c.provider_reference) {
    return decidi("provider_rendered",
      "fotografia Google Places: si mostra tramite l'endpoint del provider con la sua attribuzione, non si copia");
  }

  const safe = checkImageUrl(c.url);
  if (!safe.ok) {
    // Host di contenuti caricati dagli utenti: sono dei recensori, non
    // dell'attivita. Non e «sconosciuto», e proprio vietato.
    if (safe.reason === "host_bloccato") {
      return decidi("forbidden", `host di contenuti caricati da utenti o aggregatori (${safe.host})`);
    }
    return decidi("forbidden", `URL non utilizzabile: ${safe.reason}`);
  }

  const h = hostDi(c.url);
  const suSitoUfficiale = Boolean(ctx.official_host) &&
    (h === ctx.official_host || h.endsWith(`.${ctx.official_host}`));
  const suProfiloUfficiale = ctx.host_ufficiali.some((u) => h === u || h.endsWith(`.${u}`));

  if (suSitoUfficiale || suProfiloUfficiale) {
    return decidi("official_public_pending_approval",
      suSitoUfficiale
        ? "trovata sul sito ufficiale: utilizzabile solo nella demo privata noindex finche non e approvata"
        : "trovata su un profilo verificato come ufficiale: solo demo privata noindex in attesa di approvazione");
  }

  // Raggiungibile ma di provenienza ignota. Non si usa: e la regola.
  return decidi("unknown", `provenienza non riconducibile a un canale ufficiale (${h || "host ignoto"})`);
}

export interface EsitoMedia {
  candidati: MediaCandidate[];
  scartati: { source_url: string; reason: string }[];
}

/**
 * Da candidati grezzi a manifest. Nessuna rete: i byte, quando ci sono,
 * arrivano gia letti da chi li ha scaricati, perche quello e il punto
 * dove valgono i limiti di SSRF e di peso.
 */
export function costruisciCandidati(
  grezzi: CandidatoGrezzo[],
  ctx: ContestoMedia,
  byte?: Map<string, { sha256: string; phash: string; width: number; height: number; format: string; size: number }>,
): EsitoMedia {
  const candidati: MediaCandidate[] = [];
  const scartati: EsitoMedia["scartati"] = [];
  const visti = new Set<string>();

  for (const g of grezzi) {
    if (candidati.length >= MAX_CANDIDATI) {
      scartati.push({ source_url: g.url, reason: `oltre il tetto di ${MAX_CANDIDATI} candidati` });
      continue;
    }
    const chiave = g.provider_reference || g.url;
    if (visti.has(chiave)) continue;
    visti.add(chiave);

    const misure = byte?.get(g.url);
    const width = misure?.width ?? g.width ?? 0;
    const height = misure?.height ?? g.height ?? 0;

    const { rights, scope, motivo } = classificaDiritti(g, ctx);
    if (rights === "forbidden") {
      scartati.push({ source_url: g.url, reason: motivo });
      continue;
    }
    // Troppo piccola per servire a qualcosa. Le foto del provider non
    // si misurano allo stesso modo: la dimensione la decide l'endpoint.
    if (!g.provider_reference && width && height && (Math.min(width, height) < MIN_LATO || width * height < MIN_AREA)) {
      scartati.push({ source_url: g.url, reason: `troppo piccola: ${width}x${height}` });
      continue;
    }

    const testo = `${g.alt ?? ""} ${g.contesto ?? ""}`.toLowerCase();
    candidati.push({
      id: ID(chiave),
      source_url: g.url,
      source_page: g.source_page,
      platform: g.platform,
      copyright_owner: rights === "provider_rendered"
        ? (g.attribution || "Google Maps contributor")
        : (rights === "official_public_pending_approval" ? ctx.nome_attivita : ""),
      attribution: g.attribution ?? "",
      observed_at: new Date().toISOString(),
      sha256: misure?.sha256 ?? "",
      perceptual_hash: misure?.phash ?? "",
      width, height,
      format: misure?.format ?? (g.url.match(/\.(jpe?g|png|webp|avif|gif)(?:[?#]|$)/i)?.[1] ?? "").toLowerCase(),
      filesize: misure?.size ?? 0,
      orientation: orientamento(width, height),
      probable_role: stimaRuolo(g),
      quality_score: punteggioQualita(width, height),
      relevance_score: punteggioRilevanza(g, ctx),
      duplicate_group: "",
      // Senza analisi del contenuto si puo solo leggere il contesto. Un
      // falso negativo qui costa: si preferisce segnalare in eccesso.
      people_present: /\b(team|staff|titolar|owner|persona|ritratt|equipe|chef|parrucchier|barbier)\b/.test(testo),
      rights_status: rights,
      allowed_scope: scope,
      expires_at: "",
      provider_reference: g.provider_reference ?? "",
      rejected_reason: "",
    });
  }

  return { candidati: raggruppaDuplicati(candidati), scartati };
}

function punteggioRilevanza(c: CandidatoGrezzo, ctx: ContestoMedia): number {
  let p = 40;
  const h = hostDi(c.url);
  if (ctx.official_host && (h === ctx.official_host || h.endsWith(`.${ctx.official_host}`))) p += 35;
  if (ctx.host_ufficiali.some((u) => h === u || h.endsWith(`.${u}`))) p += 25;
  if (c.provider_reference) p += 30;
  const ruolo = stimaRuolo(c);
  if (ruolo !== "unknown") p += 15;
  const testo = `${c.alt ?? ""} ${c.contesto ?? ""}`.toLowerCase();
  if (ctx.nome_attivita && testo.includes(ctx.nome_attivita.toLowerCase())) p += 10;
  return Math.max(0, Math.min(100, p));
}

/**
 * Raggruppa i duplicati: prima per SHA-256 (file identico), poi per hash
 * percettivo (stessa foto ricompressa o riscalata).
 *
 * La deduplicazione per URL identico, che e quella che c'era prima, non
 * intercetta il caso reale: la stessa fotografia arriva dal sito, da
 * Maps e da Instagram con tre URL diversi.
 */
export function raggruppaDuplicati(candidati: MediaCandidate[]): MediaCandidate[] {
  const perSha = new Map<string, string>();
  const conPhash: { gruppo: string; phash: string }[] = [];
  let n = 0;

  for (const c of candidati) {
    if (c.sha256) {
      const g = perSha.get(c.sha256);
      if (g) { c.duplicate_group = g; continue; }
      const nuovo = `g${++n}`;
      perSha.set(c.sha256, nuovo);
      c.duplicate_group = nuovo;
      if (c.perceptual_hash) conPhash.push({ gruppo: nuovo, phash: c.perceptual_hash });
      continue;
    }
    if (c.perceptual_hash) {
      const simile = conPhash.find((x) => distanzaHamming(x.phash, c.perceptual_hash) <= SOGLIA_SIMILI);
      if (simile) { c.duplicate_group = simile.gruppo; continue; }
      const nuovo = `g${++n}`;
      conPhash.push({ gruppo: nuovo, phash: c.perceptual_hash });
      c.duplicate_group = nuovo;
      continue;
    }
    c.duplicate_group = `g${++n}`;
  }
  return candidati;
}

/** La migliore per ogni ruolo, fra i duplicati una sola. Nessuna viene
 *  approvata qui: approvare e un atto di una persona. */
export function selezionaMigliori(candidati: MediaCandidate[]): Record<MediaRole, MediaCandidate | null> {
  const per: Partial<Record<MediaRole, MediaCandidate>> = {};
  const gruppiUsati = new Set<string>();
  const ordinati = [...candidati].sort(
    (a, b) => (b.quality_score + b.relevance_score) - (a.quality_score + a.relevance_score),
  );
  for (const c of ordinati) {
    if (c.allowed_scope === "blocked") continue;
    if (gruppiUsati.has(c.duplicate_group)) continue;
    if (per[c.probable_role]) continue;
    per[c.probable_role] = c;
    gruppiUsati.add(c.duplicate_group);
  }
  const ruoli: MediaRole[] = ["hero","venue","work","product","food","team","owner","logo","exterior","equipment","unknown"];
  const out = {} as Record<MediaRole, MediaCandidate | null>;
  for (const r of ruoli) out[r] = per[r] ?? null;
  return out;
}

export function manifestDa(
  leadId: string,
  esito: EsitoMedia,
): MediaManifest {
  const by_rights = {
    customer_owned: 0, official_public_pending_approval: 0,
    provider_rendered: 0, unknown: 0, forbidden: 0,
  } as Record<RightsStatus, number>;
  for (const c of esito.candidati) by_rights[c.rights_status]++;
  by_rights.forbidden += esito.scartati.length;

  return {
    lead_id: leadId,
    generated_at: new Date().toISOString(),
    candidates: esito.candidati,
    // Vuoto per costruzione: nessuna immagine nasce approvata.
    approved_ids: [],
    rejected: esito.scartati,
    by_rights,
  };
}

export { BLOCKED_IMAGE_HOSTS };
