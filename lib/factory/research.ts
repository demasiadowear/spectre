import { extractFromHtml, visibleText, type Extracted, type ExtractedSite } from "./extract";
import { checkImageUrl } from "./images";
import type { FactBand, FactStatus } from "@/types/factory";

// ============================================================
// research_business — raccolta di informazioni VERIFICABILI.
//
// PRECEDENZA DELLE FONTI (dalla più alla meno affidabile):
//   1. manual        — inserito a mano in SPECTER. Non si sovrascrive MAI.
//   2. lead          — già salvato sul lead (arrivato da Places allo scout).
//   3. places        — Google Places, interrogato ora.
//   4. official_site — sito ufficiale dell'attività.
//   5. structured    — JSON-LD / microdati dentro quel sito.
//   6. linked_page   — pagine ufficiali già collegate al lead.
//   7. public        — altre informazioni pubbliche verificabili.
//
// Una fonte più alta vince sempre. Quando due fonti danno valori
// diversi per lo stesso campo NON si sceglie in silenzio: si tiene il
// valore della fonte più alta e si registra il CONFLITTO, perché un
// telefono sbagliato su una demo è un danno, non un dettaglio.
//
// BANDE: un dato dichiarato dal sito ufficiale o inserito a mano può
// essere `verified`. Una deduzione non è MAI `verified`. Qui dentro non
// c'è alcun modello: si legge quello che c'è scritto, non si indovina.
// ============================================================

export type SourceKind =
  | "manual"
  | "lead"
  | "places"
  | "official_site"
  | "structured"
  | "linked_page"
  | "public";

/** Peso della fonte: più alto vince. */
export const SOURCE_RANK: Record<SourceKind, number> = {
  manual: 100,
  lead: 80,
  places: 70,
  official_site: 60,
  structured: 55,
  linked_page: 40,
  public: 20,
};

/** Banda massima concessa a una fonte. Una deduzione non sale mai a
 *  `verified`, e nessuna fonte può superare il proprio tetto. */
export const SOURCE_MAX_BAND: Record<SourceKind, FactBand> = {
  manual: "verified",
  lead: "verified",
  places: "verified",
  official_site: "verified",
  structured: "verified",
  linked_page: "probable",
  public: "possible",
};

const BAND_RANK: Record<FactBand, number> = { verified: 3, probable: 2, possible: 1 };

/** Abbassa la banda al tetto della fonte. Non la alza mai. */
export function capBand(band: FactBand, source: SourceKind): FactBand {
  const max = SOURCE_MAX_BAND[source];
  return BAND_RANK[band] > BAND_RANK[max] ? max : band;
}

/** Banda dedotta dal METODO di acquisizione dentro una pagina. */
export function bandForMethod(method: Extracted["method"]): FactBand {
  switch (method) {
    // Dichiarato dal sito in forma strutturata: è un'affermazione esplicita.
    case "json_ld":
    case "microdata":
      return "verified";
    // Dichiarato ma in forma libera.
    case "meta":
    case "link":
      return "verified";
    // Riconosciuto con una regex nel testo: plausibile, non dichiarato.
    case "text_pattern":
      return "probable";
    default:
      return "possible";
  }
}

export interface ResearchFact {
  field: string;
  value: string;
  source: SourceKind;
  source_url: string;
  method: string;
  band: FactBand;
  status: FactStatus;
  observed_at: string;
  evidence: Record<string, unknown>;
}

export interface FactConflict {
  field: string;
  /** Valore tenuto (fonte più alta). */
  kept: { value: string; source: SourceKind };
  /** Valori scartati ma non dimenticati. */
  others: { value: string; source: SourceKind }[];
}

export interface ResearchResult {
  lead_id: string;
  facts: ResearchFact[];
  conflicts: FactConflict[];
  /** Fonti effettivamente consultate, con esito. */
  sources_used: { kind: SourceKind; url: string; ok: boolean; detail: string }[];
  /** Campi cercati e non trovati: la demo li segnala come incompleti. */
  missing: string[];
  images: { url: string; alt: string; source: string }[];
  rejected_images: { url: string; reason: string }[];
  schema_types: string[];
}

