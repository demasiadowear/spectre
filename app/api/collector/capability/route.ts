import { NextResponse } from "next/server";
import { spiegaCapacita } from "@/lib/collector/capability";
import { statoOperativo } from "@/lib/collector/pronto";
import type { ApiResponse } from "@/types";
import type { CapabilityReport } from "@/types/dossier";

// ============================================================
// Che cosa questo runtime sa fare, e se si puo lavorare.
//
// Esiste perche il codice viene scritto in un posto e gira in un altro,
// e l'unico modo onesto di sapere se una chiave e configurata e
// chiederlo al runtime che la possiede.
//
// Restituisce SETTE booleani, i nomi delle variabili mancanti e lo
// stato preciso del database. Mai un valore, mai un prefisso, mai una
// lunghezza: un prefisso di quattro caratteri e gia un pezzo di
// segreto, e una lunghezza dice quale servizio l'ha emessa.
//
// Sta dietro il middleware come tutto il resto: non e un endpoint di
// debug pubblico. Quando l'autenticazione non e configurata il
// middleware risponde 503 prima ancora di arrivare qui.
// ============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export interface RispostaCapability {
  capability: CapabilityReport;
  database: {
    stato: string;
    detail: string;
    tabelle_mancanti: string[];
    lead: number;
    ms: number;
  };
  auth_mode: string;
  scope: string;
  pronto: boolean;
  motivi: string[];
  note: string[];
}

export async function GET() {
  const s = await statoOperativo();
  return NextResponse.json<ApiResponse<RispostaCapability>>({
    success: true,
    data: {
      capability: s.capability,
      database: {
        stato: s.database.stato,
        detail: s.database.detail,
        tabelle_mancanti: s.database.tabelle_mancanti,
        lead: s.database.lead,
        ms: s.database.ms,
      },
      auth_mode: s.auth_mode,
      scope: s.scope,
      pronto: s.pronto,
      motivi: s.motivi,
      note: spiegaCapacita(s.capability),
    },
  });
}
