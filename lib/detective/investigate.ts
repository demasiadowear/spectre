import type {
  DetectiveCase,
  DetectiveFact,
  DetectiveRawData,
  GbpAudit,
  SocialAudit,
  WebsiteAudit,
} from "@/types/detective";

// ============================================================
// DETECTIVE investigate — raccolta SOLO fonti pubbliche:
// sito web (fetch + parsing, niente browser), scheda Google
// (Places Details già integrato), IG/FB se linkati dal sito.
// NO test civetta: nessun contatto col prospect in v1.
//
// Ogni dato raccolto viene distillato in "fact" F1..Fn: l'analyze
// può citare SOLO questi (anti-hallucination by construction).
// ============================================================

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const DETAILS_URL = "https://places.googleapis.com/v1/places";
const FETCH_TIMEOUT_MS = 15_000;
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const BOOKING_PROVIDERS: { pattern: RegExp; name: string }[] = [
  { pattern: /treatwell\.[a-z.]+/i, name: "Treatwell" },
  { pattern: /fresha\.com/i, name: "Fresha" },
  { pattern: /booksy\.com/i, name: "Booksy" },
  { pattern: /planity\.com/i, name: "Planity" },
  { pattern: /calendly\.com/i, name: "Calendly" },
  { pattern: /(prenota|booking|appuntament)/i, name: "modulo interno" },
];

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      headers: { "User-Agent": UA, "Accept-Language": "it" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

// ----- Sito web ------------------------------------------------

export async function auditWebsite(url: string): Promise<WebsiteAudit> {
  const audit: WebsiteAudit = {
    url,
    fetched: false,
    has_contact_form: false,
    has_booking: false,
    has_wa_chat: false,
    has_tel_link: false,
    has_hours: false,
    has_pricing: false,
    has_viewport_meta: false,
  };

  let html = "";
  try {
    const started = Date.now();
    const res = await fetchWithTimeout(url);
    audit.response_ms = Date.now() - started;
    audit.http_status = res.status;
    if (!res.ok) return audit;
    html = await res.text();
    audit.fetched = true;
  } catch {
    return audit; // sito irraggiungibile: è già un fatto
  }

  audit.html_kb = Math.round(Buffer.byteLength(html, "utf8") / 1024);
  audit.title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  audit.has_viewport_meta = /<meta[^>]+name=["']viewport["']/i.test(html);
  audit.has_tel_link = /href=["']tel:/i.test(html);
  audit.has_wa_chat = /(wa\.me\/|api\.whatsapp\.com\/send|whatsapp:\/\/)/i.test(html);
  audit.has_contact_form =
    /<form[\s\S]{0,2000}?type=["'](?:email|tel)["']/i.test(html) ||
    /<form[\s\S]{0,2000}?<textarea/i.test(html);
  audit.has_hours =
    /(orari|aperto|lun\W{0,3}(ven|sab)|luned[iì]|marted[iì])/i.test(html);
  audit.has_pricing = /(listino|prezzi|€\s?\d{2,3}|\d{2,3}\s?€)/i.test(html);

  for (const p of BOOKING_PROVIDERS) {
    if (p.pattern.test(html)) {
      audit.has_booking = true;
      audit.booking_provider = p.name;
      break;
    }
  }

  audit.instagram_url = html.match(
    /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.]+/i,
  )?.[0];
  audit.facebook_url = html.match(
    /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9_.\-/]+/i,
  )?.[0];

  // Lighthouse vero non gira in serverless: PageSpeed Insights API se
  // la chiave Google la copre, altrimenti si resta su tempi/peso reali.
  if (GOOGLE_PLACES_API_KEY) {
    try {
      const psi = await fetchWithTimeout(
        `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&category=performance&strategy=mobile&key=${GOOGLE_PLACES_API_KEY}`,
      );
      if (psi.ok) {
        const data = (await psi.json()) as {
          lighthouseResult?: { categories?: { performance?: { score?: number } } };
        };
        const score = data.lighthouseResult?.categories?.performance?.score;
        if (typeof score === "number") {
          audit.psi_performance = Math.round(score * 100);
        }
      }
    } catch {
      /* PSI non disponibile: nessun fact relativo */
    }
  }

  return audit;
}

// ----- Scheda Google (Places Details, già integrato) -----------

interface PlaceDetailsResponse {
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  reviews?: {
    rating?: number;
    relativePublishTimeDescription?: string;
    text?: { text?: string };
  }[];
}

export async function auditGbp(placeId: string): Promise<GbpAudit> {
  const audit: GbpAudit = { fetched: false, recent_reviews: [] };
  if (!GOOGLE_PLACES_API_KEY || !placeId) return audit;

  try {
    const res = await fetch(`${DETAILS_URL}/${encodeURIComponent(placeId)}`, {
      cache: "no-store",
      headers: {
        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": "rating,userRatingCount,googleMapsUri,reviews",
      },
    });
    if (!res.ok) {
      console.error("[detective] Places Details HTTP", res.status);
      return audit;
    }
    const data = (await res.json()) as PlaceDetailsResponse;
    audit.fetched = true;
    audit.rating = data.rating;
    audit.reviews_count = data.userRatingCount;
    audit.maps_uri = data.googleMapsUri;
    audit.recent_reviews = (data.reviews ?? [])
      .filter((r) => r.text?.text)
      .slice(0, 5)
      .map((r) => ({
        rating: r.rating ?? 0,
        text: (r.text?.text ?? "").slice(0, 500),
        when: r.relativePublishTimeDescription ?? "",
      }));
  } catch (err) {
    console.error("[detective] Places Details failed:", (err as Error).message);
  }
  return audit;
}

// ----- Social (solo se linkati dal sito) ------------------------

/** IG pubblico: i numeri stanno nella meta og:description
 *  ("1,234 Followers, 56 Following, 789 Posts"). Best effort. */
async function auditInstagram(url: string): Promise<SocialAudit["instagram"]> {
  const result: NonNullable<SocialAudit["instagram"]> = { url, fetched: false };
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return result;
    const html = await res.text();
    result.fetched = true;
    const og = html.match(
      /property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    )?.[1];
    const followers = og?.match(/([\d.,]+)\s*follower/i)?.[1];
    const posts = og?.match(/([\d.,]+)\s*post/i)?.[1];
    const toNum = (s?: string) =>
      s ? Number(s.replace(/[.,]/g, "")) || undefined : undefined;
    result.followers = toNum(followers);
    result.posts = toNum(posts);
  } catch {
    /* profilo non leggibile senza login: resta fetched=false */
  }
  return result;
}

async function auditSocial(website: WebsiteAudit | null): Promise<SocialAudit> {
  const social: SocialAudit = {};
  if (website?.instagram_url) {
    social.instagram = await auditInstagram(website.instagram_url);
  }
  if (website?.facebook_url) {
    // FB pubblico è quasi sempre dietro login wall: registriamo solo
    // l'esistenza del link (fact verificabile), niente numeri inventati.
    social.facebook = { url: website.facebook_url, fetched: false };
  }
  return social;
}

// ----- Fact F1..Fn (unica base ammessa per l'analyze) -----------

export function buildFacts(
  website: WebsiteAudit | null,
  gbp: GbpAudit,
  social: SocialAudit,
): DetectiveFact[] {
  const facts: string[] = [];

  if (website) {
    if (!website.fetched) {
      facts.push(
        `il sito ${website.url} non risponde o dà errore (HTTP ${website.http_status ?? "n/d"})`,
      );
    } else {
      facts.push(`il sito ${website.url} è raggiungibile`);
      facts.push(
        website.has_booking
          ? `il sito ha prenotazione online (${website.booking_provider})`
          : "il sito NON ha prenotazione online: si prenota solo per telefono o di persona",
      );
      facts.push(
        website.has_wa_chat
          ? "il sito ha un contatto WhatsApp click-to-chat"
          : "il sito NON ha un contatto WhatsApp diretto",
      );
      facts.push(
        website.has_contact_form
          ? "il sito ha un modulo contatti"
          : "il sito NON ha un modulo contatti",
      );
      if (!website.has_pricing)
        facts.push("il sito non mostra listino o prezzi dei servizi");
      if (!website.has_hours)
        facts.push("il sito non mostra gli orari di apertura");
      if (!website.has_viewport_meta)
        facts.push("il sito non è ottimizzato per mobile (manca il viewport)");
      if (typeof website.psi_performance === "number") {
        facts.push(
          `punteggio velocità mobile (PageSpeed) ${website.psi_performance}/100`,
        );
      } else if ((website.response_ms ?? 0) > 3000) {
        facts.push(
          `il sito impiega ${(website.response_ms! / 1000).toFixed(1)}s a rispondere`,
        );
      }
    }
  }

  if (gbp.fetched) {
    if (gbp.rating != null && gbp.reviews_count != null) {
      facts.push(
        `scheda Google: ${gbp.rating.toFixed(1)} stelle con ${gbp.reviews_count} recensioni`,
      );
    }
    const negative = gbp.recent_reviews.filter((r) => r.rating <= 3);
    if (negative.length > 0) {
      facts.push(
        `${negative.length} delle ${gbp.recent_reviews.length} recensioni recenti visibili hanno 3 stelle o meno`,
      );
    }
  }

  if (social.instagram) {
    if (social.instagram.fetched && social.instagram.followers != null) {
      facts.push(
        `Instagram collegato dal sito con ${social.instagram.followers} follower`,
      );
    } else {
      facts.push("il sito linka un profilo Instagram");
    }
  }
  if (social.facebook) facts.push("il sito linka una pagina Facebook");

  return facts.map((text, i) => ({ id: `F${i + 1}`, text }));
}

// ----- Orchestratore --------------------------------------------

export async function runInvestigation(
  c: DetectiveCase,
): Promise<DetectiveRawData> {
  const website = c.website_url ? await auditWebsite(c.website_url) : null;
  const gbp = await auditGbp(c.place_id);
  const social = await auditSocial(website);

  return {
    website,
    gbp,
    social,
    collected_at: new Date().toISOString(),
    facts: buildFacts(website, gbp, social),
  };
}
