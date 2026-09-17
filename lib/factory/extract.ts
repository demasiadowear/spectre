// ============================================================
// Estrazione di dati strutturati da una pagina HTML.
//
// Nessuna dipendenza di parsing: il repo non ne ha e per quello che
// serve qui (JSON-LD, meta tag, link, qualche microdato) le regex
// bastano e non introducono una libreria da mantenere. NON è un parser
// HTML generale e non pretende di esserlo: se un giorno servisse
// navigare il DOM, quello è il momento di aggiungere una dipendenza.
//
// Tutto ciò che esce da qui è GREZZO: non è ancora un fatto. È
// research.ts a decidere fonte, banda e precedenza.
// ============================================================

/** Un valore trovato nella pagina, con come è stato trovato. */
export interface Extracted<T = string> {
  value: T;
  /** Come è stato ottenuto: determina la banda di affidabilità. */
  method: "json_ld" | "microdata" | "meta" | "link" | "text_pattern";
  /** Frammento della pagina che lo prova (per l'evidence ledger). */
  evidence: string;
}

export interface ExtractedSite {
  name: Extracted[];
  legal_name: Extracted[];
  description: Extracted[];
  category: Extracted[];
  phone: Extracted[];
  email: Extracted[];
  address: Extracted[];
  city: Extracted[];
  postal_code: Extracted[];
  hours: Extracted<string[]>[];
  services: Extracted[];
  area_served: Extracted[];
  social: Extracted[];
  images: Extracted[];
  logo: Extracted[];
  menu_url: Extracted[];
  booking_url: Extracted[];
  price_range: Extracted[];
  rating: Extracted<number>[];
  review_count: Extracted<number>[];
  /** Tipi Schema.org trovati: utile per capire che pagina è. */
  schema_types: string[];
}

function empty(): ExtractedSite {
  return {
    name: [], legal_name: [], description: [], category: [], phone: [],
    email: [], address: [], city: [], postal_code: [], hours: [],
    services: [], area_served: [], social: [], images: [], logo: [],
    menu_url: [], booking_url: [], price_range: [], rating: [],
    review_count: [], schema_types: [],
  };
}

const clean = (s: unknown, max = 500): string =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Decodifica le entità HTML che capitano davvero nei testi italiani. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&agrave;/g, "à").replace(/&egrave;/g, "è").replace(/&eacute;/g, "é")
    .replace(/&igrave;/g, "ì").replace(/&ograve;/g, "ò").replace(/&ugrave;/g, "ù")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

/** Testo visibile: via script, style, noscript e poi via i tag. */
export function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

// ----- JSON-LD ---------------------------------------------------

/** Tutti i blocchi JSON-LD parsabili. Uno rotto non ferma gli altri. */
export function parseJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Alcuni CMS emettono JSON-LD con commenti CDATA attorno.
      try {
        out.push(JSON.parse(raw.replace(/^\s*\/\/<!\[CDATA\[|\]\]>\s*$/g, "").trim()));
      } catch {
        /* blocco irrecuperabile: si ignora, gli altri restano validi */
      }
    }
  }
  return out;
}

/** Appiattisce @graph e array annidati in una lista di nodi. */
function flattenNodes(input: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6 || input == null) return [];
  if (Array.isArray(input)) return input.flatMap((i) => flattenNodes(i, depth + 1));
  if (typeof input !== "object") return [];
  const node = input as Record<string, unknown>;
  const nested = node["@graph"] ? flattenNodes(node["@graph"], depth + 1) : [];
  return [node, ...nested];
}

const typesOf = (node: Record<string, unknown>): string[] => {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
};

/** Un nodo che descrive un'attività locale (non un articolo, non un sito). */
const BUSINESS_TYPES =
  /^(?:LocalBusiness|Organization|Restaurant|BeautySalon|HairSalon|Store|Dentist|Physician|MedicalBusiness|ProfessionalService|HomeAndConstructionBusiness|AutomotiveBusiness|FoodEstablishment|Bakery|Cafe|Bar|NightClub|Hotel|LodgingBusiness|HealthAndBeautyBusiness|SportsActivityLocation|EntertainmentBusiness|LegalService|FinancialService|RealEstateAgent|TravelAgency|Pharmacy|VeterinaryCare|ChildCare|Plumber|Electrician|GeneralContractor|Locksmith|MovingCompany|RoofingContractor|HousePainter|Florist|ClothingStore|JewelryStore|ShoeStore|PetStore|BookStore|GroceryStore|Supermarket|ConvenienceStore|HardwareStore|FurnitureStore|SportingGoodsStore|ToyStore|ElectronicsStore|MobilePhoneStore|OpticianStore|Optician|MedicalClinic|Gym|SpaBusiness|DaySpa|TattooParlor|NailSalon|Winery|IceCreamShop|Pizzeria|Brewery|Distillery)$/i;

