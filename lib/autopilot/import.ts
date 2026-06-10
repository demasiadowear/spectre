import { getLeads } from "@/lib/data";
import { cityOf, isMobilePhone } from "@/lib/pitch";
import { isTursoConnected, turso } from "@/lib/turso";
import type { Lead } from "@/types";
import { scoreTier } from "./constants";
import { insertPipelineRow, normalizePhone } from "./db";

// ============================================================
// Import manuale Visor -> Autopilot. Prende i lead SPECTRE mai
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

/** Lead Visor importabili: mai contattati + telefono + non in pipeline. */
export async function eligibleVisorLeads(): Promise<Lead[]> {
  const [leads, ids, phones] = await Promise.all([
    getLeads(),
    pipelineLeadIds(),
    pipelinePhones(),
  ]);
  const seen = new Set<string>(); // dedup interno (stesso telefono su 2 lead)
  return leads.filter((l) => {
    if (l.status !== "todo") return false;
    // Solo mobili: i fissi non sono su WhatsApp, inutile importarli
    // (restano in Visor per il canale telefonico).
    if (!isMobilePhone(l.phone)) return false;
    const phone = normalizePhone(l.phone);
    if (!phone) return false;
    if (ids.has(l.id) || phones.has(phone) || seen.has(phone)) return false;
    seen.add(phone);
    return true;
  });
}

export interface VisorImportResult {
  eligible: number;
  imported: number;
}

/** Importa in batch tutti gli eleggibili in stage "nuovo". Lo Study
 *  li processa poi a lotti (tier più alto prima), entro i cap. */
export async function importFromVisor(): Promise<VisorImportResult> {
  if (!isTursoConnected()) {
    throw new Error("Turso non configurato: l'import richiede il DB.");
  }
  const eligible = await eligibleVisorLeads();
  let imported = 0;
  for (const l of eligible) {
    const rating = l.meta.rating ?? 0;
    const reviews = l.meta.reviews ?? 0;
    // Senza dati Places il tier resta prudente (T3): lo Study li
    // recupera prima di generare il messaggio.
    const tier = rating > 0 && reviews > 0 ? scoreTier(rating, reviews) : "T3";
    await insertPipelineRow({
      lead_id: l.id,
      tier,
      place_id: "",
      category: l.meta.category ?? "attività",
      city: cityOf(l),
    });
    imported++;
  }
  return { eligible: eligible.length, imported };
}
