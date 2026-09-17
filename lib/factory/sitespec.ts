import type {
  CtaKind,
  Fact,
  FactBand,
  SiteCopy,
  SiteSpec,
  ValidationResult,
} from "@/types/factory";

// ============================================================
// SiteSpec — schema, validazione e sanitizzazione anti-allucinazione.
//
// Due livelli di difesa:
//  1. validateSiteSpec(): struttura corretta (contratto stile Zod, zero
//     dipendenze, coerente con le convenzioni del repo).
//  2. sanitizeSiteSpec(): REGOLA COMMERCIALE — ogni fatto senza fonte
//     viene RIMOSSO, e il copy creativo che contiene affermazioni
//     fattuali (prezzi, team, certificazioni, risultati…) viene
//     sostituito con copy neutro. Ciò che non è tracciabile non si
//     pubblica.
// ============================================================

export const SPEC_VERSION = 1;

const BANDS: FactBand[] = ["verified", "probable", "possible"];

/** Affermazioni che il modello NON può produrre senza una fonte. */
export const BANNED_CLAIM_PATTERNS: { code: string; re: RegExp }[] = [
  { code: "price", re: /(?:€\s?\d|\b\d+[.,]?\d*\s?(?:euro|eur)\b|\bprezz\w*|\btariff\w*|\blistino\b)/i },
  { code: "discount", re: /\b(?:scont\w*|promozion\w*|offert[ae]\s+special\w*|saldo|omaggio)\b/i },
  { code: "experience", re: /\b\d+\s*(?:anni|anno)\s+(?:di\s+)?(?:esperienza|attivit[àa]|settore)\b/i },
  { code: "since", re: /\b(?:dal|dai)\s+(?:19|20)\d{2}\b/i },
  { code: "certification", re: /\b(?:certificat\w*|accreditat\w*|abilitat\w*|iso\s?\d{3,}|premiat\w*|award)\b/i },
  // "dicono di noi" era troppo strettp: la forma che un modello produce
  // davvero è "i nostri clienti dicono che…".
  { code: "testimonial", re: /\b(?:testimonianz\w*|recension\w*\s+entusiast\w*|(?:client\w*|ospit\w*|pazient\w*)\s+(?:dicono|raccontano|confermano)|dicono di noi|parlano di noi)\b/i },
  { code: "team", re: /\b(?:il nostro team|lo staff di|\d+\s*(?:collaborator\w*|dipendent\w*|professionist\w*))\b/i },
  { code: "results", re: /\b(?:oltre\s+)?\d+\s*(?:client\w*|progett\w*|lavor\w*|intervent\w*)(?:\s+(?:soddisfatt\w*|complet\w*|realizzat\w*|segui\w*))?\b/i },
  // Qualsiasi flessione di "garantire": "garantita", "garantito",
  // "garantiamo" — non solo le tre forme che avevo elencato a mano.
  { code: "guarantee", re: /\b(?:garant(?:iamo|ito|ita|iti|ite|isce|zia)|soddisfatti\s+o\s+rimborsati)\b/i },
  { code: "superlative", re: /\b(?:(?:il|lo|la|i|gli|le)\s+miglior\w*|leader\s+(?:del|nel|di)|n\.?\s?1\b|numero\s+uno|unic\w*\s+(?:nel|in|del)\s+)/i },
];

/** Campi la cui invenzione è vietata: pubblicabili solo come Fact. */
export const SOURCED_ONLY_FIELDS = [
  "business.phone",
  "business.address",
  "business.email",
  "business.hours",
  "services",
  "reviews",
] as const;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isNonEmptyStr = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

/** Costruisce un Fact tracciabile. */
export function factOf<T>(
  value: T,
  source: string,
  method: string,
  band: FactBand = "verified",
  observedAt = new Date().toISOString(),
): Fact<T> {
  return { value, source, method, observed_at: observedAt, band };
}

/** Un Fact è pubblicabile solo se ha valore, fonte e timestamp. */
export function isPublishableFact(v: unknown): v is Fact<unknown> {
  if (!isObj(v)) return false;
  if (!isNonEmptyStr(v.source)) return false;
  if (!isNonEmptyStr(v.method)) return false;
  if (!isNonEmptyStr(v.observed_at)) return false;
  if (!BANDS.includes(v.band as FactBand)) return false;
  const val = v.value;
  if (val == null) return false;
  if (typeof val === "string" && val.trim() === "") return false;
  if (Array.isArray(val) && val.length === 0) return false;
  if (typeof val === "number" && !Number.isFinite(val)) return false;
  return true;
}

/** Restituisce i codici delle affermazioni vietate trovate nel testo. */
export function findBannedClaims(text: string): string[] {
  if (!text) return [];
  return BANNED_CLAIM_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.code);
}

/** Copy neutro: descrive senza affermare nulla di non verificato. */
export function neutralCopy(name: string, category: string): SiteCopy {
  const cat = (category || "attività").toLowerCase();
  return {
    hero_title: name || "La tua attività",
    hero_subtitle: `${cat.charAt(0).toUpperCase()}${cat.slice(1)}`,
    about: `${name || "L'attività"} è presente sul territorio. Contattaci per informazioni e disponibilità.`,
  };
}

