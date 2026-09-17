// ============================================================
// Google Places, adapter unico per il collector.
//
// Nel repository ci sono gia quattro chiamate a Places Details con
// quattro FieldMask diverse (hunter, zone, autopilot, detective).
// Questo modulo non ne aggiunge una quinta a caso: chiede TUTTO quello
// che il dossier prevede, in una volta, e lo restituisce gia tipizzato.
//
// Sulle fotografie: Places restituisce un `name` opaco, non un file.
// Quel riferimento si rende tramite l'endpoint del provider, con
// l'attribuzione che il provider impone. Non si scarica e non si copia
// in uno storage: sarebbe trattare una foto altrui come propria. Nel
// dossier entra come `provider_rendered`, che e esattamente cio che e.
// ============================================================

import type { Platform } from "@/types/dossier";

const BASE = "https://places.googleapis.com/v1/places";

/** Tutto quello che serve al dossier, in una chiamata sola. */
const FIELD_MASK_DETTAGLIO = [
  "id",
  "displayName",
  "formattedAddress",
  "shortFormattedAddress",
  "addressComponents",
  "location",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "googleMapsUri",
  "primaryType",
  "primaryTypeDisplayName",
  "types",
  "rating",
  "userRatingCount",
  "businessStatus",
  "regularOpeningHours",
  "photos",
  "editorialSummary",
].join(",");

const FIELD_MASK_RICERCA = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.primaryTypeDisplayName",
  "places.types",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
].join(",");

export interface PlacesFoto {
  /** Riferimento opaco del provider: `places/X/photos/Y`. */
  name: string;
  widthPx: number;
  heightPx: number;
  /** Chi ha scattato, secondo Google. Va mostrato con l'immagine. */
  attributions: string[];
}

export interface PlacesScheda {
  place_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string;
  phone_international: string;
  website: string;
  maps_url: string;
  category: string;
  types: string[];
  rating: number;
  reviews: number;
  /** OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY. */
  business_status: string;
  /** Righe leggibili: "lunedì: 19:00–23:00". */
  hours: string[];
  photos: PlacesFoto[];
  summary: string;
}

export interface EsitoPlaces {
  ok: boolean;
  scheda: PlacesScheda | null;
  /** Candidati quando la ricerca non ha prodotto una corrispondenza sicura. */
  candidati: PlacesScheda[];
  error: string;
  /** Chiamate esterne consumate: entra nel budget del job. */
  calls: number;
  ms: number;
}

function chiave(env: NodeJS.ProcessEnv = process.env): string {
  return (env.GOOGLE_PLACES_API_KEY ?? "").trim();
}