/** Dati già noti sul lead prima della ricerca. */
export interface KnownLead {
  lead_id: string;
  name?: string;
  category?: string;
  city?: string;
  phone?: string;
  email?: string;
  address?: string;
  website?: string;
  maps_url?: string;
  rating?: number;
  reviews?: number;
  /** Campi inseriti a mano: hanno la precedenza assoluta. */
  manual?: Record<string, string>;
  /** Pagine ufficiali già collegate al lead (social, listino…). */
  linked_pages?: string[];
}

// ----- Normalizzazione per il confronto -------------------------

/** Due telefoni scritti diversamente sono lo stesso telefono. */
export function normalizePhone(v: string): string {
  const digits = (v || "").replace(/[^\d]/g, "");
  // Prefisso internazionale italiano: irrilevante per il confronto.
  return digits.replace(/^0039/, "").replace(/^39(?=\d{9,})/, "");
}

const normalizeEmail = (v: string): string => (v || "").trim().toLowerCase();

/** Confronto "sono lo stesso dato?" tollerante alla punteggiatura. */
export function sameValue(field: string, a: string, b: string): boolean {
  if (field === "phone") return normalizePhone(a) === normalizePhone(b);
  if (field === "email") return normalizeEmail(a) === normalizeEmail(b);
  // Niente flag /u: il tsconfig del repo non fissa un target ES6+.
  // Le lettere accentate italiane sono elencate a mano.
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9àèéìòùäöüç]+/g, " ").replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

// ----- Fusione con precedenza -----------------------------------

interface Candidate {
  field: string;
  value: string;
  source: SourceKind;
  source_url: string;
  method: string;
  band: FactBand;
  evidence: Record<string, unknown>;
}

/** Campi a valore unico: qui un conflitto è un problema da segnalare. */
const SINGLE_VALUE_FIELDS = new Set([
  "name", "category", "phone", "email", "address", "city",
  "postal_code", "description", "rating", "review_count", "price_range",
]);

/**
 * Tiene, per ogni campo a valore unico, il candidato della fonte più
 * alta. I campi multi-valore (servizi, social, orari) passano tutti.
 * I conflitti vengono raccolti, non risolti in silenzio.
 */
export function mergeCandidates(candidates: Candidate[]): {
  facts: ResearchFact[];
  conflicts: FactConflict[];
} {
  const at = new Date().toISOString();
  // Oggetto e non Map: il tsconfig del repo non abilita
  // downlevelIteration, quindi iterare una Map non compila.
  const byField: Record<string, Candidate[]> = {};
  for (const c of candidates) {
    if (!c.value) continue;
    (byField[c.field] ??= []).push(c);
  }

  const facts: ResearchFact[] = [];
  const conflicts: FactConflict[] = [];

  for (const field of Object.keys(byField)) {
    const list = byField[field];
    const sorted = list.slice().sort((a, b) => SOURCE_RANK[b.source] - SOURCE_RANK[a.source]);

    if (!SINGLE_VALUE_FIELDS.has(field)) {
      // Multi-valore: si tengono tutti i valori distinti.
      const seen: string[] = [];
      for (const c of sorted) {
        if (seen.some((s) => sameValue(field, s, c.value))) continue;
        seen.push(c.value);
        facts.push(toFact(c, at));
      }
      continue;
    }

    const winner = sorted[0];
    const disagreeing = sorted
      .slice(1)
      .filter((c) => !sameValue(field, c.value, winner.value));

    if (disagreeing.length > 0) {
      conflicts.push({
        field,
        kept: { value: winner.value, source: winner.source },
        others: disagreeing.map((c) => ({ value: c.value, source: c.source })),
      });
    }

    // Un conflitto non può restare `verified`: se due fonti attendibili
    // dicono cose diverse, qualcosa non torna e va guardato a mano.
    const band: FactBand = disagreeing.length > 0 && winner.band === "verified"
      ? "probable"
      : winner.band;

    facts.push(
      toFact(
        {
          ...winner,
          band,
          evidence: disagreeing.length
            ? { ...winner.evidence, conflitto_con: disagreeing.map((d) => `${d.source}: ${d.value}`) }
            : winner.evidence,
        },
        at,
      ),
    );
  }

  return { facts, conflicts };
}

