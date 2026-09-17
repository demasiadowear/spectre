// ============================================================
// Persistenza del dossier.
//
// Una tabella sola, `business_dossiers`, con il dossier come JSON e le
// poche colonne su cui si interroga davvero (lead, place_id,
// raccomandazione, stato). Il resto sta dentro il JSON perche e un
// documento: ha senso letto tutto insieme, non a pezzi.
//
// Le fasi stanno in una colonna separata, non dentro il dossier: il
// dossier e il risultato, le fasi sono come ci si e arrivati, e servono
// anche quando il risultato e parziale.
//
// I media NON si salvano qui come byte. Il manifest contiene
// riferimenti, checksum quando ci sono, e diritti. I byte andranno in
// object storage quando esistera (ADR-001).
// ============================================================

import { randomUUID } from "crypto";
import { turso } from "@/lib/turso";
import type { BusinessDossier, CollectProgress, PhaseState } from "@/types/dossier";

let schemaPronto = false;

export async function ensureCollectorSchema(): Promise<void> {
  if (!turso || schemaPronto) return;
  await turso.executeMultiple(`
    create table if not exists business_dossiers (
      id               text primary key,
      lead_id          text not null,
      place_id         text default '',
      official_site    text default '',
      recommendation   text default 'REVIEW',
      dossier          text default '{}',
      phases           text default '[]',
      job_id           text default '',
      external_calls   integer not null default 0,
      total_ms         integer not null default 0,
      created_at       text default (datetime('now')),
      updated_at       text default (datetime('now'))
    );
    create index if not exists idx_dossier_lead on business_dossiers(lead_id);
    create index if not exists idx_dossier_reco on business_dossiers(recommendation);

    -- Decisione umana su un'immagine. Separata dal dossier perche il
    -- dossier si rigenera e l'approvazione no: e un atto di una persona
    -- e deve sopravvivere alla raccolta successiva.
    create table if not exists media_decisions (
      id           text primary key,
      lead_id      text not null,
      media_id     text not null,
      source_url   text default '',
      decision     text not null,
      decided_by   text default 'puccio',
      note         text default '',
      decided_at   text default (datetime('now'))
    );
    create unique index if not exists idx_media_dec on media_decisions(lead_id, media_id);
  `);
  schemaPronto = true;
}

export function resetCollectorSchemaCache(): void {
  schemaPronto = false;
}

export async function salvaDossier(input: {
  dossier: BusinessDossier;
  phases: PhaseState[];
  job_id?: string;
}): Promise<string> {
  if (!turso) return "";
  await ensureCollectorSchema();
  const d = input.dossier;

  // Un lead ha un dossier corrente, non uno storico: la raccolta
  // successiva sostituisce la precedente. Lo storico, se servira,
  // avra una tabella sua e una ragione per esistere.
  const esistente = await turso.execute({
    sql: `select id from business_dossiers where lead_id = ? limit 1`,
    args: [d.lead_id],
  });
  const id = esistente.rows[0] ? String((esistente.rows[0] as Record<string, unknown>).id) : randomUUID();

  await turso.execute({
    sql: `insert into business_dossiers
            (id, lead_id, place_id, official_site, recommendation, dossier, phases,
             job_id, external_calls, total_ms, created_at, updated_at)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          on conflict(id) do update set
            place_id = excluded.place_id,
            official_site = excluded.official_site,
            recommendation = excluded.recommendation,
            dossier = excluded.dossier,
            phases = excluded.phases,
            job_id = excluded.job_id,
            external_calls = excluded.external_calls,
            total_ms = excluded.total_ms,
            updated_at = datetime('now')`,
    args: [
      id, d.lead_id, d.place_id, d.official_site, d.recommendation,
      JSON.stringify(d), JSON.stringify(input.phases),
      input.job_id ?? "", d.cost.external_calls, d.cost.total_ms,
    ],
  });
  return id;
}

export interface DossierSalvato {
  id: string;
  lead_id: string;
  recommendation: string;
  dossier: BusinessDossier;
  phases: PhaseState[];
  job_id: string;
  external_calls: number;
  total_ms: number;
  updated_at: string;
}

function parse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export async function leggiDossier(leadId: string): Promise<DossierSalvato | null> {
  if (!turso) return null;
  await ensureCollectorSchema();
  const rs = await turso.execute({
    sql: `select * from business_dossiers where lead_id = ? limit 1`,
    args: [leadId],
  });
  const r = rs.rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: String(r.id),
    lead_id: String(r.lead_id),
    recommendation: String(r.recommendation ?? "REVIEW"),
    dossier: parse<BusinessDossier>(r.dossier, {} as BusinessDossier),
    phases: parse<PhaseState[]>(r.phases, []),
    job_id: String(r.job_id ?? ""),
    external_calls: Number(r.external_calls ?? 0),
    total_ms: Number(r.total_ms ?? 0),
    updated_at: String(r.updated_at ?? ""),
  };
}

/** Le fasi, per la dashboard, senza caricare tutto il dossier. */
export async function leggiProgresso(leadId: string): Promise<CollectProgress | null> {
  const d = await leggiDossier(leadId);
  if (!d) return null;
  const corrente = d.phases.find((p) => p.status === "running");
  return {
    lead_id: leadId,
    job_id: d.job_id,
    phases: d.phases,
    current: corrente?.phase ?? null,
    finished_at: d.updated_at,
    error: d.phases.filter((p) => p.status === "failed").map((p) => `${p.phase}: ${p.detail}`).join(" · "),
  };
}

/** Approva o blocca un'immagine. E l'unico modo in cui un media passa
 *  da `preview_only` a utilizzabile: nessuna euristica puo farlo. */
export async function decidiMedia(input: {
  lead_id: string;
  media_id: string;
  source_url: string;
  decision: "approved" | "blocked";
  note?: string;
  decided_by?: string;
}): Promise<void> {
  if (!turso) return;
  await ensureCollectorSchema();
  await turso.execute({
    sql: `insert into media_decisions (id, lead_id, media_id, source_url, decision, decided_by, note, decided_at)
          values (?, ?, ?, ?, ?, ?, ?, datetime('now'))
          on conflict(lead_id, media_id) do update set
            decision = excluded.decision,
            note = excluded.note,
            decided_by = excluded.decided_by,
            decided_at = datetime('now')`,
    args: [
      randomUUID(), input.lead_id, input.media_id, input.source_url,
      input.decision, input.decided_by ?? "puccio", input.note ?? "",
    ],
  });
}

export async function decisioniMedia(leadId: string): Promise<Record<string, "approved" | "blocked">> {
  if (!turso) return {};
  await ensureCollectorSchema();
  const rs = await turso.execute({
    sql: `select media_id, decision from media_decisions where lead_id = ?`,
    args: [leadId],
  });
  const out: Record<string, "approved" | "blocked"> = {};
  for (const row of rs.rows) {
    const r = row as Record<string, unknown>;
    out[String(r.media_id)] = String(r.decision) === "approved" ? "approved" : "blocked";
  }
  return out;
}