// ----- Validazione strutturale --------------------------------------

/** Valida la forma della SiteSpec. Non giudica la provenienza: quella è
 *  competenza di sanitizeSiteSpec(). */
export function validateSiteSpec(input: unknown): ValidationResult<SiteSpec> {
  const errors: string[] = [];
  if (!isObj(input)) {
    return { ok: false, value: null, errors: ["spec non è un oggetto"] };
  }

  if (typeof input.spec_version !== "number") errors.push("spec_version mancante");
  if (!isNonEmptyStr(input.lead_id)) errors.push("lead_id mancante");

  const biz = input.business;
  if (!isObj(biz)) {
    errors.push("business mancante");
  } else {
    if (!isPublishableFact(biz.name)) errors.push("business.name non è un Fact valido");
    if (!isPublishableFact(biz.category)) errors.push("business.category non è un Fact valido");
    for (const k of ["address", "phone", "email", "maps_url", "hours"]) {
      if (biz[k] !== undefined && !isPublishableFact(biz[k])) {
        errors.push(`business.${k} presente ma non è un Fact valido`);
      }
    }
  }

  if (!Array.isArray(input.services)) errors.push("services deve essere un array");
  if (!Array.isArray(input.sections)) errors.push("sections deve essere un array");
  if (!Array.isArray(input.images)) errors.push("images deve essere un array");
  if (!Array.isArray(input.incomplete)) errors.push("incomplete deve essere un array");
  if (!Array.isArray(input.sources)) errors.push("sources deve essere un array");

  const cta = input.cta;
  if (!isObj(cta) || !isNonEmptyStr(cta.label) || !isNonEmptyStr(cta.kind)) {
    errors.push("cta incompleta");
  }

  const pal = input.palette;
  if (!isObj(pal) || !isNonEmptyStr(pal.primary) || !isNonEmptyStr(pal.bg)) {
    errors.push("palette incompleta");
  }

  const seo = input.seo;
  if (!isObj(seo) || !isNonEmptyStr(seo.title) || !isNonEmptyStr(seo.description)) {
    errors.push("seo incompleta");
  }

  const copy = input.copy;
  if (!isObj(copy) || !isNonEmptyStr(copy.hero_title)) {
    errors.push("copy incompleto");
  }

  if (input.reviews !== undefined) {
    const r = input.reviews;
    if (!isObj(r) || !isPublishableFact(r.rating) || !isPublishableFact(r.count)) {
      errors.push("reviews presente ma non valido");
    }
  }

  if (errors.length > 0) return { ok: false, value: null, errors };
  return { ok: true, value: input as unknown as SiteSpec, errors: [] };
}

// ----- Sanitizzazione anti-allucinazione -----------------------------

export interface SanitizeResult {
  spec: SiteSpec;
  /** Cosa è stato rimosso e perché — finisce nel report QA e in timeline. */
  dropped: { field: string; reason: string }[];
}

/**
 * Applica le regole commerciali:
 *  - i Fact senza fonte valida vengono RIMOSSI (mai pubblicati);
 *  - i servizi senza fonte vengono rimossi;
 *  - il copy creativo con affermazioni fattuali viene sostituito con copy
 *    neutro;
 *  - la CTA deve puntare a un dato verificato, altrimenti degrada;
 *  - le immagini senza fonte diventano placeholder;
 *  - `incomplete` viene ricalcolato.
 */