function vuota(): EsitoPlaces {
  return { ok: false, scheda: null, candidati: [], error: "", calls: 0, ms: 0 };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function mappaScheda(p: Record<string, unknown>): PlacesScheda {
  const loc = (p.location ?? {}) as Record<string, unknown>;
  const display = (p.displayName ?? {}) as Record<string, unknown>;
  const tipo = (p.primaryTypeDisplayName ?? {}) as Record<string, unknown>;
  const orari = (p.regularOpeningHours ?? {}) as Record<string, unknown>;
  const sommario = (p.editorialSummary ?? {}) as Record<string, unknown>;
  const foto = Array.isArray(p.photos) ? (p.photos as Record<string, unknown>[]) : [];

  return {
    place_id: str(p.id),
    name: str(display.text),
    address: str(p.formattedAddress) || str(p.shortFormattedAddress),
    lat: num(loc.latitude),
    lng: num(loc.longitude),
    phone: str(p.nationalPhoneNumber),
    phone_international: str(p.internationalPhoneNumber),
    website: str(p.websiteUri),
    maps_url: str(p.googleMapsUri),
    category: str(tipo.text) || str(p.primaryType),
    types: Array.isArray(p.types) ? (p.types as unknown[]).map(str).filter(Boolean) : [],
    rating: num(p.rating),
    reviews: num(p.userRatingCount),
    business_status: str(p.businessStatus),
    hours: Array.isArray(orari.weekdayDescriptions)
      ? (orari.weekdayDescriptions as unknown[]).map(str).filter(Boolean)
      : [],
    photos: foto.map((f) => ({
      name: str(f.name),
      widthPx: num(f.widthPx),
      heightPx: num(f.heightPx),
      attributions: Array.isArray(f.authorAttributions)
        ? (f.authorAttributions as Record<string, unknown>[])
            .map((a) => str(a.displayName)).filter(Boolean)
        : [],
    })).filter((f) => f.name),
    summary: str(sommario.text),
  };
}

/** Scheda completa a partire da un place_id gia noto. */
export async function dettaglioPlace(
  placeId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<EsitoPlaces> {
  const t0 = Date.now();
  const out = vuota();
  const key = chiave(env);
  if (!key) { out.error = "GOOGLE_PLACES_API_KEY non configurata"; return out; }
  if (!placeId) { out.error = "place_id mancante"; return out; }

  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK_DETTAGLIO,
        "Accept-Language": "it",
      },
    });
    out.calls = 1;
    out.ms = Date.now() - t0;
    if (!res.ok) {
      // Il corpo di un errore Places puo contenere la chiave in chiaro
      // nell'eco della richiesta: si tiene solo lo stato.
      out.error = `Places Details HTTP ${res.status}`;
      return out;
    }
    const j = (await res.json()) as Record<string, unknown>;
    out.scheda = mappaScheda(j);
    out.ok = Boolean(out.scheda.place_id);
    return out;
  } catch (e) {
    out.ms = Date.now() - t0;
    out.error = `Places Details: ${(e as Error).message}`;
    return out;
  }
}

/** Normalizza per il confronto: accenti, punteggiatura e forme
 *  societarie via, cosi "Bar Centrale S.r.l." e "bar centrale" combaciano. */
export function normalizzaNome(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|di [a-z]+ & c\.?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Ricerca testuale. Restituisce una scheda SOLO se la corrispondenza e
 *  sicura; altrimenti consegna i candidati e lascia decidere a valle.
 *  Due attivita omonime nella stessa citta sono il caso normale, non
 *  l'eccezione, e sceglierne una a caso e il modo piu rapido di
 *  costruire un dossier sbagliato. */
export async function cercaPlace(
  query: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<EsitoPlaces> {
  const t0 = Date.now();
  const out = vuota();
  const key = chiave(env);
  if (!key) { out.error = "GOOGLE_PLACES_API_KEY non configurata"; return out; }
  if (!query.trim()) { out.error = "query vuota"; return out; }

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK_RICERCA,
        "Accept-Language": "it",
      },
      body: JSON.stringify({ textQuery: query, languageCode: "it", maxResultCount: 10 }),
    });
    out.calls = 1;
    out.ms = Date.now() - t0;
    if (!res.ok) { out.error = `Places Search HTTP ${res.status}`; return out; }
    const j = (await res.json()) as Record<string, unknown>;
    const lista = Array.isArray(j.places) ? (j.places as Record<string, unknown>[]) : [];
    out.candidati = lista.map(mappaScheda).filter((s) => s.place_id);
    out.ok = out.candidati.length > 0;
    return out;
  } catch (e) {
    out.ms = Date.now() - t0;
    out.error = `Places Search: ${(e as Error).message}`;
    return out;
  }
}

export interface SegnaliCorrispondenza {
  nome: boolean;
  telefono: boolean;
  indirizzo: boolean;
  coordinate: boolean;
}

export interface Corrispondenza {
  scheda: PlacesScheda;
  punteggio: number;
  segnali: SegnaliCorrispondenza;
  sicura: boolean;
}

const soloCifre = (s: string): string => (s || "").replace(/\D/g, "");

