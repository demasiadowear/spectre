import { NextResponse } from "next/server";
import { leggiDossier } from "@/lib/collector/db";
import { statoOperativo } from "@/lib/collector/pronto";
import { getLeadById } from "@/lib/data";
import { guardiaRichiesta } from "@/lib/guardia-richiesta";
import { dedupKeyFor, enqueueJob } from "@/lib/factory/queue";
import { runJobNow } from "@/lib/factory/orchestrator";
import { FASI, type CollectPhase } from "@/types/dossier";
import type { ApiResponse } from "@/types";

// ============================================================
// Avvia la raccolta su UN lead.
//
// L'ingresso e un `lead_id` e nient'altro. Non si accetta un URL, e
// non e una svista: un endpoint che scarica un URL scelto da chi
// chiama e uno scanner a disposizione di chiunque ottenga una
// sessione, e un modo per farsi leggere la rete interna. Gli URL che
// il collector visita vengono da Google Places o dall'HTML del sito
// che Places dichiara, e passano tutti dalla guardia SSRF.
//
// `solo` consente di rilanciare le sole fasi fallite. Anche quello e
// un elenco chiuso di nomi di fase: non passa nulla di arbitrario.
//
// Sta dietro il middleware con la sessione operatore, come tutte le
// rotte /api/* che non sono esplicitamente escluse.
// ============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET su una rotta che muta: 405, mai una mutazione. */
export async function GET() {
  return NextResponse.json<ApiResponse<never>>(
    { success: false, error: "metodo GET non ammesso: questa rotta avvia un job e accetta solo POST" },
    { status: 405 },
  );
}

export async function POST(req: Request) {
  try {
    // Prima di leggere il corpo: una richiesta da rifiutare non si
    // legge nemmeno.
    const g = guardiaRichiesta(req);
    if (!g.ok) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: g.error }, { status: g.status },
      );
    }

    const body: unknown = await req.json().catch(() => ({}));
    const raw = (body ?? {}) as Record<string, unknown>;
    const leadId = typeof raw.lead_id === "string" ? raw.lead_id.trim() : "";

    if (!leadId) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "serve lead_id" }, { status: 400 },
      );
    }

    // Il lead deve esistere davvero: un id inventato non deve nemmeno
    // arrivare a mettere un job in coda.
    // Si controlla PRIMA di toccare qualunque cosa: finche
    // autenticazione e database non sono pronti non si accoda nulla e
    // non si esegue nulla. La stessa funzione accende o spegne il
    // bottone nella dashboard, cosi non esistono due idee di «pronto».
    const stato = await statoOperativo();
    if (!stato.pronto) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: stato.motivi.join(" · ") },
        { status: 503 },
      );
    }

    const lead = await getLeadById(leadId);
    if (!lead) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "lead inesistente" }, { status: 404 },
      );
    }

    // Solo nomi di fase noti. Qualunque altra cosa si ignora.
    const solo = Array.isArray(raw.solo)
      ? (raw.solo as unknown[])
          .filter((p): p is CollectPhase => typeof p === "string" && FASI.indexOf(p as CollectPhase) !== -1)
      : [];

    const accodato = await enqueueJob({
      lead_id: leadId,
      kind: "collect_business_intelligence",
      reason: solo.length
        ? `rilancio delle fasi ${solo.join(", ")} richiesto dalla dashboard`
        : "raccolta dati e fotografie richiesta dalla dashboard",
      payload: solo.length ? { solo } : {},
      budget: 6,
      priority: 10,
      // Chiave con ambito: due raccolte complete sullo stesso lead si
      // escludono, una completa e un rilancio parziale convivono. Se un
      // job vivo con questa chiave esiste gia, `enqueueJob` restituisce
      // QUELLO invece di crearne un secondo — che e cio che succedeva
      // premendo due volte di seguito.
      dedup_key: dedupKeyFor("collect_business_intelligence", leadId, solo),
    });

    if (!accodato.id) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "impossibile accodare il job" }, { status: 500 },
      );
    }

    // Si esegue QUESTO job, non «un job di questo tipo»: chi preme il
    // bottone su un lead si aspetta che giri quello. Il worker
    // periodico sceglie per priorita e poteva prendere il job di un
    // altro lead, il che in un collaudo e indistinguibile da un difetto.
    const run = await runJobNow(accodato.id);
    const salvato = await leggiDossier(leadId);

    return NextResponse.json<ApiResponse<{
      job_id: string;
      lead_id: string;
      enqueued: boolean;
      stato: string;
      esito: string;
      errore: string;
      ms: number;
      recommendation: string;
    }>>({
      success: true,
      data: {
        job_id: run.job_id || accodato.id,
        lead_id: run.lead_id || leadId,
        enqueued: accodato.created,
        stato: run.stato,
        esito: run.outcome,
        errore: run.error,
        ms: run.ms,
        recommendation: salvato?.recommendation ?? "",
      },
    });
  } catch (e) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (e as Error).message }, { status: 500 },
    );
  }
}
