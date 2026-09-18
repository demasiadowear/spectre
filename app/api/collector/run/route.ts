import { NextResponse } from "next/server";
import { leggiDossier } from "@/lib/collector/db";
import { statoOperativo } from "@/lib/collector/pronto";
import { getLeadById } from "@/lib/data";
import { guardiaRichiesta } from "@/lib/guardia-richiesta";
import { dedupKeyFor, enqueueJob } from "@/lib/factory/queue";
import { runJobNow } from "@/lib/factory/orchestrator";
import {
  EVENTO_RACCOLTA, riepilogo, scriviRiepilogo, statoHttp, type ErrorCode,
} from "@/lib/collector/telemetria";
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

export interface RispostaRun {
  job_id: string;
  lead_id: string;
  enqueued: boolean;
  stato: string;
  esito: string;
  errore: string;
  ms: number;
  recommendation: string;
}


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
      // Input invalido, non «richiesta malformata»: la differenza
      // conta per chi guarda i codici in un grafico.
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "serve lead_id" }, { status: 422 },
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
      // Un lead_id che non esiste e un input invalido quanto uno vuoto:
      // in entrambi i casi la richiesta non e eseguibile cosi com'e.
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "lead inesistente" }, { status: 422 },
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

    // Un job vivo con la stessa chiave esiste gia: non se ne avvia un
    // secondo. Si restituisce quello, con 202, e la dashboard si
    // aggancia al suo stato invece di rifare il lavoro.
    if (!accodato.created) {
      return NextResponse.json<ApiResponse<RispostaRun>>({
        success: true,
        data: {
          job_id: accodato.id, lead_id: leadId, enqueued: false,
          stato: "already_running", esito: "", errore: "", ms: 0,
          recommendation: "",
        },
      }, { status: 202 });
    }

    // Si esegue QUESTO job, non «un job di questo tipo»: chi preme il
    // bottone su un lead si aspetta che giri quello. Il worker
    // periodico sceglie per priorita e poteva prendere il job di un
    // altro lead, il che in un collaudo e indistinguibile da un difetto.
    const run = await runJobNow(accodato.id);
    const salvato = await leggiDossier(leadId);

    // Il riepilogo va nei log SEMPRE, riuscita o meno: e l'unico modo
    // di sapere com'e andata senza aprire la dashboard. Contiene solo
    // numeri, enum e i due identificativi — nessun nome, telefono,
    // indirizzo, URL o frammento del dossier.
    const codiceNoto: ErrorCode | undefined =
      run.stato === "paused" ? "factory_paused"
      : run.stato === "not_claimed" ? "job_not_claimed"
      : run.stato === "no_db" ? "database_unavailable"
      : undefined;

    const r = riepilogo(
      salvato?.dossier ?? null,
      salvato?.phases ?? [],
      {
        job_id: run.job_id || accodato.id,
        lead_id: leadId,
        status: run.stato === "completed" ? "completed" : "failed",
        duration_ms: run.ms,
        error_code: codiceNoto,
      },
      EVENTO_RACCOLTA,
    );
    scriviRiepilogo(r);

    const corpo: RispostaRun = {
      job_id: run.job_id || accodato.id,
      lead_id: run.lead_id || leadId,
      enqueued: accodato.created,
      stato: run.stato,
      esito: run.outcome,
      errore: run.error,
      ms: run.ms,
      recommendation: salvato?.recommendation ?? "",
    };

    return NextResponse.json<ApiResponse<RispostaRun>>(
      { success: run.stato === "completed", data: corpo, ...(run.stato === "completed" ? {} : { error: run.error }) },
      { status: statoHttp(run.stato, r.error_code) },
    );
  } catch (e) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (e as Error).message }, { status: 500 },
    );
  }
}
