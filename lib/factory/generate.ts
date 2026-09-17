import { geminiJSON } from "@/lib/gemini";
import {
  SPEC_VERSION,
  factOf,
  findBannedClaims,
  neutralCopy,
  sanitizeSiteSpec,
  type SanitizeResult,
} from "./sitespec";
import type {
  Fact,
  SiteCopy,
  SiteImage,
  SitePalette,
  SiteSection,
  SiteSpec,
} from "@/types/factory";

// ============================================================
// Generazione della SiteSpec.
//
// DIVISIONE DEI POTERI — è il punto centrale di tutto il modulo:
//
//   FATTI      → assemblati in CODICE dalle fonti verificate
//                (Google Places, fatti approvati a mano). Il modello
//                non li vede come campi da riempire e non può
//                aggiungerne: qualsiasi cosa produca fuori dai campi
//                di copy viene ignorata alla radice.
//   COPY       → l'unica cosa che chiede a Gemini: titoli di sezione
//                e frasi di presentazione. Nessun numero, nessun
//                prezzo, nessuna promessa.
//
// Il risultato passa poi da sanitizeSiteSpec(), che è la rete di
// sicurezza: se il modello infila comunque un'affermazione fattuale
// nel copy, quel testo viene sostituito con copy neutro e la
// rimozione finisce in `dropped[]` (visibile nel QA e in timeline).
// ============================================================

/** Dati VERIFICATI in ingresso: ognuno già con la sua fonte. */
export interface GenerationInput {
  lead_id: string;
  name: Fact<string>;
  category: Fact<string>;
  address?: Fact<string>;
  phone?: Fact<string>;
  email?: Fact<string>;
  maps_url?: Fact<string>;
  hours?: Fact<string[]>;
  rating?: Fact<number>;
  reviews_count?: Fact<number>;
  /** Servizi con fonte (mai dedotti dalla categoria). */
  services?: Fact<string>[];
  city?: string;
}

/** La sola forma che il modello è autorizzato a restituire. */
interface CopyDraft {
  hero_title?: unknown;
  hero_subtitle?: unknown;
  about?: unknown;
  section_titles?: unknown;
  seo_title?: unknown;
  seo_description?: unknown;
}

const PALETTES: Record<string, SitePalette> = {
  ristorazione: { primary: "#E8743B", accent: "#F5C26B", bg: "#14100E", fg: "#F6F1EC" },
  bellezza: { primary: "#D8709B", accent: "#F0C4D8", bg: "#161014", fg: "#F8F2F5" },
  salute: { primary: "#3FA7A0", accent: "#8FD6D1", bg: "#0E1616", fg: "#EEF7F6" },
  casa: { primary: "#4C7CC4", accent: "#9BBCE8", bg: "#0E1218", fg: "#EEF2F8" },
  auto: { primary: "#C4453F", accent: "#E89A96", bg: "#161111", fg: "#F7F0EF" },
  default: { primary: "#2FB4C9", accent: "#7FD9E6", bg: "#0D1316", fg: "#EDF6F8" },
};

/** Palette dalla categoria: deterministica, mai scelta dal modello. */
export function paletteFor(category: string): SitePalette {
  const c = (category || "").toLowerCase();
  if (/ristor|pizz|bar|caff|trattor|pub|gelat|pasticc/.test(c)) return PALETTES.ristorazione;
  if (/parrucch|estet|barb|beauty|nail|centro benessere|spa/.test(c)) return PALETTES.bellezza;
  if (/dentist|medic|fisioterap|studio|farmac|veterinar|psicolog/.test(c)) return PALETTES.salute;
  if (/idraul|elettric|edil|fabbr|serrament|imbianch|giardin|falegn/.test(c)) return PALETTES.casa;
  if (/autoffic|carrozzer|gommist|autolav|concessionar/.test(c)) return PALETTES.auto;
  return PALETTES.default;
}

const SYSTEM_PROMPT = `Sei un copywriter italiano per micro-imprese locali.

Scrivi SOLO testo di presentazione neutro. È VIETATO, senza eccezioni:
- prezzi, tariffe, listini, sconti, promozioni, offerte
- anni di esperienza, date di fondazione, "dal 19xx"
- certificazioni, premi, riconoscimenti, marchi
- testimonianze, citazioni di clienti
- numero di dipendenti, nomi di persone, composizione del team
- risultati, numeri, percentuali, statistiche
- garanzie ("garantito", "assicurato", "il migliore", "leader", "numero 1")
- superlativi assoluti e affermazioni non verificabili

Non inventare servizi: usa solo quelli che ti vengono forniti.
Non inventare indirizzi, telefoni, orari, email: non li scrivere affatto.
Tono: sobrio, concreto, in italiano naturale. Nessun em-dash.
Frasi brevi. Nessun punto esclamativo.

Rispondi SOLO con questo JSON:
{
  "hero_title": "una riga, max 70 caratteri",
  "hero_subtitle": "una riga, max 110 caratteri",
  "about": "2-3 frasi, max 400 caratteri",
  "section_titles": { "services": "...", "about": "...", "contact": "..." },
  "seo_title": "max 60 caratteri",
  "seo_description": "max 155 caratteri"
}`;