function toFact(c: Candidate, at: string): ResearchFact {
  const band = capBand(c.band, c.source);
  return {
    field: c.field,
    value: c.value,
    source: c.source,
    source_url: c.source_url,
    method: c.method,
    band,
    // `applied` solo per ciò che è manuale o verificato: tutto il resto
    // resta una PROPOSTA che una persona deve approvare.
    status: c.source === "manual" || band === "verified" ? "applied" : "proposed",
    observed_at: at,
    evidence: c.evidence,
  };
}

// ----- Recupero della pagina ------------------------------------

export const RESEARCH_TIMEOUT_MS = 15_000;
/** Tetto di byte letti per pagina: i dati stanno all'inizio. */
export const MAX_PAGE_BYTES = 800_000;

export interface FetchedPage {
  url: string;
  final_url: string;
  ok: boolean;
  status: number | null;
  html: string;
  error: string;
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  const out: FetchedPage = {
    url,
    final_url: url,
    ok: false,
    status: null,
    html: "",
    error: "",
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // User agent onesto: nessun mascheramento.
        "User-Agent": "SpecterSiteAudit/1.0 (+audit interno AYROMEX)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "it-IT,it;q=0.9",
      },
    });
    out.status = res.status;
    out.final_url = res.url || url;
    if (res.ok) {
      const type = res.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xhtml/i.test(type) && type) {
        out.error = `content-type non HTML: ${type}`;
      } else {
        out.html = (await res.text()).slice(0, MAX_PAGE_BYTES);
        out.ok = out.html.length > 0;
      }
    } else {
      out.error = `HTTP ${res.status}`;
    }
  } catch (err) {
    out.error =
      (err as Error).name === "AbortError"
        ? `timeout oltre ${RESEARCH_TIMEOUT_MS} ms`
        : (err as Error).message;
  } finally {
    clearTimeout(timer);
  }
  return out;
}

/** Pagine interne che di solito contengono contatti e servizi. */
export const CANDIDATE_PATHS = ["/contatti", "/contatto", "/chi-siamo", "/servizi"];

// ----- Servizi ---------------------------------------------------

/** Un nome di servizio plausibile: corto, senza punteggiatura da frase. */
export function looksLikeService(raw: string): boolean {
  const v = (raw || "").trim();
  if (v.length < 3 || v.length > 70) return false;
  if (/[.!?;:]/.test(v)) return false; // è una frase, non un servizio
  if (v.split(/\s+/).length > 7) return false;
  if (/^\d+$/.test(v)) return false;
  // Voci di navigazione: non sono servizi.
  if (/^(?:home|contatti?|chi siamo|about|blog|news|privacy|cookie|login|carrello|menu)$/i.test(v)) {
    return false;
  }
  return true;
}

// ----- Ricerca completa -----------------------------------------

export interface ResearchOptions {
  /** Tetto di pagine scaricate: ogni pagina è tempo e banda. */
  maxPages?: number;
  /** false = non scaricare nulla, usa solo quello che è già noto. */
  fetchSite?: boolean;
}

/** Candidati dai dati già in mano. Nessuna rete. */
export function candidatesFromKnown(lead: KnownLead): Candidate[] {
  const out: Candidate[] = [];
  const push = (
    field: string,
    value: string | undefined,
    source: SourceKind,
    method: string,
    band: FactBand,
    evidence: Record<string, unknown> = {},
  ) => {
    const v = (value ?? "").toString().trim();
    if (v) out.push({ field, value: v, source, source_url: "", method, band, evidence });
  };

  // 1. Manuale: precedenza assoluta, non si sovrascrive mai.
  for (const [field, value] of Object.entries(lead.manual ?? {})) {
    push(field, value, "manual", "inserimento_manuale", "verified", {
      origine: "inserito a mano in SPECTER",
    });
  }

  // 2. Dati già sul lead.
  push("name", lead.name, "lead", "lead_record", "verified");
  push("category", lead.category, "lead", "lead_record", "verified");
  push("city", lead.city, "lead", "lead_record", "verified");
  push("phone", lead.phone, "lead", "lead_record", "verified");
  push("email", lead.email, "lead", "lead_record", "verified");
  push("address", lead.address, "lead", "lead_record", "verified");
  push("website", lead.website, "lead", "lead_record", "verified");
  push("maps_url", lead.maps_url, "lead", "lead_record", "verified");
  if (typeof lead.rating === "number" && lead.rating > 0) {
    push("rating", String(lead.rating), "lead", "lead_record", "verified");
  }
  if (typeof lead.reviews === "number" && lead.reviews > 0) {
    push("review_count", String(lead.reviews), "lead", "lead_record", "verified");
  }
  for (const page of lead.linked_pages ?? []) {
    push("social", page, "linked_page", "collegata_al_lead", "probable");
  }

  return out;
}

