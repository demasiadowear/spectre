import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isCronAuthorized } from "@/lib/autopilot/cron-auth";
import { guardiaRichiesta } from "@/lib/guardia-richiesta";
import { turso } from "@/lib/turso";
import { getProject, getProjectByLead } from "@/lib/factory/db";
import { analizzaProgetto, type RisultatoAnalisi } from "@/lib/demo/analisi-progetto";
import {
  EVENTO_ANALISI, digest, httpAnalisi, riepilogoVuoto, scriviRiepilogo,
} from "@/lib/demo/telemetria-proposta";
import type { BrandOverall } from "@/types/dossier";
import type { ApiResponse } from "@/types";

// ============================================================
// «Analizza foto e identita».
//
// Il comando che spende: scarica le fotografie, le fa guardare a un
// modello, cerca il marchio. Quindi ha tre cancelli prima di
// qualunque byte.
//
//  1. SESSIONE OPERATORE. Non il bearer del cron, e non «sessione
//     oppure bearer» come la rotta del worker: QUESTA fase la lancia
//     una persona guardando una schermata, e la decide guardando il
//     costo che la schermata le mostra. Un cron che la lanciasse da
//     solo spenderebbe su ogni lead della coda senza che nessuno abbia
//     deciso niente.
//  2. STESSA ORIGINE. Il CSRF vale anche per una rotta che non
//     cancella niente: qui fa spendere, e far spendere e gia abbastanza.
//  3. IDEMPOTENZA. Sta nel modulo, non qui, ma e il terzo cancello: la
//     stessa richiesta due volte non paga due volte.
//
// La risposta non e mai 200 con un errore dentro. Vedi `httpAnalisi`.
// ============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  return NextResponse.json<ApiResponse<never>>(
    { success: false, error: "metodo GET non ammesso: questa rotta esegue un'analisi a pagamento" },
    { status: 405 },
  );
}

export async function POST(req: Request) {
  const g = guardiaRichiesta(req);
  if (!g.ok) {
    return NextResponse.json<ApiResponse<never>>({ success: false, error: g.error }, { status: g.status });
  }

  // Il cron non entra qui nemmeno con il segreto giusto. Lo si dice
  // esplicitamente invece di lasciarlo dedurre dall'assenza di sessione:
  // se un giorno qualcuno aggiungesse questa rotta a CRON_PATHS, questo
  // controllo resterebbe.
  if (isCronAuthorized(req)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "questa analisi si lancia da una sessione operatore, non dal cron" },
      { status: 401 },
    );
  }
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

  const raw = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const projectId = typeof raw.project_id === "string" ? raw.project_id.trim() : "";
  const leadId = typeof raw.lead_id === "string" ? raw.lead_id.trim() : "";
  const refresh = raw.refresh === true;

  if (!projectId && !leadId) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "serve project_id oppure lead_id" }, { status: 422 },
    );
  }

  const progetto = projectId ? await getProject(projectId) : await getProjectByLead(leadId);
  if (!progetto) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "nessuna anteprima per questo lead: creala prima" }, { status: 422 },
    );
  }

  const r = await analizzaProgetto(progetto.id, { refresh });
  const http = httpAnalisi(r.esito);
  registra(progetto.id, progetto.lead_id, r, http);

  if (http >= 400) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: messaggio(r) }, { status: http },
    );
  }
  return NextResponse.json<ApiResponse<RisultatoAnalisi>>(
    { success: true, data: r }, { status: http },
  );
}

/** Il messaggio d'errore: dice il rimedio quando c'e, e non nomina mai
 *  una variabile d'ambiente ne un valore. */
function messaggio(r: RisultatoAnalisi): string {
  if (r.rimedio) return r.rimedio;
  switch (r.esito) {
    case "dipendenza_fallita":
      return "Un fornitore non ha risposto durante l'analisi. Si può riprovare.";
    case "progetto_assente":
      return "Anteprima inesistente.";
    case "dossier_assente":
      return "Nessun dossier per questo lead: esegui prima la raccolta.";
    case "database_non_disponibile":
      return "Database non disponibile.";
    default:
      return "L'analisi non è arrivata in fondo.";
  }
}

function registra(projectId: string, leadId: string, r: RisultatoAnalisi, http: number): void {
  const scelte = r.proposta?.curatela.scelte ?? [];
  const conta = (s: string) => scelte.filter((x) => x.stato === s).length;
  scriviRiepilogo({
    ...riepilogoVuoto(EVENTO_ANALISI, projectId, leadId),
    status: r.esito,
    http,
    blocco: r.blocco,
    brand_status: (r.brand.status || "") as BrandOverall | "",
    manifest_digest: digest(r.proposta?.curatela.manifest_revision ?? ""),
    basis_digest: digest(r.proposta?.curatela.basis_revision ?? ""),
    proposal_revision: r.proposta?.curatela.proposal_revision ?? "",
    foto_totali: scelte.length,
    foto_selezionate: conta("selected"),
    foto_da_rivedere: conta("needs_review"),
    foto_scartate: conta("not_selected"),
    foto_non_viste: conta("unreviewed"),
    // I contatori strutturali: dicono DOVE si e fermata l'analisi.
    analysis_status: r.analysis_status,
    proposal_status: r.proposal_status,
    codice: r.codice,
    images_requested: r.conti.images_requested,
    images_downloaded: r.conti.images_downloaded,
    images_sent: r.conti.images_sent,
    model_items_returned: r.conti.model_items_returned,
    mapped_items: r.conti.mapped_items,
    invalid_indices: r.conti.invalid_indices,
    duplicate_indices: r.conti.duplicate_indices,
    selected_count: r.conti.selected_count,
    needs_review_count: r.conti.needs_review_count,
    parse_failures: r.conti.parse_failures,
    immagini_richieste: r.costo.immagini,
    immagini_analizzate: r.costo.analizzate,
    immagini_fallite: r.costo.fallite,
    token: r.costo.token,
    pagine_lette: r.costo.pagine,
    query_ricerca: r.costo.query,
    duration_ms: r.costo.durata_ms,
  });
}
