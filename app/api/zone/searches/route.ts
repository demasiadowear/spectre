import { NextResponse } from "next/server";
import {
  deleteZoneSearch,
  getZoneSearch,
  listZoneSearches,
  saveZoneSearch,
} from "@/lib/zone/db";
import type { ApiResponse } from "@/types";
import type {
  ZoneSavedSearch,
  ZoneSavedSearchFull,
  ZoneSearchFilters,
} from "@/types/zone";

// /api/zone/searches — cache delle ricerche zona (risparmio API Google).
// GET            -> elenco ricerche salvate (metadati)
// GET ?id=<id>   -> una ricerca COI risultati (per "Riapri" senza API)
// POST           -> salva/aggiorna una ricerca (dedup su centro+raggio)
// DELETE ?id=    -> elimina. Tutto dietro JWT.
export const dynamic = "force-dynamic";

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim();
  try {
    if (id) {
      const search = await getZoneSearch(id);
      if (!search) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: "Ricerca non trovata." },
          { status: 404 },
        );
      }
      return NextResponse.json<ApiResponse<ZoneSavedSearchFull>>({ success: true, data: search });
    }
    const list = await listZoneSearches();
    return NextResponse.json<ApiResponse<ZoneSavedSearch[]>>({ success: true, data: list });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
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
  if (lat === null || lng === null) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Coordinate mancanti." },
      { status: 400 },
    );
  }
  const rawFilters = (body.filters ?? {}) as Record<string, unknown>;
  const filters: ZoneSearchFilters = {
    categories: Array.isArray(rawFilters.categories)
      ? rawFilters.categories.filter((c): c is string => typeof c === "string")
      : [],
    reviews_min: num(rawFilters.reviews_min) ?? undefined,
    reviews_max: num(rawFilters.reviews_max) ?? undefined,
    rating_min: num(rawFilters.rating_min) ?? undefined,
    rating_max: num(rawFilters.rating_max) ?? undefined,
  };
  const result = (body.result ?? { leads: [], count: 0, groups_failed: [] }) as {
    leads?: unknown[];
    count?: number;
    groups_failed?: string[];
  };
  if (!Array.isArray(result.leads)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Risultati mancanti o non validi." },
      { status: 400 },
    );
  }
  try {
    const list = await saveZoneSearch({
      label: typeof body.label === "string" ? body.label.trim() : "",
      lat,
      lng,
      radius,
      filters,
      result: {
        leads: result.leads as ZoneSavedSearchFull["result"]["leads"],
        count: typeof result.count === "number" ? result.count : result.leads.length,
        groups_failed: Array.isArray(result.groups_failed) ? result.groups_failed : [],
      },
    });
    return NextResponse.json<ApiResponse<ZoneSavedSearch[]>>({ success: true, data: list });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Parametro obbligatorio: id." },
      { status: 400 },
    );
  }
  try {
    const list = await deleteZoneSearch(id);
    return NextResponse.json<ApiResponse<ZoneSavedSearch[]>>({ success: true, data: list });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