/** Candidati estratti da una pagina scaricata. Funzione pura. */
export function candidatesFromPage(
  extracted: ExtractedSite,
  pageUrl: string,
  source: SourceKind,
): Candidate[] {
  const out: Candidate[] = [];
  const add = (field: string, e: Extracted, overrideBand?: FactBand) => {
    out.push({
      field,
      value: e.value,
      source: e.method === "json_ld" || e.method === "microdata" ? "structured" : source,
      source_url: pageUrl,
      method: e.method,
      band: overrideBand ?? bandForMethod(e.method),
      evidence: { prova: e.evidence, pagina: pageUrl },
    });
  };

  for (const e of extracted.name.slice(0, 2)) add("name", e);
  for (const e of extracted.legal_name.slice(0, 1)) add("legal_name", e);
  for (const e of extracted.description.slice(0, 1)) add("description", e);
  for (const e of extracted.category.slice(0, 2)) add("category", e);
  for (const e of extracted.phone.slice(0, 3)) add("phone", e);
  for (const e of extracted.email.slice(0, 3)) add("email", e);
  for (const e of extracted.address.slice(0, 2)) add("address", e);
  for (const e of extracted.city.slice(0, 2)) add("city", e);
  for (const e of extracted.postal_code.slice(0, 1)) add("postal_code", e);
  for (const e of extracted.area_served.slice(0, 4)) add("area_served", e);
  for (const e of extracted.social.slice(0, 6)) add("social", e);
  for (const e of extracted.menu_url.slice(0, 1)) add("menu_url", e);
  for (const e of extracted.booking_url.slice(0, 1)) add("booking_url", e);
  for (const e of extracted.price_range.slice(0, 1)) add("price_range", e);

  // Servizi: solo quelli che sembrano davvero servizi.
  for (const e of extracted.services.filter((s) => looksLikeService(s.value)).slice(0, 12)) {
    add("service", e);
  }

  // Orari: una riga per giorno, come valore unico separato da "\n".
  for (const h of extracted.hours.slice(0, 1)) {
    out.push({
      field: "hours",
      value: h.value.join("\n"),
      source: "structured",
      source_url: pageUrl,
      method: h.method,
      band: bandForMethod(h.method),
      evidence: { prova: h.evidence, pagina: pageUrl },
    });
  }

  // Rating aggregato dichiarato dal sito. Le recensioni individuali no:
  // non sono nostre e non vanno usate come testimonianze.
  for (const r of extracted.rating.slice(0, 1)) {
    out.push({
      field: "rating",
      value: String(r.value),
      source: "structured",
      source_url: pageUrl,
      method: r.method,
      band: bandForMethod(r.method),
      evidence: { prova: r.evidence },
    });
  }
  for (const r of extracted.review_count.slice(0, 1)) {
    out.push({
      field: "review_count",
      value: String(r.value),
      source: "structured",
      source_url: pageUrl,
      method: r.method,
      band: bandForMethod(r.method),
      evidence: { prova: r.evidence },
    });
  }

  return out;
}

/** Campi che una demo vorrebbe avere. Quelli che mancano si dichiarano. */
const WANTED_FIELDS = [
  "name", "category", "phone", "address", "city", "email",
  "hours", "service", "description",
];

/**
 * Ricerca completa su un lead. Scarica il sito ufficiale (se c'è) e
 * qualche pagina interna, estrae dati strutturati, fonde con quello che
 * già si sa rispettando la precedenza, segnala i conflitti.
 */
