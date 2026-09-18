import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { turso } from "@/lib/turso";
import { leggiDossier } from "@/lib/collector/db";
import { getProject, getProjectByLead } from "@/lib/factory/db";
import { usoConsentito } from "@/lib/collector/brand";
import { fotoMostrabili } from "@/lib/demo/foto";
import {
  MAX_IN_PAGINA, SEQUENZA_RUOLI, validaProposta,
  type MotivoRevisione, type RuoloLayout, type StatoCuratela,
} from "@/lib/demo/curatela";
import { messaggioPubblicazione, messaggioValidazione } from "@/lib/demo/messaggi";
import { leggiProposta, leggiPubblicata } from "@/lib/demo/proposte-db";
import { risolviSpec, type StatoPubblicazione } from "@/lib/demo/pubblicazione";
import { TETTI } from "@/lib/demo/analisi-progetto";
import type { BrandOverall } from "@/types/dossier";
import type { ApiResponse } from "@/types";

// ============================================================
// Il provino: cosa vede l'operatore prima di decidere.
//
// Lettura sola, e dietro la sessione. Le fotografie arrivano dagli
// stessi indirizzi della demo — `/demo/<slug>/foto/<i>` — cosi
// l'operatore guarda ESATTAMENTE i byte che guardera il prospect, e
// non una miniatura ricavata da un'altra strada che potrebbe non
// corrispondere.
//
// `candidate_id` esce, ma la UI non e tenuta a mostrarlo: serve a
// rimandare indietro le scelte per identita invece che per posizione.
// ============================================================

export const dynamic = "force-dynamic";

export interface FotoInProvino {
  candidate_id: string;
  indice: number;
  src: string;
  larghezza: number;
  altezza: number;
  attribuzione: string;
  attribuzione_obbligatoria: boolean;
  stato: StatoCuratela;
  layout_role: RuoloLayout | "";
  object_position: string;
  order: number;
  /** Perche serve una persona, quando serve. */
  motivo_revisione: MotivoRevisione | "";
  /** Comparsa dopo l'ultima analisi: nessuno l'ha ancora guardata. */
  nuova: boolean;
}

export interface Provino {
  project_id: string;
  slug: string;
  foto: FotoInProvino[];
  basis_revision: string;
  manifest_revision: string;
  proposal_revision: string;
  approvata_il: string;
  analisi_in_corso: boolean;
  /** Il messaggio preciso: cosa e successo e cosa fare adesso. */
  messaggio: string;
  bloccante: boolean;
  brand: { status: BrandOverall | ""; uso: string; nota: string };
  costo: { immagini: number; token: number; durata_ms: number; modello: string };
  /** Cosa e online adesso, e cosa le manca. */
  pubblicata: {
    proposal_revision: string;
    foto: number;
    mancanti: number;
    apertura_mancante: boolean;
    /** `degraded` = la pagina si apre ma non e piu quella approvata. */
    stato: StatoPubblicazione;
    avviso: string;
  } | null;
  /** I tetti, cosi la schermata puo dire quanto costera prima di
   *  spenderlo invece di scoprirlo dopo. */
  tetti: { immagini: number; in_pagina: number };
  ruoli: readonly string[];
}

export async function GET(req: Request) {
  const sessione = await getServerSession(authOptions).catch(() => null);
  if (!sessione) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "non autorizzato" }, { status: 401 },
    );
  }
  if (!turso) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "database non disponibile" }, { status: 503 },
    );
  }

  const url = new URL(req.url);
  const projectId = (url.searchParams.get("project_id") ?? "").trim();
  const leadId = (url.searchParams.get("lead_id") ?? "").trim();
  if (!projectId && !leadId) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "serve project_id oppure lead_id" }, { status: 422 },
    );
  }

  const progetto = projectId ? await getProject(projectId) : await getProjectByLead(leadId);
  if (!progetto) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "nessuna anteprima per questo lead" }, { status: 422 },
    );
  }

  const salvato = await leggiDossier(progetto.lead_id);
  const foto = salvato?.dossier ? fotoMostrabili(salvato.dossier, progetto.slug) : [];
  const proposta = await leggiProposta(progetto.id);
  const c = proposta?.curatela ?? null;

  const v = validaProposta(c, foto);
  const msg = messaggioValidazione(v, c);

  const perId = new Map((c?.scelte ?? []).map((s) => [s.candidate_id, s]));
  const revisione = new Map((c?.da_rivedere ?? []).map((x) => [x.candidate_id, x.motivo]));
  const visteAllora = new Set((c?.manifest_revision ?? "").split("|").filter(Boolean));

  const provino: FotoInProvino[] = foto.map((f): FotoInProvino => {
    const s = perId.get(f.id);
    return {
      candidate_id: f.id,
      indice: f.indice,
      src: f.src,
      larghezza: f.larghezza,
      altezza: f.altezza,
      attribuzione: f.attribuzione,
      attribuzione_obbligatoria: f.attribuzione_obbligatoria,
      stato: s?.stato ?? "unreviewed",
      layout_role: s?.stato === "selected" ? s.layout_role : "",
      object_position: s?.object_position ?? "50% 50%",
      order: s?.stato === "selected" ? s.order : 999,
      motivo_revisione: revisione.get(f.id) ?? "",
      // «Nuova» rispetto al manifest di ALLORA, non alle scelte: una
      // fotografia guardata e scartata non e materiale da guardare.
      nuova: visteAllora.size > 0 && !visteAllora.has(f.id),
    };
  }).sort((a, b) => a.order - b.order || a.indice - b.indice);

  const spec = await leggiPubblicata(progetto.id);
  const risolta = risolviSpec(spec, foto);

  const brandStatus = (proposta?.brand_status ?? "") as BrandOverall | "";
  const uso = brandStatus
    ? usoConsentito({
      primary_logo: null, alternate_logo: null, favicon: null,
      signage_reference: null, palette_candidates: [], brand_status: brandStatus,
      requires_operator_approval: false, candidates: [],
    })
    : { usa: "", nota: "" };

  return NextResponse.json<ApiResponse<Provino>>({
    success: true,
    data: {
      project_id: progetto.id,
      slug: progetto.slug,
      foto: provino,
      basis_revision: c?.basis_revision ?? "",
      manifest_revision: c?.manifest_revision ?? "",
      proposal_revision: c?.proposal_revision ?? "",
      approvata_il: proposta?.approvata_il ?? "",
      analisi_in_corso: Boolean(proposta?.in_corso_da),
      messaggio: msg.testo,
      bloccante: msg.bloccante,
      brand: { status: brandStatus, uso: uso.usa, nota: uso.nota },
      costo: proposta?.costo ?? { immagini: 0, token: 0, durata_ms: 0, modello: "" },
      pubblicata: spec ? {
        proposal_revision: spec.proposal_revision,
        foto: risolta.foto.length,
        mancanti: risolta.mancanti.length,
        apertura_mancante: risolta.apertura_mancante,
        stato: risolta.stato,
        avviso: messaggioPubblicazione(risolta.mancanti.length, risolta.apertura_mancante),
      } : null,
      tetti: { immagini: TETTI.immagini, in_pagina: MAX_IN_PAGINA },
      ruoli: SEQUENZA_RUOLI,
    },
  });
}
