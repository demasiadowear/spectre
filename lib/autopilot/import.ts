import { getLeads } from "@/lib/data";
import { cityOf, classifyPhone } from "@/lib/pitch";
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

/** Place id (Google) già in pipeline — dedup più robusto del solo
 *  telefono (stessa attività, numero riformattato diversamente). */
async function pipelinePlaceIds(): Promise<Set<string>> {
  if (!turso) return new Set();
  const res = await turso.execute(
    "SELECT place_id FROM autopilot_pipeline WHERE place_id IS NOT NULL AND place_id != ''",
  );
  return new Set(res.rows.map((r) => String(r.place_id ?? "")).filter(Boolean));
}

export interface VisorImportCandidates {
  eligible: Lead[];
  /** Numero fisso riconosciuto (inizia per 0): niente WhatsApp. */
  skipped_fisso: number;
  /** Nessun telefono raccolto o non classificabile — DIVERSO da un
   *  fisso: qui non c'è proprio un numero da chiamare, va verificato
   *  a mano (Google Places spesso non ha il telefono per attività
   *  piccole/nuove). Confonderlo col fisso confondeva la diagnosi. */
  skipped_no_phone: number;
  /** Stesso telefono già in pipeline o duplicato nel lotto stesso. */
  skipped_duplicate: number;
  /** Callback pianificato: trattativa già seguita a mano. */
  skipped_callback: number;
}

/** Lead Visor importabili: mai contattati + mobile + non in pipeline.
 *  Riporta anche PERCHÉ gli altri sono stati esclusi, così l'operatore
 *  non si chiede "perché non ha importato niente" (es. lotto di soli
 *  numeri fissi dall'Hunter, che restano in leads per il canale voce). */
export async function classifyVisorLeads(): Promise<VisorImportCandidates> {
  const [leads, ids, phones] = await Promise.all([
    getLeads(),
    pipelineLeadIds(),
    pipelinePhones(),
  ]);
  const seen = new Set<string>(); // dedup interno (stesso telefono su 2 lead)
  const eligible: Lead[] = [];
  let skipped_fisso = 0;
  let skipped_no_phone = 0;
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
    // (restano in "leads" per il canale telefonico). Un telefono
    // assente/non classificabile NON è un fisso: è un caso diverso,
    // contato a parte.
    const kind = classifyPhone(l.phone);
    if (kind === "fisso") {
      skipped_fisso++;
      continue;
    }
    if (kind !== "mobile") {
      skipped_no_phone++;
      continue;
    }
    const phone = normalizePhone(l.phone);
    if (ids.has(l.id) || phones.has(phone) || seen.has(phone)) {
      skipped_duplicate++;
      continue;
    }
    seen.add(phone);
    eligible.push(l);
  }
  return {
    eligible,
    skipped_fisso,
    skipped_no_phone,
    skipped_duplicate,
    skipped_callback,
  };
}

/** Solo i lead eleggibili (compat: usato dalla GET di preview). */
export async function eligibleVisorLeads(): Promise<Lead[]> {
  return (await classifyVisorLeads()).eligible;
}

export interface PipelineAttachResult {
  added: number;
  skipped_fisso: number;
  /** Nessun telefono raccolto (es. Google Places senza numero) — non
   *  un fisso, un caso diverso: va verificato a mano, non richiamato. */
  skipped_no_phone: number;
  skipped_duplicate: number;
}

/**
 * Aggiunge in pipeline una lista di lead GIÀ CREATI in `leads` (tipico:
 * appena importati dall'Hunter), scoped alla lista data — non uno scan
 * dell'intera tabella come classifyVisorLeads/importFromVisor (che
 * restano per il "ripescaggio" di lead rimasti indietro per altre vie).
 * Da quando "Visor" non esiste più come pagina a sé, aspettare un
 * secondo click manuale per veder comparire un lead appena trovato è
 * solo un modo per farlo sembrare sparito — l'Hunter ora lo mette in
 * pipeline nello stesso passo, se è eleggibile. */
export async function addLeadsToPipeline(
  leads: Lead[],
): Promise<PipelineAttachResult> {
  if (!isTursoConnected() || leads.length === 0) {
    return { added: 0, skipped_fisso: 0, skipped_no_phone: 0, skipped_duplicate: 0 };
  }
  const [ids, phones, placeIds] = await Promise.all([
    pipelineLeadIds(),
    pipelinePhones(),
    pipelinePlaceIds(),
  ]);
  let added = 0;
  let skipped_fisso = 0;
  let skipped_no_phone = 0;
  let skipped_duplicate = 0;

  for (const l of leads) {
    const kind = classifyPhone(l.phone);
    if (kind === "fisso") {
      skipped_fisso++;
      continue;
    }
    if (kind !== "mobile") {
      skipped_no_phone++;
      continue;
    }
    const phone = normalizePhone(l.phone);
    // place_id reale (dall'Hunter, via meta): dedup più robusto del solo
    // telefono E permesso allo Study di saltare la ri-ricerca Places.
    const placeId = l.meta.place_id ?? "";
    if (ids.has(l.id) || phones.has(phone) || (placeId && placeIds.has(placeId))) {
      skipped_duplicate++;
      continue;
    }
    await insertPipelineRow({
      lead_id: l.id,
      place_id: placeId,
      category: l.meta.category ?? "attività",
      city: cityOf(l),
    });
    ids.add(l.id);
    phones.add(phone);
    if (placeId) placeIds.add(placeId);
    added++;
  }
  return { added, skipped_fisso, skipped_no_phone, skipped_duplicate };
}

export interface VisorImportResult {
  eligible: number;
  imported: number;
  skipped_fisso: number;
  skipped_no_phone: number;
  skipped_duplicate: number;
  skipped_callback: number;
}

/** Importa in batch tutti gli eleggibili in stage "da_contattare". Lo
 *  Study li prepara poi a lotti (primo messaggio WA). */
export async function importFromVisor(): Promise<VisorImportResult> {
  if (!isTursoConnected()) {
    throw new Error("Turso non configurato: l'import richiede il DB.");
  }
  const {
    eligible,
    skipped_fisso,
    skipped_no_phone,
    skipped_duplicate,
    skipped_callback,
  } = await classifyVisorLeads();
  let imported = 0;
  for (const l of eligible) {
    await insertPipelineRow({
      lead_id: l.id,
      place_id: l.meta.place_id ?? "",
      category: l.meta.category ?? "attività",
      city: cityOf(l),
    });
    imported++;
  }
  return {
    eligible: eligible.length,
    imported,
    skipped_fisso,
    skipped_no_phone,
    skipped_duplicate,
    skipped_callback,
  };
}
