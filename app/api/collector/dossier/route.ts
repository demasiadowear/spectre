import { NextResponse } from "next/server";
import { decidiMedia, decisioniMedia, leggiDossier } from "@/lib/collector/db";
import { logActivity } from "@/lib/factory/db";
import { guardiaRichiesta } from "@/lib/guardia-richiesta";
import {
  EVENTO_LETTURA, riepilogo, scriviRiepilogo, statoDaFasi,
} from "@/lib/collector/telemetria";
import type { ApiResponse } from "@/types";
import type { BusinessDossier, PhaseState } from "@/types/dossier";

// ============================================================
// Legge il dossier di un lead, e registra le decisioni sui media.
//
// Le decisioni stanno in una tabella separata dal dossier perche il
// dossier si rigenera e l'approvazione no: e un atto di una persona, e
// deve sopravvivere alla raccolta successiva. Qui si rileggono e si
// applicano sopra il manifest appena caricato.
// ============================================================

export const dynamic = "force-dynamic";

export interface RispostaDossier {
  trovato: boolean;
  dossier: BusinessDossier | null;
  phases: PhaseState[];
  decisioni: Record<string, "approved" | "blocked">;
  external_calls: number;
  total_ms: number;
  updated_at: string;
}

export async function GET(req: Request) {
  try {
    const leadId = new URL(req.url).searchParams.get("lead_id")?.trim() ?? "";
    if (!leadId) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "serve lead_id" }, { status: 400 },
      );
    }

    const salvato = await leggiDossier(leadId);
    if (!salvato) {
      return NextResponse.json<ApiResponse<RispostaDossier>>({
        success: true,
        data: { trovato: false, dossier: null, phases: [], decisioni: {}, external_calls: 0, total_ms: 0, updated_at: "" },
      });
    }

    const decisioni = await decisioniMedia(leadId);
    // Le approvazioni si riflettono nel manifest che esce da qui: il
    // pannello deve vedere lo stato vero, non quello del momento in cui
    // la raccolta e finita.
    const dossier = salvato.dossier;
    if (dossier?.media?.candidates) {
      dossier.media.approved_ids = dossier.media.candidates
        .filter((c) => decisioni[c.id] === "approved")
        .map((c) => c.id);
      for (const c of dossier.media.candidates) {
        if (decisioni[c.id] === "blocked") {
          c.allowed_scope = "blocked";
          c.rejected_reason = "bloccata da una decisione manuale";
        } else if (decisioni[c.id] === "approved") {
          // L'approvazione umana e l'UNICO modo per uscire dalla demo
          // privata. Nessuna euristica puo produrre questo passaggio.
          c.allowed_scope = "public";
        }
      }
    }

    // Lo stesso riepilogo sicuro anche in lettura: un dossier gia
    // prodotto torna cosi osservabile dai log al primo caricamento
    // della dashboard, senza rieseguire il collector. Le fasi fallite
    // restano fallite, quindi lo stato riflette com'e andata allora.
    scriviRiepilogo(riepilogo(
      dossier,
      salvato.phases,
      {
        job_id: salvato.job_id,
        lead_id: leadId,
        // Il JOB, non le fasi. Una fase fallita su cinque e un
        // risultato parziale, non un fallimento: il dossier esiste,
        // e salvato, e utilizzabile. Marcarlo `failed` farebbe suonare
        // un allarme per un lead senza sito web, che e il caso piu
        // comune del mestiere — e un allarme che suona sempre viene
        // ignorato anche quando serve. La parzialita si legge in
        // `phase_statuses` e in `error_code`, dove sta bene.
        status: statoDaFasi(salvato.phases),
        duration_ms: salvato.total_ms,
      },
      EVENTO_LETTURA,
    ));

    return NextResponse.json<ApiResponse<RispostaDossier>>({
      success: true,
      data: {
        trovato: true,
        dossier,
        phases: salvato.phases,
        decisioni,
        external_calls: salvato.external_calls,
        total_ms: salvato.total_ms,
        updated_at: salvato.updated_at,
      },
    });
  } catch (e) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (e as Error).message }, { status: 500 },
    );
  }
}

/** Approva o blocca una singola immagine. */
export async function PATCH(req: Request) {
  try {
    const g = guardiaRichiesta(req, { metodi: ["PATCH"] });
    if (!g.ok) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: g.error }, { status: g.status },
      );
    }
    const body: unknown = await req.json().catch(() => ({}));
    const raw = (body ?? {}) as Record<string, unknown>;
    const leadId = typeof raw.lead_id === "string" ? raw.lead_id.trim() : "";
    const mediaId = typeof raw.media_id === "string" ? raw.media_id.trim() : "";
    const decision = raw.decision === "approved" || raw.decision === "blocked" ? raw.decision : "";
    const sourceUrl = typeof raw.source_url === "string" ? raw.source_url.trim() : "";

    if (!leadId || !mediaId || !decision) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "servono lead_id, media_id e decision (approved|blocked)" },
        { status: 400 },
      );
    }

    await decidiMedia({ lead_id: leadId, media_id: mediaId, source_url: sourceUrl, decision });
    // In timeline, come per i fatti: fra sei mesi si deve poter risalire
    // a chi ha autorizzato una fotografia, e quando.
    await logActivity({
      lead_id: leadId,
      type: "note",
      subject: decision === "approved" ? "Immagine approvata" : "Immagine bloccata",
      body: `${mediaId}${sourceUrl ? ` — ${sourceUrl}` : ""}`,
      metadata: { media_id: mediaId, decision, source_url: sourceUrl },
      created_by: "puccio",
    });

    return NextResponse.json<ApiResponse<{ ok: true }>>({ success: true, data: { ok: true } });
  } catch (e) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (e as Error).message }, { status: 500 },
    );
  }
}
