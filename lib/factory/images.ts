import type { SiteImage } from "@/types/factory";

// ============================================================
// Politica immagini.
//
// Due problemi distinti, spesso confusi:
//  1. SICUREZZA — un URL immagine finisce in un attributo src. Schemi
//     come javascript: o data: non devono passare mai.
//  2. LICENZA — una foto non è utilizzabile solo perché è raggiungibile.
//     Le foto caricate dagli utenti nelle recensioni NON sono
//     dell'attività e non si toccano; le foto del sito ufficiale si
//     usano come riferimento in una demo privata, conservando la fonte.
//
// L'assenza di immagini non blocca mai la generazione: si disegna un
// segnaposto coerente con la categoria.
// ============================================================

/** Host da cui NON si prendono immagini: contenuti caricati da utenti. */
export const BLOCKED_IMAGE_HOSTS = [
  // Foto delle recensioni Google: sono degli utenti, non dell'attività.
  "lh3.googleusercontent.com",
  "lh4.googleusercontent.com",
  "lh5.googleusercontent.com",
  "lh6.googleusercontent.com",
  "streetviewpixels-pa.googleapis.com",
  "maps.gstatic.com",
  // Aggregatori: le foto sono dei recensori o della piattaforma.
  "media-cdn.tripadvisor.com",
  "dynamic-media-cdn.tripadvisor.com",
  "images.deliveryhero.io",
  "d1ralsognjng37.cloudfront.net",
  "img.static-af.com",
  "media.thefork.com",
];

/** Estensioni servibili come immagine. Niente SVG da terzi: può
 *  contenere script, e un SVG ostile su un nostro dominio è un XSS. */
const ALLOWED_EXT = /\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i;

export type ImageRejection =
  | "schema_non_sicuro"
  | "host_bloccato"
  | "estensione_non_ammessa"
  | "url_non_valido"
  | "tracking_pixel";

export interface ImageDecision {
  ok: boolean;
  url: string;
  host: string;
  reason: ImageRejection | "";
}

/** Un URL immagine è utilizzabile? Deterministico, nessuna rete. */
export function checkImageUrl(raw: string): ImageDecision {
  const url = (raw || "").trim();
  const no = (reason: ImageRejection): ImageDecision => ({ ok: false, url, host: "", reason });

  if (!url) return no("url_non_valido");
  // Prima di qualsiasi parsing: gli schemi pericolosi si bloccano sulla
  // stringa grezza, perché new URL() accetta javascript: senza batter ciglio.
  if (/^\s*(?:javascript|data|vbscript|file|blob):/i.test(url)) return no("schema_non_sicuro");

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return no("url_non_valido");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return no("schema_non_sicuro");

  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_IMAGE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return { ok: false, url, host, reason: "host_bloccato" };
  }
  if (!ALLOWED_EXT.test(parsed.pathname)) {
    return { ok: false, url, host, reason: "estensione_non_ammessa" };
  }
  // Pixel di tracciamento travestiti da immagine.
  if (/\b(?:pixel|beacon|1x1|spacer|blank)\b/i.test(parsed.pathname)) {
    return { ok: false, url, host, reason: "tracking_pixel" };
  }

  return { ok: true, url: parsed.toString(), host, reason: "" };
}

/** Segnaposto coerente con la categoria: mai una foto altrui per riempire. */
export function placeholderFor(category: string, name: string): SiteImage {
  return {
    url: "",
    alt: `${name} — ${category || "attività"}`,
    placeholder: true,
    source: "renderer",
  };
}

export interface ImageCandidate {
  url: string;
  alt?: string;
  /** Da dove viene: il sito ufficiale è l'unica fonte che usiamo. */
  source: string;
}

export interface ImageSelection {
  images: SiteImage[];
  rejected: { url: string; reason: ImageRejection }[];
}

/**
 * Seleziona le immagini utilizzabili. Tiene solo quelle del sito
 * ufficiale del lead: un'immagine trovata altrove non ha una licenza
 * che possiamo vantare, e una demo con la foto sbagliata è peggio di
 * una demo con un segnaposto.
 */
export function selectImages(
  candidates: ImageCandidate[],
  opts: { category: string; name: string; officialHost?: string; max?: number },
): ImageSelection {
  const rejected: ImageSelection["rejected"] = [];
  const images: SiteImage[] = [];
  const max = opts.max ?? 4;
  const official = (opts.officialHost ?? "").toLowerCase().replace(/^www\./, "");

  for (const c of candidates) {
    if (images.length >= max) break;
    const decision = checkImageUrl(c.url);
    if (!decision.ok) {
      rejected.push({ url: c.url, reason: decision.reason as ImageRejection });
      continue;
    }
    // Solo il dominio ufficiale (o un suo sottodominio/CDN evidente).
    if (official) {
      const host = decision.host.replace(/^www\./, "");
      const sameSite = host === official || host.endsWith(`.${official}`);
      if (!sameSite) {
        rejected.push({ url: c.url, reason: "host_bloccato" });
        continue;
      }
    }
    if (images.some((i) => i.url === decision.url)) continue;
    images.push({
      url: decision.url,
      alt: (c.alt || `${opts.name} — ${opts.category}`).slice(0, 120),
      placeholder: false,
      source: c.source,
    });
  }

  // Nessuna immagine utilizzabile non è un errore: è il caso normale.
  if (images.length === 0) images.push(placeholderFor(opts.category, opts.name));

  return { images, rejected };
}