export function sanitizeSiteSpec(input: SiteSpec): SanitizeResult {
  const dropped: { field: string; reason: string }[] = [];
  // copia difensiva: non mutiamo l'input del chiamante
  const spec: SiteSpec = JSON.parse(JSON.stringify(input)) as SiteSpec;

  const name = isPublishableFact(spec.business?.name)
    ? String(spec.business.name.value)
    : "";
  const category = isPublishableFact(spec.business?.category)
    ? String(spec.business.category.value)
    : "";

  // 1. Fact opzionali dell'anagrafica: senza fonte → via.
  for (const k of ["address", "phone", "email", "maps_url", "hours"] as const) {
    const f = spec.business?.[k];
    if (f !== undefined && !isPublishableFact(f)) {
      delete spec.business[k];
      dropped.push({ field: `business.${k}`, reason: "fatto senza fonte valida" });
    }
  }

  // 2. Recensioni: solo con fonte.
  if (spec.reviews && (!isPublishableFact(spec.reviews.rating) || !isPublishableFact(spec.reviews.count))) {
    delete spec.reviews;
    dropped.push({ field: "reviews", reason: "recensioni senza fonte valida" });
  }

  // 3. Servizi: ognuno deve avere fonte. Mai inventati.
  const services = Array.isArray(spec.services) ? spec.services : [];
  const keptServices = services.filter((s) => isPublishableFact(s));
  if (keptServices.length !== services.length) {
    dropped.push({
      field: "services",
      reason: `${services.length - keptServices.length} servizi senza fonte rimossi`,
    });
  }
  spec.services = keptServices;

  // 4. Copy creativo: nessuna affermazione fattuale.
  const safeCopy = neutralCopy(name, category);
  const copy: SiteCopy = { ...safeCopy, ...(spec.copy ?? {}) };
  for (const key of ["hero_title", "hero_subtitle", "about"] as const) {
    const claims = findBannedClaims(copy[key] ?? "");
    if (claims.length > 0) {
      copy[key] = safeCopy[key];
      dropped.push({
        field: `copy.${key}`,
        reason: `affermazioni non verificabili rimosse (${claims.join(", ")})`,
      });
    }
    if (!isNonEmptyStr(copy[key])) copy[key] = safeCopy[key];
  }
  spec.copy = copy;

  // 5. Sezioni: titoli/corpi ripuliti dalle stesse affermazioni.
  spec.sections = (Array.isArray(spec.sections) ? spec.sections : []).map((sec) => {
    const out = { ...sec };
    for (const key of ["title", "body"] as const) {
      const v = out[key];
      if (typeof v === "string" && findBannedClaims(v).length > 0) {
        dropped.push({ field: `sections.${sec.kind}.${key}`, reason: "affermazioni non verificabili rimosse" });
        if (key === "title") out.title = sec.kind === "services" ? "Servizi" : "Informazioni";
        else out.body = "";
      }
    }
    return out;
  });

  // 6. SEO: niente claim nel title/description.
  const seo = spec.seo ?? { title: "", description: "" };
  if (findBannedClaims(seo.title).length > 0) {
    seo.title = [name, category].filter(Boolean).join(" · ") || "Sito";
    dropped.push({ field: "seo.title", reason: "affermazioni non verificabili rimosse" });
  }
  if (findBannedClaims(seo.description).length > 0) {
    seo.description = `${name || "Attività"}${category ? ` — ${category}` : ""}. Contatti e informazioni.`;
    dropped.push({ field: "seo.description", reason: "affermazioni non verificabili rimosse" });
  }
  if (!isNonEmptyStr(seo.title)) seo.title = [name, category].filter(Boolean).join(" · ") || "Sito";
  if (!isNonEmptyStr(seo.description)) {
    seo.description = `${name || "Attività"}${category ? ` — ${category}` : ""}. Contatti e informazioni.`;
  }
  spec.seo = seo;

  // 7. CTA: deve agganciarsi a un dato verificato, altrimenti degrada.
  const phone = isPublishableFact(spec.business?.phone) ? String(spec.business.phone.value) : "";
  const email = isPublishableFact(spec.business?.email) ? String(spec.business.email.value) : "";
  const maps = isPublishableFact(spec.business?.maps_url) ? String(spec.business.maps_url.value) : "";
  const cta = spec.cta ?? { label: "", kind: "call", target: "" };
  const targetFor: Record<string, string> = { call: phone, whatsapp: phone, email, maps };
  if (!targetFor[cta.kind]) {
    const fallbackKind = phone ? "call" : maps ? "maps" : email ? "email" : null;
    if (fallbackKind) {
      dropped.push({ field: "cta", reason: `CTA ${cta.kind} senza dato verificato, degradata a ${fallbackKind}` });
      cta.kind = fallbackKind as CtaKind;
      cta.label = fallbackKind === "call" ? "Chiama" : fallbackKind === "maps" ? "Come arrivare" : "Scrivi";
    } else {
      dropped.push({ field: "cta", reason: "nessun contatto verificato: CTA disattivata" });
      cta.kind = "call";
      cta.label = "Contatti non disponibili";
    }
  }
  cta.target = targetFor[cta.kind] ?? "";
  spec.cta = cta;

  // 8. Immagini: nessun asset di terzi senza fonte → placeholder.
  spec.images = (Array.isArray(spec.images) ? spec.images : []).map((img) => {
    if (img.url && !isNonEmptyStr(img.source)) {
      dropped.push({ field: "images", reason: "immagine senza fonte → placeholder" });
      return { ...img, url: "", placeholder: true };
    }
    return { ...img, placeholder: img.placeholder || !img.url };
  });

  // 9. Ricalcolo di ciò che manca (il renderer lo segnala).
  const incomplete: string[] = [];
  if (!phone) incomplete.push("telefono");
  if (!isPublishableFact(spec.business?.address)) incomplete.push("indirizzo");
  if (!isPublishableFact(spec.business?.hours)) incomplete.push("orari");
  if (spec.services.length === 0) incomplete.push("servizi");
  if (!spec.reviews) incomplete.push("recensioni");
  spec.incomplete = incomplete;

  // 10. Fonti effettivamente usate.
  const sources = new Set<string>();
  const collect = (f: unknown) => {
    if (isPublishableFact(f)) sources.add(f.source);
  };
  collect(spec.business?.name);
  collect(spec.business?.category);
  for (const k of ["address", "phone", "email", "maps_url", "hours"] as const) collect(spec.business?.[k]);
  if (spec.reviews) {
    collect(spec.reviews.rating);
    collect(spec.reviews.count);
  }
  spec.services.forEach(collect);
  spec.sources = Array.from(sources);
  spec.spec_version = SPEC_VERSION;

  return { spec, dropped };
}
