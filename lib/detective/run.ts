import { analyzeCase } from "./analyze";
import { generateSlug, getCaseById, updateCase } from "./db";
import { runInvestigation } from "./investigate";

// ============================================================
// DETECTIVE run — orchestratore indagine singola:
// investigate (fonti pubbliche) -> analyze (Gemini, validato)
// -> report_ready con slug pubblico. Usato dall'API (manuale o
// batch); nessun cron in v1.
// ============================================================

/** Base URL dei report pubblici. */
function reportBase(): string {
  return (
    process.env.DETECTIVE_REPORT_BASE_URL?.replace(/\/$/, "") ||
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") ||
    "https://specter-ecru.vercel.app"
  );
}

export interface InvestigateOutcome {
  case_id: string;
  ok: boolean;
  status: string;
  error?: string;
}

export async function investigateAndAnalyze(
  caseId: string,
): Promise<InvestigateOutcome> {
  const c = await getCaseById(caseId);
  if (!c) {
    return { case_id: caseId, ok: false, status: "missing", error: "caso non trovato" };
  }

  try {
    // 1. Indagine fonti pubbliche.
    const raw = await runInvestigation(c);
    await updateCase(caseId, {
      raw_data: JSON.stringify(raw),
      status: "investigated",
      error: "",
    });

    if (raw.facts.length === 0) {
      const error =
        "nessun fatto verificabile raccolto (sito e scheda Google irraggiungibili?)";
      await updateCase(caseId, { error });
      return { case_id: caseId, ok: false, status: "investigated", error };
    }

    // 2. Analisi Gemini, validata. Lo slug nasce qui: serve nel
    //    messaggio WA, ma il report diventa pubblico solo quando lo
    //    stato passa a report_ready (getCaseBySlug filtra gli stati).
    const slug = c.report_slug || generateSlug();
    const reportUrl = `${reportBase()}/detective/${slug}`;
    const analysis = await analyzeCase({ ...c, report_slug: slug }, raw, reportUrl);

    if (!analysis) {
      const error =
        "analisi non generata (Gemini non disponibile o nessuna perdita con evidenze valide)";
      await updateCase(caseId, { error });
      return { case_id: caseId, ok: false, status: "investigated", error };
    }

    await updateCase(caseId, {
      scores: JSON.stringify(analysis.scores),
      losses: JSON.stringify(analysis.losses),
      analysis: JSON.stringify(analysis),
      report_slug: slug,
      wa_message: analysis.wa_message,
      status: "report_ready",
      error: "",
    });
    return { case_id: caseId, ok: true, status: "report_ready" };
  } catch (err) {
    const error = (err as Error).message.slice(0, 300);
    await updateCase(caseId, { error });
    return { case_id: caseId, ok: false, status: "error", error };
  }
}
