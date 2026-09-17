import { NextResponse } from "next/server";
import { capabilities, spiegaCapacita } from "@/lib/collector/capability";
import type { ApiResponse } from "@/types";

// ============================================================
// Che cosa questo runtime sa fare.
//
// Esiste perche il codice viene scritto in un posto e gira in un altro,
// e l'unico modo onesto di sapere se una chiave e configurata e
// chiederlo al runtime che la possiede.
//
// Restituisce SOLO booleani e nomi di variabili. Mai un valore, mai un
// prefisso, mai una lunghezza: un prefisso di quattro caratteri e gia
// un pezzo di segreto, e una lunghezza dice quale servizio l'ha
// emessa. Sta dietro il middleware come tutto il resto: non e un
// endpoint di debug pubblico.
// ============================================================

export const dynamic = "force-dynamic";

export async function GET() {
  const c = capabilities();
  return NextResponse.json<ApiResponse<typeof c & { note: string[] }>>({
    success: true,
    data: { ...c, note: spiegaCapacita(c) },
  });
}
