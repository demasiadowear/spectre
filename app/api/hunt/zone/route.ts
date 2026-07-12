import { NextResponse } from "next/server";
import { huntZone, type ZoneHuntFilters } from "@/lib/hunter/zone";
import type { ApiResponse } from "@/types";
import type { ZoneHuntResult } from "@/types/zone";

// POST /api/hunt/zone — caccia per zona (cerchio lat/lng/raggio) per
// la vendita porta-a-porta delle card NFC recensioni. Dietro JWT come
// tutte le API dashboard (il middleware esenta solo i path cron).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
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

  const lat = num(body.lat);
  const lng = num(body.lng);
  const radius = num(body.radius) ?? 800;
  if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Coordinate zona mancanti o non valide." },
      { status: 400 },
    );
  }

  const filters: ZoneHuntFilters = {
    categories: Array.isArray(body.categories)
      ? body.categories.filter((c): c is string => typeof c === "string")
      : [],
    reviews_min: num(body.reviews_min) ?? undefined,
    reviews_max: num(body.reviews_max) ?? undefined,
    rating_min: num(body.rating_min) ?? undefined,
    rating_max: num(body.rating_max) ?? undefined,
  };

  try {
    const result = await huntZone(lat, lng, radius, filters);
    return NextResponse.json<ApiResponse<ZoneHuntResult>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