/** Due telefoni combaciano se le ultime nove cifre coincidono: prefissi
 *  internazionali e zeri iniziali sono scritti in mille modi. */
export function stessoTelefono(a: string, b: string): boolean {
  const x = soloCifre(a), y = soloCifre(b);
  if (x.length < 6 || y.length < 6) return false;
  const n = Math.min(9, x.length, y.length);
  return x.slice(-n) === y.slice(-n);
}

/** Distanza in metri fra due coordinate (formula dell'emisenoverso). */
export function distanzaMetri(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat), dLng = r(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface LeadNoto {
  name: string;
  city?: string;
  address?: string;
  phone?: string;
  lat?: number;
  lng?: number;
  place_id?: string;
}

/**
 * Sceglie fra i candidati usando piu segnali, non il nome.
 *
 * Un telefono che coincide vale piu di un nome identico: gli omonimi
 * condividono il nome per definizione, il numero no. Per dichiarare
 * SICURA una corrispondenza servono almeno due segnali, e il nome da
 * solo non basta mai.
 */
export function risolviCorrispondenza(lead: LeadNoto, candidati: PlacesScheda[]): {
  scelta: Corrispondenza | null;
  tutte: Corrispondenza[];
  ambigua: boolean;
  motivo: string;
} {
  const nomeLead = normalizzaNome(lead.name);
  const valutate: Corrispondenza[] = candidati.map((s) => {
    const segnali: SegnaliCorrispondenza = {
      nome: Boolean(nomeLead) && normalizzaNome(s.name) === nomeLead,
      telefono: stessoTelefono(lead.phone ?? "", s.phone),
      indirizzo: Boolean(lead.address) && normalizzaNome(s.address).includes(normalizzaNome(lead.address ?? "")),
      coordinate:
        typeof lead.lat === "number" && typeof lead.lng === "number" &&
        lead.lat !== 0 && lead.lng !== 0 && s.lat !== 0 &&
        distanzaMetri(lead.lat, lead.lng, s.lat, s.lng) < 150,
    };
    // Il telefono pesa il doppio del nome: e l'unico che gli omonimi
    // non condividono.
    const punteggio =
      (segnali.telefono ? 50 : 0) + (segnali.coordinate ? 30 : 0) +
      (segnali.indirizzo ? 20 : 0) + (segnali.nome ? 25 : 0);
    const forti = [segnali.telefono, segnali.coordinate, segnali.indirizzo].filter(Boolean).length;
    return { scheda: s, punteggio, segnali, sicura: forti >= 1 && punteggio >= 50 };
  }).sort((a, b) => b.punteggio - a.punteggio);

  if (valutate.length === 0) return { scelta: null, tutte: [], ambigua: false, motivo: "nessun candidato" };

  const prima = valutate[0];
  const seconda = valutate[1];

  if (!prima.sicura) {
    return {
      scelta: null, tutte: valutate, ambigua: true,
      motivo: "nessun candidato raggiunge due segnali concordi: il nome da solo non basta",
    };
  }
  // Due candidati a pari merito: omonimi nella stessa citta. Non si tira
  // a indovinare.
  if (seconda && seconda.punteggio === prima.punteggio) {
    return {
      scelta: null, tutte: valutate, ambigua: true,
      motivo: `due candidati con lo stesso punteggio (${prima.punteggio}): probabili omonimi, serve una decisione umana`,
    };
  }
  return { scelta: prima, tutte: valutate, ambigua: false, motivo: "" };
}

/** URL di rendering di una foto Places. Si usa COSI, col riferimento
 *  del provider: non si scarica il file e non lo si copia altrove. */
export function urlFotoProvider(riferimento: string, maxPx = 1200): string {
  return `${BASE.replace("/v1/places", "")}/v1/${riferimento}/media?maxWidthPx=${maxPx}`;
}

export const PIATTAFORMA_PLACES: Platform = "google_maps";