function pushIf(arr: Extracted[], value: string, method: Extracted["method"], evidence: string) {
  const v = clean(decodeEntities(value));
  if (v && !arr.some((e) => e.value.toLowerCase() === v.toLowerCase())) {
    arr.push({ value: v, method, evidence: clean(evidence, 200) });
  }
}

/** Indirizzo postale Schema.org → stringa leggibile. */
function addressOf(raw: unknown): { full: string; city: string; postal: string } {
  if (typeof raw === "string") return { full: clean(decodeEntities(raw)), city: "", postal: "" };
  if (typeof raw !== "object" || raw == null) return { full: "", city: "", postal: "" };
  const a = raw as Record<string, unknown>;
  const street = clean(a.streetAddress);
  const city = clean(a.addressLocality);
  const postal = clean(a.postalCode);
  const region = clean(a.addressRegion);
  const full = [street, [postal, city].filter(Boolean).join(" "), region]
    .filter(Boolean)
    .join(", ");
  return { full: decodeEntities(full), city: decodeEntities(city), postal };
}

/** openingHoursSpecification → righe leggibili in italiano. */
const DAY_IT: Record<string, string> = {
  monday: "Lunedì", tuesday: "Martedì", wednesday: "Mercoledì",
  thursday: "Giovedì", friday: "Venerdì", saturday: "Sabato", sunday: "Domenica",
};

function hoursOf(raw: unknown): string[] {
  const specs = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const rows: string[] = [];
  for (const s of specs) {
    if (typeof s === "string") {
      // Forma compatta: "Mo-Fr 09:00-18:00".
      const v = clean(s);
      if (v) rows.push(v);
      continue;
    }
    if (typeof s !== "object" || s == null) continue;
    const spec = s as Record<string, unknown>;
    const days = Array.isArray(spec.dayOfWeek)
      ? spec.dayOfWeek
      : spec.dayOfWeek
        ? [spec.dayOfWeek]
        : [];
    const names = days
      .map((d) => clean(d).split("/").pop() ?? "")
      .map((d) => DAY_IT[d.toLowerCase()] ?? d)
      .filter(Boolean);
    const opens = clean(spec.opens);
    const closes = clean(spec.closes);
    if (!names.length) continue;
    rows.push(opens && closes ? `${names.join(", ")}: ${opens} - ${closes}` : `${names.join(", ")}: chiuso`);
  }
  return rows.slice(0, 14);
}