const asText = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** Copy accettato solo se privo di affermazioni fattuali. */
function acceptCopy(draft: CopyDraft | null, name: string, category: string): SiteCopy {
  const fallback = neutralCopy(name, category);
  if (!draft) return fallback;
  const candidate: SiteCopy = {
    hero_title: asText(draft.hero_title, 90) || fallback.hero_title,
    hero_subtitle: asText(draft.hero_subtitle, 140) || fallback.hero_subtitle,
    about: asText(draft.about, 500) || fallback.about,
  };
  // Controllo campo per campo: un about con un prezzo non deve
  // buttare via anche un hero pulito.
  return {
    hero_title: findBannedClaims(candidate.hero_title).length
      ? fallback.hero_title
      : candidate.hero_title,
    hero_subtitle: findBannedClaims(candidate.hero_subtitle).length
      ? fallback.hero_subtitle
      : candidate.hero_subtitle,
    about: findBannedClaims(candidate.about).length ? fallback.about : candidate.about,
  };
}

function sectionTitle(draft: CopyDraft | null, key: string, fallback: string): string {
  const raw = (draft?.section_titles ?? null) as Record<string, unknown> | null;
  const value = raw && typeof raw === "object" ? asText(raw[key], 60) : "";
  if (!value || findBannedClaims(value).length) return fallback;
  return value;
}

/** Assembla la SiteSpec: i fatti dal codice, il copy dal modello. */
export async function generateSiteSpec(
  input: GenerationInput,
): Promise<{ result: SanitizeResult; used_ai: boolean }> {
  const name = input.name.value;
  const category = input.category.value;
  const services = (input.services ?? []).slice(0, 8);

  // Al modello arrivano SOLO nome, categoria, città e i nomi dei
  // servizi già verificati. Niente telefono, niente indirizzo, niente
  // orari: dati che non può vedere non può nemmeno storpiare.
  const userPrompt = [
    `Attività: ${name}`,
    `Categoria: ${category}`,
    input.city ? `Città: ${input.city}` : "",
    services.length
      ? `Servizi verificati (usa solo questi): ${services.map((s) => s.value).join(", ")}`
      : "Servizi: non disponibili, resta generico sulla categoria.",
  ]
    .filter(Boolean)
    .join("\n");

  const draft = await geminiJSON<CopyDraft>(SYSTEM_PROMPT, userPrompt, {
    complex: true,
    temperature: 0.6,
    maxOutputTokens: 900,
  });

  const copy = acceptCopy(draft, name, category);

  const sections: SiteSection[] = [
    { kind: "about", title: sectionTitle(draft, "about", "Chi siamo"), body: copy.about },
  ];
  if (services.length) {
    sections.unshift({ kind: "services", title: sectionTitle(draft, "services", "Servizi") });
  }
  sections.push({ kind: "contact", title: sectionTitle(draft, "contact", "Contatti") });
  if (input.hours) sections.push({ kind: "hours", title: "Orari" });
  if (input.maps_url) sections.push({ kind: "map", title: "Dove siamo" });

  // CTA: agganciata a un contatto verificato. sanitizeSiteSpec la
  // degrada comunque se il dato non regge.
  const ctaKind = input.phone ? "call" : input.maps_url ? "maps" : "email";
  const ctaTarget = input.phone?.value ?? input.maps_url?.value ?? input.email?.value ?? "";

  // Nessuna immagine di terzi: il renderer disegna un segnaposto.
  // Pubblicare la foto Google di un locale su un dominio nostro
  // sarebbe un problema di licenza, non un dettaglio estetico.
  const images: SiteImage[] = [
    { url: "", alt: `${name} — immagine di presentazione`, placeholder: true, source: "renderer" },
  ];

  const seoTitleRaw = asText(draft?.seo_title, 60);
  const seoDescRaw = asText(draft?.seo_description, 155);

  const spec: SiteSpec = {
    spec_version: SPEC_VERSION,
    lead_id: input.lead_id,
    business: {
      name: input.name,
      category: input.category,
      address: input.address,
      phone: input.phone,
      email: input.email,
      maps_url: input.maps_url,
      hours: input.hours,
    },
    reviews:
      input.rating && input.reviews_count
        ? { rating: input.rating, count: input.reviews_count }
        : undefined,
    services,
    sections,
    cta: {
      label: ctaKind === "call" ? "Chiama" : ctaKind === "maps" ? "Come arrivare" : "Scrivi",
      kind: ctaKind,
      target: ctaTarget,
    },
    palette: paletteFor(category),
    images,
    seo: {
      title:
        seoTitleRaw && !findBannedClaims(seoTitleRaw).length
          ? seoTitleRaw
          : `${name} — ${category}`,
      description:
        seoDescRaw && !findBannedClaims(seoDescRaw).length ? seoDescRaw : copy.hero_subtitle,
    },
    copy,
    incomplete: [],
    sources: [],
    generated_at: new Date().toISOString(),
  };

  return { result: sanitizeSiteSpec(spec), used_ai: draft !== null };
}

/** Costruisce i Fact di partenza da una riga Places già salvata. */
export function factsFromPlaces(row: {
  lead_id: string;
  name: string;
  category: string;
  address?: string;
  phone?: string;
  maps_url?: string;
  rating?: number;
  reviews?: number;
  city?: string;
  observed_at?: string;
}): GenerationInput {
  const at = row.observed_at ?? new Date().toISOString();
  const f = <T,>(v: T) => factOf<T>(v, "google_places", "places_search", "verified", at);
  return {
    lead_id: row.lead_id,
    name: f(row.name),
    category: f(row.category),
    address: row.address ? f(row.address) : undefined,
    phone: row.phone ? f(row.phone) : undefined,
    maps_url: row.maps_url ? f(row.maps_url) : undefined,
    rating: typeof row.rating === "number" && row.rating > 0 ? f(row.rating) : undefined,
    reviews_count: typeof row.reviews === "number" && row.reviews > 0 ? f(row.reviews) : undefined,
    city: row.city,
  };
}
