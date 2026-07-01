import { getLeads } from "@/lib/data";
import { cityOf, isMobilePhone } from "@/lib/pitch";
import { isTursoConnected, turso } from "@/lib/turso";
import type { Lead } from "@/types";
import { insertPipelineRow, normalizePhone } from "./db";

// ============================================================
// Import manuale lead esistenti -> Pipeline. Prende i lead SPECTRE mai
// contattati (status "todo", quindi esclusi persi/clienti/
// trattative) con telefono, dedup contro la pipeline su lead_id
// e telefono normalizzato (i lead Visor non hanno place_id: lo
// risolve lo Study via Places prima di generare il messaggio).
// ============================================================

/** Telefoni normalizzati dei soli lead già in pipeline Autopilot.
 *  (knownPhones() copre TUTTI i leads: per l'import sarebbe sempre
 *  un match, ogni lead Visor è ovviamente nella tabella leads.) */
async function pipelinePhones(): Promise<Set<string>> {
  if (!turso) return new Set();
  const res = await turso.execute(
    `SELECT l.phone FROM autopilot_pipeline p
     JOIN leads l ON l.id = p.lead_id
     WHERE l.phone IS NOT NULL AND l.phone != ''`,
  );
  return new Set(
    res.rows.map((r) => normalizePhone(String(r.phone ?? ""))).filter(Boolean),
  );
}

async function pipelineLeadIds(): Promise<Set<string>> {
  if (!turso) return new Set();
  const res = await turso.execute("SELECT lead_id FROM autopilot_pipeline");
  return new Set(res.rows.map((r) => String(r.lead_id)));
}

export interface VisorImportCandidates {
  eligible: Lead[];
  /** Fisso o telefono non riconoscibile: niente WhatsApp, restano in Visor. */
  skipped_fisso: number;
  /** Stesso telefono già in pipeline o duplicato nel lotto stesso. */
  skipped_duplicate: number;
  /** Callback pianificato: trattativa già seguita a mano. */
  skipped_callback: number;
}

/** Lead Visor importabili: mai contattati + telefono + non in pipeline.
 *  Riporta anche PERCHÉ gli altri sono stati esclusi, così l'operatore
 *  non si chiede "perché non ha importato niente" (es. lotto di soli
 *  numeri fissi dall'Hunter, che restano in Visor per il canale voce). */
export async function classifyVisorLeads(): Promise<VisorImportCandidates> {
  const [leads, ids, phones] = await Promise.all([
    getLeads(),
    pipelineLeadIds(),
    pipelinePhones(),
  ]);
  const seen = new Set<string>(); // dedup interno (stesso telefono su 2 lead)
  const eligible: Lead[] = [];
  let skipped_fisso = 0;
  let skipped_duplicate = 0;
  let skipped_callback = 0;

  for (const l of leads) {
    if (l.status !== "todo") continue; // non è un candidato pipeline
    // Callback pianificato = gestione manuale in corso anche se lo
    // status è rimasto "todo" (caso Giosuè): l'autopilot non deve
    // toccare trattative seguite a mano.
    if (l.meta.callback) {
      skipped_callback++;
      continue;
    }
    // Solo mobili: i fissi non sono su WhatsApp, inutile importarli
    // (restano in Visor per il canale telefonico).
    const phone = normalizePhone(l.phone);
    if (!isMobilePhone(l.phone) || !phone) {
      skipped_fisso++;
      continue;
    }
    if (ids.has(l.id) || phones.has(phone) || seen.has(phone)) {
      skipped_duplicate++;
      continue;
    }
    seen.add(phone);
    eligible.push(l);
  }
  return { eligible, skipped_fisso, skipped_duplicate, skipped_callback };
}

/** Solo i lead eleggibili (compat: usato dalla GET di preview). */
export async function eligibleVisorLeads(): Promise<Lead[]> {
  return (await classifyVisorLeads()).eligible;
}

export interface VisorImportResult {
  eligible: number;
  imported: number;
  skipped_fisso: number;
  skipped_duplicate: number;
  skipped_callback: number;
}

/** Importa in batch tutti gli eleggibili in stage "da_contattare". Lo
 *  Study li prepara poi a lotti (primo messaggio WA). */
export async function importFromVisor(): Promise<VisorImportResult> {
  if (!isTursoConnected()) {
    throw new Error("Turso non configurato: l'import richiede il DB.");
  }
  const { eligible, skipped_fisso, skipped_duplicate, skipped_callback } =
    await classifyVisorLeads();
  let imported = 0;
  for (const l of eligible) {
    await insertPipelineRow({
      lead_id: l.id,
      place_id: "",
      category: l.meta.category ?? "attività",
      city: cityOf(l),
    });
    imported++;
  }
  return {
    eligible: eligible.length,
    imported,
    skipped_fisso,
    skipped_duplicate,
    skipped_callback,
  };
}