/** Servizi da hasOfferCatalog / makesOffer. Nomi di servizio, non testi. */
function servicesOf(node: Record<string, unknown>): string[] {
  const out: string[] = [];
  const visit = (v: unknown, depth = 0) => {
    if (depth > 5 || v == null || out.length >= 20) return;
    if (Array.isArray(v)) return v.forEach((i) => visit(i, depth + 1));
    if (typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const name = clean(o.name, 90);
    // Un nome di servizio è corto: se è un paragrafo non è un servizio.
    if (name && name.length <= 90 && !out.includes(name)) out.push(decodeEntities(name));
    visit(o.itemListElement, depth + 1);
    visit(o.itemOffered, depth + 1);
    visit(o.offers, depth + 1);
    visit(o.hasOfferCatalog, depth + 1);
  };
  visit(node.hasOfferCatalog);
  visit(node.makesOffer);
  visit(node.hasMenu);
  return out;
}

const imageUrlsOf = (raw: unknown): string[] => {
  const out: string[] = [];
  const visit = (v: unknown, depth = 0) => {
    if (depth > 4 || v == null || out.length >= 12) return;
    if (typeof v === "string") {
      if (/^https?:\/\//i.test(v)) out.push(v.trim());
      return;
    }
    if (Array.isArray(v)) return v.forEach((i) => visit(i, depth + 1));
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      visit(o.url ?? o.contentUrl, depth + 1);
    }
  };
  visit(raw);
  return out;
};

const SOCIAL_RE =
  /^https?:\/\/(?:www\.)?(?:facebook|instagram|linkedin|twitter|x|youtube|tiktok|pinterest)\.com\//i;

/** Estrae da JSON-LD: la fonte più affidabile perché è dichiarata dal sito. */
export function extractFromJsonLd(html: string, out: ExtractedSite): void {
  for (const block of parseJsonLd(html)) {
    for (const node of flattenNodes(block)) {
      const types = typesOf(node);
      for (const t of types) if (!out.schema_types.includes(t)) out.schema_types.push(t);
      if (!types.some((t) => BUSINESS_TYPES.test(t))) continue;

      const ev = `JSON-LD ${types.join("/")}`;
      pushIf(out.name, clean(node.name, 140), "json_ld", ev);
      pushIf(out.legal_name, clean(node.legalName, 200), "json_ld", ev);
      pushIf(out.description, clean(node.description, 600), "json_ld", ev);
      pushIf(out.phone, clean(node.telephone, 40), "json_ld", ev);
      pushIf(out.email, clean(node.email, 120).replace(/^mailto:/i, ""), "json_ld", ev);
      pushIf(out.price_range, clean(node.priceRange, 20), "json_ld", ev);
      pushIf(out.menu_url, clean(node.hasMenu ?? node.menu, 300), "json_ld", ev);

      const addr = addressOf(node.address);
      pushIf(out.address, addr.full, "json_ld", ev);
      pushIf(out.city, addr.city, "json_ld", ev);
      pushIf(out.postal_code, addr.postal, "json_ld", ev);

      // La categoria dal tipo Schema.org è più affidabile di un'euristica.
      const bizType = types.find((t) => BUSINESS_TYPES.test(t));
      if (bizType) pushIf(out.category, bizType, "json_ld", ev);

      const rows = hoursOf(node.openingHoursSpecification ?? node.openingHours);
      if (rows.length && !out.hours.some((h) => h.value.join("|") === rows.join("|"))) {
        out.hours.push({ value: rows, method: "json_ld", evidence: ev });
      }

      for (const s of servicesOf(node)) pushIf(out.services, s, "json_ld", ev);
      for (const img of imageUrlsOf(node.image)) pushIf(out.images, img, "json_ld", ev);
      for (const lg of imageUrlsOf(node.logo)) pushIf(out.logo, lg, "json_ld", ev);

      const area = node.areaServed;
      if (typeof area === "string") pushIf(out.area_served, area, "json_ld", ev);
      else if (Array.isArray(area)) {
        for (const a of area.slice(0, 5)) {
          pushIf(out.area_served, typeof a === "string" ? a : clean((a as Record<string, unknown>)?.name), "json_ld", ev);
        }
      }

      const same = node.sameAs;
      const links = Array.isArray(same) ? same : same ? [same] : [];
      for (const l of links) {
        const url = clean(l, 300);
        if (SOCIAL_RE.test(url)) pushIf(out.social, url, "json_ld", ev);
      }

      // Rating: SOLO l'aggregato. Le recensioni individuali non si toccano:
      // non sono nostre e non vanno in un sito come testimonianze.
      const agg = node.aggregateRating;
      if (agg && typeof agg === "object") {
        const a = agg as Record<string, unknown>;
        const rv = Number(a.ratingValue);
        const rc = Number(a.reviewCount ?? a.ratingCount);
        if (Number.isFinite(rv) && rv > 0 && rv <= 5) {
          out.rating.push({ value: rv, method: "json_ld", evidence: ev });
        }
        if (Number.isFinite(rc) && rc > 0) {
          out.review_count.push({ value: Math.round(rc), method: "json_ld", evidence: ev });
        }
      }

      const booking = clean(node.potentialAction && (node.potentialAction as Record<string, unknown>).target, 300);
      if (/^https?:\/\//i.test(booking)) pushIf(out.booking_url, booking, "json_ld", ev);
    }
  }
}

// ----- Meta tag e link -------------------------------------------

function metaContent(html: string, attr: "name" | "property", key: string): string {
  const re = new RegExp(
    `<meta\\b[^>]*${attr}=["']${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}["'][^>]*>`,
    "i",
  );
  const tag = html.match(re)?.[0];
  if (!tag) return "";
  return clean(decodeEntities(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? ""), 600);
}

export function extractFromMeta(html: string, out: ExtractedSite): void {
  const title = clean(decodeEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""), 160);
  // Il titolo è spesso "Nome | Categoria Città": si tiene il primo pezzo.
  const titleName = title.split(/\s*[|·–—]\s*/)[0].trim();
  if (titleName) pushIf(out.name, titleName, "meta", "<title>");

  const ogSite = metaContent(html, "property", "og:site_name");
  if (ogSite) pushIf(out.name, ogSite, "meta", "og:site_name");

  const desc =
    metaContent(html, "name", "description") || metaContent(html, "property", "og:description");
  if (desc) pushIf(out.description, desc, "meta", "meta description");

  const ogImage = metaContent(html, "property", "og:image");
  if (/^https?:\/\//i.test(ogImage)) pushIf(out.images, ogImage, "meta", "og:image");

  const ogLocality = metaContent(html, "property", "business:contact_data:locality");
  if (ogLocality) pushIf(out.city, ogLocality, "meta", "business:contact_data:locality");
  const ogPhone = metaContent(html, "property", "business:contact_data:phone_number");
  if (ogPhone) pushIf(out.phone, ogPhone, "meta", "business:contact_data:phone_number");
  const ogStreet = metaContent(html, "property", "business:contact_data:street_address");
  if (ogStreet) pushIf(out.address, ogStreet, "meta", "business:contact_data:street_address");
}

/** Microdati itemprop: meno diffusi del JSON-LD ma capitano sui siti vecchi. */
export function extractFromMicrodata(html: string, out: ExtractedSite): void {
  const re = /<[^>]*itemprop=["']([a-zA-Z]+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  const fields: Record<string, keyof ExtractedSite> = {
    telephone: "phone",
    email: "email",
    streetAddress: "address",
    addressLocality: "city",
    postalCode: "postal_code",
    name: "name",
  };
  while ((m = re.exec(html)) !== null) {
    const prop = m[1];
    const target = fields[prop];
    if (!target) continue;
    const tag = m[0];
    // itemprop porta il valore in `content` oppure nel testo che segue.
    let value = clean(decodeEntities(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? ""), 200);
    if (!value) {
      const after = html.slice(m.index + tag.length, m.index + tag.length + 300);
      value = clean(visibleText(after).split(/<|\n/)[0], 200);
    }
    if (value && Array.isArray(out[target])) {
      pushIf(out[target] as Extracted[], value, "microdata", `itemprop=${prop}`);
    }
  }
}

const PHONE_RE =
  /(?:\+39[\s.\-]?)?(?:0\d{1,3}[\s.\-]?\d{5,8}|3\d{2}[\s.\-]?\d{3}[\s.\-]?\d{3,4})/g;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Contatti e link dai tag <a>: href è dichiarato, quindi affidabile. */
export function extractFromLinks(html: string, out: ExtractedSite): void {
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = decodeEntities(m[1].trim());
    const label = visibleText(m[2]).toLowerCase();

    if (/^tel:/i.test(href)) {
      pushIf(out.phone, href.replace(/^tel:/i, ""), "link", "href tel:");
    } else if (/^mailto:/i.test(href)) {
      pushIf(out.email, href.replace(/^mailto:/i, "").split("?")[0], "link", "href mailto:");
    } else if (SOCIAL_RE.test(href)) {
      pushIf(out.social, href.split("?")[0], "link", "link social");
    } else if (/^https?:\/\//i.test(href)) {
      if (/menu|carta|listino/.test(label) || /menu|carta/.test(href.toLowerCase())) {
        pushIf(out.menu_url, href, "link", `link "${label.slice(0, 40)}"`);
      }
      if (/prenot|book|appuntament|riserv/.test(label) || /prenot|book/.test(href.toLowerCase())) {
        pushIf(out.booking_url, href, "link", `link "${label.slice(0, 40)}"`);
      }
    }
  }

  // Fallback sul testo: un numero scritto ma non linkato è comunque un
  // numero pubblicato dall'attività. Banda più bassa, non ignorato.
  const text = visibleText(html).slice(0, 40_000);
  for (const p of text.match(PHONE_RE)?.slice(0, 5) ?? []) {
    pushIf(out.phone, p, "text_pattern", "numero nel testo della pagina");
  }
  for (const e of text.match(EMAIL_RE)?.slice(0, 5) ?? []) {
    // Le email di piattaforma non sono dell'attività.
    if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(e)) continue;
    if (/(?:sentry|wixpress|example|domain)\.(?:io|com)$/i.test(e)) continue;
    pushIf(out.email, e, "text_pattern", "email nel testo della pagina");
  }
}