export async function researchBusiness(
  lead: KnownLead,
  opts: ResearchOptions = {},
): Promise<ResearchResult> {
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 3, 6));
  const sourcesUsed: ResearchResult["sources_used"] = [];
  const candidates: Candidate[] = candidatesFromKnown(lead);
  const imageCandidates: { url: string; alt: string; source: string }[] = [];
  const rejectedImages: { url: string; reason: string }[] = [];
  const schemaTypes: string[] = [];

  sourcesUsed.push({
    kind: "lead",
    url: "",
    ok: true,
    detail: `${candidates.length} campi già noti sul lead`,
  });
  if (lead.manual && Object.keys(lead.manual).length) {
    sourcesUsed.push({
      kind: "manual",
      url: "",
      ok: true,
      detail: `${Object.keys(lead.manual).length} campi inseriti a mano (precedenza assoluta)`,
    });
  }

  const site = (lead.website ?? "").trim();
  if (site && opts.fetchSite !== false) {
    let base: URL | null = null;
    try {
      base = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`);
    } catch {
      sourcesUsed.push({ kind: "official_site", url: site, ok: false, detail: "URL non valido" });
    }

    if (base) {
      const toVisit = [base.toString()];
      for (const p of CANDIDATE_PATHS) {
        if (toVisit.length >= maxPages) break;
        toVisit.push(new URL(p, base).toString());
      }

      for (const url of toVisit.slice(0, maxPages)) {
        const page = await fetchPage(url);
        sourcesUsed.push({
          kind: "official_site",
          url,
          ok: page.ok,
          detail: page.ok ? `${page.html.length} byte letti` : page.error || `HTTP ${page.status}`,
        });
        if (!page.ok) continue;

        const extracted = extractFromHtml(page.html);
        for (const t of extracted.schema_types) {
          if (!schemaTypes.includes(t)) schemaTypes.push(t);
        }
        candidates.push(...candidatesFromPage(extracted, page.final_url, "official_site"));

        // Le immagini si raccolgono ma non diventano fatti: la licenza
        // è un problema diverso dalla verità del dato.
        for (const img of [...extracted.logo, ...extracted.images].slice(0, 12)) {
          const decision = checkImageUrl(img.value);
          if (decision.ok) {
            imageCandidates.push({
              url: decision.url,
              alt: img.evidence.replace(/^alt="|"$/g, ""),
              source: page.final_url,
            });
          } else {
            rejectedImages.push({ url: img.value, reason: decision.reason });
          }
        }

        // Una descrizione sintetica dal testo, solo se il sito non ne
        // dichiara una. NON si copia: si prende la prima frase e la si
        // marca `possible`, quindi resta una proposta da approvare.
        if (extracted.description.length === 0) {
          const text = visibleText(page.html);
          const firstSentence = text.split(/(?<=[.!?])\s/)[0] ?? "";
          if (firstSentence.length > 40 && firstSentence.length < 300) {
            candidates.push({
              field: "description_hint",
              value: firstSentence,
              source: "public",
              source_url: page.final_url,
              method: "text_pattern",
              band: "possible",
              evidence: { nota: "prima frase della pagina, da riscrivere" },
            });
          }
        }
      }
    }
  } else if (!site) {
    sourcesUsed.push({
      kind: "official_site",
      url: "",
      ok: false,
      detail: "nessun sito collegato al lead",
    });
  }

  const { facts, conflicts } = mergeCandidates(candidates);

  const present = new Set(facts.map((f) => f.field));
  const missing = WANTED_FIELDS.filter((f) => !present.has(f));

  return {
    lead_id: lead.lead_id,
    facts,
    conflicts,
    sources_used: sourcesUsed,
    missing,
    images: imageCandidates,
    rejected_images: rejectedImages,
    schema_types: schemaTypes,
  };
}

/** Servizi utilizzabili nella SiteSpec: solo fatti con fonte. */
export function verifiedServices(result: ResearchResult): ResearchFact[] {
  return result.facts.filter(
    (f) => f.field === "service" && f.source_url !== "" && f.band !== "possible",
  );
}

/** Il valore corrente di un campo, se esiste ed è utilizzabile. */
export function factValue(result: ResearchResult, field: string): ResearchFact | null {
  return result.facts.find((f) => f.field === field) ?? null;
}
