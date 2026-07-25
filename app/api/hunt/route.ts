import { NextResponse } from "next/server";
import { searchGooglePlaces } from "@/lib/hunter/google-places";
import { scoreLead } from "@/lib/hunter/scorer";
import { fetchAsteLots } from "@/lib/intent/aste";
import { getLeads } from "@/lib/data";
import { normalizePhone } from "@/lib/pitch";
import type { ApiResponse } from "@/types";
import type {
  HunterParams,
  HuntResult,
  RawLead,
  ScoredLead,
} from "@/types/hunter";

// POST /api/hunt — trova attività locali (Google Places) OPPURE, con
// source="aste", i lotti delle aste giudiziarie (Tribunale di Bari).
// Lo scrape aste usa Playwright: stessa soglia degli scout.
export const maxDuration = 300;

// Exclude obvious chains / corporates (not "spa" the wellness word).
const EXCLUDE = [/franchising/i, /\bgroup\b/i, /s\.p\.a\.?/i];

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Body JSON non valido." },
      { status: 400 },
    );
  }

  // Sorgente aste giudiziarie: scrape live dei lotti (Tribunale di Bari,
  // residenziale). Nessun campo Google richiesto.
  if (str(body.source) === "aste") {
    try {
      const { lots, errors } = await fetchAsteLots();
      if (lots.length === 0 && errors.length > 0) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: `Aste: ${errors[0]}` },
          { status: 502 },
        );
      }
      return NextResponse.json<ApiResponse<HuntResult>>({
        success: true,
        data: { leads: [], count: lots.length, source: "aste", aste_lots: lots },
      });
    } catch (err) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: `Aste: ${(err as Error).message}` },
        { status: 500 },
      );
    }
  }

  const location = str(body.location).trim();
  const category = str(body.category).trim();
  if (!location || !category) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campi obbligatori: location, category." },
      { status: 400 },
    );
  }

  const minRating = num(body.min_rating, 4.0);
  const limit = Math.max(1, Math.min(50, num(body.limit, 20)));
  const onlyNoWebsite =
    body.only_no_website === undefined ? true : Boolean(body.only_no_website);

  const params: HunterParams = {
    location,
    category,
    // Clamp to a valid positive range (KM). num() only guards
    // missing/non-finite input — 0 and negatives are finite and would
    // otherwise flow through as a degenerate Google radius.
    radius: Math.max(1, Math.min(50, num(body.radius, 5))),
    min_rating: minRating,
    limit,
    only_no_website: onlyNoWebsite,
  };

  // Solo dati reali. Il vecchio fallback mock (6 attività finte fisse)
  // mascherava la chiave mancante recitando risultati scollegati dalla
  // ricerca ("gelaterie a Napoli" → parrucchieri a Milano): meglio un
  // errore esplicito che dati inventati in un tool operativo.
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return NextResponse.json<ApiResponse<never>>(
      {
        success: false,
        error:
          "GOOGLE_PLACES_API_KEY mancante in produzione: Hunter non può interrogare Google. Sistemala nelle Environment Variables su Vercel e rideploya.",
      },
      { status: 500 },
    );
  }
  const raw: RawLead[] = await searchGooglePlaces(params);
  const source: HuntResult["source"] = "google-places";

  // Exclude businesses already discarded (status "lost") so they never
  // resurface in future hunts — match by normalized phone or by name.
  const saved = await getLeads();
  const lostPhones = new Set<string>();
  const lostNames = new Set<string>();
  for (const l of saved) {
    if (l.status !== "lost") continue;
    if (l.phone) lostPhones.add(normalizePhone(l.phone));
    lostNames.add(l.name.toLowerCase().trim());
  }

  const filtered = raw.filter((l) => {
    if (l.rating < minRating) return false;
    if (EXCLUDE.some((re) => re.test(l.name))) return false;
    if (onlyNoWebsite && l.has_website) return false;
    const phoneKey = l.phone ? normalizePhone(l.phone) : "";
    if (phoneKey && lostPhones.has(phoneKey)) return false;
    if (lostNames.has(l.name.toLowerCase().trim())) return false;
    return true;
  });

  const scored: ScoredLead[] = filtered
    .map(scoreLead)
    .sort((a, b) => b.hunter_score - a.hunter_score)
    .slice(0, limit);

  return NextResponse.json<ApiResponse<HuntResult>>({
    success: true,
    data: { leads: scored, count: scored.length, source },
  });
}
