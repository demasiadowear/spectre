import { NextResponse } from "next/server";
import { searchGooglePlaces } from "@/lib/hunter/google-places";
import { MOCK_HUNTER_LEADS } from "@/lib/hunter/mock-leads";
import { scoreLead } from "@/lib/hunter/scorer";
import type { ApiResponse } from "@/types";
import type {
  HunterParams,
  HuntResult,
  RawLead,
  ScoredLead,
} from "@/types/hunter";

// POST /api/hunt — find local businesses, filter, score, rank.
// Google Places when GOOGLE_PLACES_API_KEY is set, otherwise mock.

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
    radius: num(body.radius, 5),
    min_rating: minRating,
    limit,
    only_no_website: onlyNoWebsite,
  };

  // Source resolution: real data first, mock fallback (never empty in demo).
  let raw: RawLead[] = [];
  let source: HuntResult["source"] = "mock";
  if (process.env.GOOGLE_PLACES_API_KEY) {
    raw = await searchGooglePlaces(params);
    if (raw.length > 0) source = "google-places";
  }
  if (raw.length === 0) {
    raw = MOCK_HUNTER_LEADS;
    source = "mock";
  }

  const filtered = raw.filter((l) => {
    if (l.rating < minRating) return false;
    if (EXCLUDE.some((re) => re.test(l.name))) return false;
    if (onlyNoWebsite && l.has_website) return false;
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