/** Immagini dal markup. L'attributo alt serve come descrizione. */
export function extractImages(html: string, out: ExtractedSite): void {
  const re = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  let seen = 0;
  while ((m = re.exec(html)) !== null && seen < 25) {
    const tag = m[0];
    const src = decodeEntities(
      (tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] ??
        tag.match(/\bdata-src=["']([^"']+)["']/i)?.[1] ??
        "").trim(),
    );
    if (!/^https?:\/\//i.test(src)) continue;
    seen++;
    const alt = clean(decodeEntities(tag.match(/\balt=["']([^"']*)["']/i)?.[1] ?? ""), 120);
    const isLogo = /logo/i.test(src) || /logo/i.test(alt);
    pushIf(isLogo ? out.logo : out.images, src, "link", alt ? `alt="${alt}"` : "<img>");
  }
}

/** Estrazione completa da una pagina. Funzione pura: nessuna rete. */
export function extractFromHtml(html: string): ExtractedSite {
  const out = empty();
  if (!html) return out;
  // JSON-LD per primo: è la fonte dichiarata, e pushIf tiene il primo
  // valore per campo, quindi i metodi meno affidabili non lo scavalcano.
  extractFromJsonLd(html, out);
  extractFromMicrodata(html, out);
  extractFromMeta(html, out);
  extractFromLinks(html, out);
  extractImages(html, out);
  return out;
}
