import { randomUUID } from "crypto";
import { turso } from "@/lib/turso";
import { senzaSemantica } from "./policy-media";
import type { CuratelaProgetto, SceltaFoto } from "./curatela";
import type { SpecPubblicata } from "./pubblicazione";

// ============================================================
// Le proposte di impaginazione, e cio che e stato PUBBLICATO.
//
// DUE TABELLE, NON UNA CON PIU COLONNE.
//
//   demo_proposte      la composizione corrente e il suo stato di
//                      lavorazione: proposta, modificata, approvata.
//   demo_pubblicazioni cio che la demo mostra adesso.
//
// Sono separate perche una pubblicazione che non riesce NON deve poter
// toccare quella che regge: se stessero nella stessa riga, un update
// sbagliato le porterebbe via insieme. Cosi la demo precedente resta
// online per costruzione, non per attenzione.
//
// Una riga per progetto in entrambe, e nessuno storico: tenerlo
// significherebbe conservare nel tempo tutte le composizioni derivate
// da fotografie di Places — indici e ritagli, d'accordo, ma un archivio
// che non serve a nessuno e che cresce.
//
// `senzaSemantica()` passa su tutto prima della scrittura. E la terza
// difesa dopo il tipo e la funzione di analisi, ed e quella che sta nel
// punto giusto: fra l'oggetto e il disco.
// ============================================================

let pronto = false;

export async function ensureProposteSchema(): Promise<void> {
  if (!turso || pronto) return;
  await turso.executeMultiple(`
    create table if not exists demo_proposte (
      project_id       text primary key,
      lead_id          text not null,
      basis_revision   text not null default '',
      manifest_revision text not null default '',
      proposal_revision text not null default '',
      scelte           text not null default '[]',
      da_rivedere      text not null default '[]',
      brand_status     text not null default 'PENDING',
      brand_blocco     text not null default '',
      -- Costo e durata: numeri, mai contenuto.
      immagini         integer not null default 0,
      token            integer not null default 0,
      durata_ms        integer not null default 0,
      modello          text not null default '',
      -- Il lucchetto dell'analisi. Un timestamp e non un booleano: un
      -- booleano che nessuno azzera perche il processo e morto blocca
      -- il progetto per sempre.
      in_corso_da      text,
      approvata_il     text,
      composta_il      text default (datetime('now')),
      updated_at       text default (datetime('now'))
    );
    create index if not exists idx_proposte_lead on demo_proposte(lead_id);

    create table if not exists demo_pubblicazioni (
      project_id        text primary key,
      lead_id           text not null,
      proposal_revision text not null default '',
      basis_revision    text not null default '',
      spec              text not null default '{}',
      pubblicata_il     text default (datetime('now'))
    );
  `);
  pronto = true;
}

export function resetProposteSchemaCache(): void { pronto = false; }

export interface PropostaSalvata {
  curatela: CuratelaProgetto;
  brand_status: string;
  brand_blocco: string;
  costo: { immagini: number; token: number; durata_ms: number; modello: string };
  approvata_il: string;
  /** Quando un'analisi e in corso, da quando. Vuoto se nessuna. */
  in_corso_da: string;
}

const parse = <T>(v: unknown, d: T): T => {
  if (typeof v !== "string" || !v) return d;
  try { return JSON.parse(v) as T; } catch { return d; }
};

const testo = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

export async function leggiProposta(projectId: string): Promise<PropostaSalvata | null> {
  if (!turso) return null;
  await ensureProposteSchema();
  const rs = await turso.execute({
    sql: "select * from demo_proposte where project_id = ? limit 1",
    args: [projectId],
  });
  const r = rs.rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    curatela: {
      basis_revision: testo(r.basis_revision),
      manifest_revision: testo(r.manifest_revision),
      proposal_revision: testo(r.proposal_revision),
      scelte: parse(r.scelte, [] as SceltaFoto[]),
      da_rivedere: parse(r.da_rivedere, [] as CuratelaProgetto["da_rivedere"]),
      composta_il: testo(r.composta_il),
    },
    brand_status: testo(r.brand_status) || "PENDING",
    brand_blocco: testo(r.brand_blocco),
    costo: {
      immagini: Number(r.immagini ?? 0),
      token: Number(r.token ?? 0),
      durata_ms: Number(r.durata_ms ?? 0),
      modello: testo(r.modello),
    },
    approvata_il: testo(r.approvata_il),
    in_corso_da: testo(r.in_corso_da),
  };
}

export interface DaSalvare {
  project_id: string;
  lead_id: string;
  curatela: CuratelaProgetto;
  brand_status: string;
  brand_blocco: string;
  costo: { immagini: number; token: number; durata_ms: number; modello: string };
  approvata_il?: string;
}

export async function salvaProposta(d: DaSalvare): Promise<void> {
  if (!turso) return;
  await ensureProposteSchema();
  // La rete, nel punto in cui i tipi smettono di valere: qui si
  // serializza, e `JSON.stringify` non sa niente delle interfacce.
  const scelte = JSON.stringify(senzaSemantica(d.curatela.scelte));
  const rivedere = JSON.stringify(senzaSemantica(d.curatela.da_rivedere));

  await turso.execute({
    sql: `insert into demo_proposte
            (project_id, lead_id, basis_revision, manifest_revision,
             proposal_revision, scelte, da_rivedere, brand_status, brand_blocco,
             immagini, token, durata_ms, modello, approvata_il, composta_il, updated_at)
          values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
          on conflict(project_id) do update set
            basis_revision = excluded.basis_revision,
            manifest_revision = excluded.manifest_revision,
            proposal_revision = excluded.proposal_revision,
            scelte = excluded.scelte,
            da_rivedere = excluded.da_rivedere,
            brand_status = excluded.brand_status,
            brand_blocco = excluded.brand_blocco,
            immagini = excluded.immagini,
            token = excluded.token,
            durata_ms = excluded.durata_ms,
            modello = excluded.modello,
            approvata_il = excluded.approvata_il,
            composta_il = excluded.composta_il,
            updated_at = datetime('now')`,
    args: [
      d.project_id, d.lead_id, d.curatela.basis_revision, d.curatela.manifest_revision,
      d.curatela.proposal_revision, scelte, rivedere, d.brand_status, d.brand_blocco,
      d.costo.immagini, d.costo.token, d.costo.durata_ms, d.costo.modello,
      d.approvata_il ?? null, d.curatela.composta_il || new Date().toISOString(),
    ],
  });
}

// ----- Il lucchetto dell'analisi -------------------------------------

/** Oltre questo, un'analisi in corso si considera morta e il lucchetto
 *  si puo riprendere. Piu lungo della durata massima di una richiesta
 *  serverless, cosi non si riparte sopra a una che sta ancora girando. */
export const SCADENZA_LUCCHETTO_MIN = 5;

/**
 * Prende il lucchetto dell'analisi, se e libero.
 *
 * Il controllo sta nel `where` della UPDATE e non in una lettura
 * seguita da una scrittura: due click ravvicinati arrivano a due
 * istanze diverse, e fra la lettura e la scrittura ci passa comodamente
 * la seconda. Una riga aggiornata significa che il lucchetto e nostro;
 * zero righe significa che sta gia girando.
 */
export async function rivendicaAnalisi(projectId: string, leadId: string): Promise<boolean> {
  if (!turso) return false;
  await ensureProposteSchema();
  // La riga deve esistere perche una UPDATE possa contarla. `or ignore`
  // non tocca niente se c'e gia.
  await turso.execute({
    sql: `insert or ignore into demo_proposte (project_id, lead_id) values (?, ?)`,
    args: [projectId, leadId],
  });
  const rs = await turso.execute({
    sql: `update demo_proposte
             set in_corso_da = datetime('now'), updated_at = datetime('now')
           where project_id = ?
             and (in_corso_da is null or in_corso_da = ''
                  or in_corso_da < datetime('now', ?))`,
    args: [projectId, `-${SCADENZA_LUCCHETTO_MIN} minutes`],
  });
  return rs.rowsAffected > 0;
}

export async function rilasciaAnalisi(projectId: string): Promise<void> {
  if (!turso) return;
  await ensureProposteSchema();
  await turso.execute({
    sql: `update demo_proposte set in_corso_da = null where project_id = ?`,
    args: [projectId],
  });
}

// ----- Approvazione ---------------------------------------------------

export interface DaApprovare {
  /** La base che l'operatore aveva davanti quando ha deciso. */
  basis_attesa: string;
  /** La composizione come l'ha lasciata: puo aver tolto, riordinato,
   *  cambiato l'apertura. */
  scelte: SceltaFoto[];
  /** La base ricalcolata sulle scelte nuove. */
  basis_nuova: string;
  proposal_revision: string;
}

/**
 * Approva la proposta SE la base non e cambiata nel frattempo.
 *
 * Il confronto sta nel `where` della UPDATE, non in una lettura seguita
 * da una scrittura: fra le due ci sta una raccolta che cambia il
 * manifest, e l'approvazione andrebbe a buon fine su una base che non
 * esiste piu. Una riga aggiornata significa che la base era ancora
 * quella; zero righe significa che qualcuno e arrivato prima.
 */
export async function approvaSeAncoraValida(
  projectId: string,
  d: DaApprovare,
): Promise<boolean> {
  if (!turso) return false;
  await ensureProposteSchema();
  const rs = await turso.execute({
    sql: `update demo_proposte
             set scelte = ?, basis_revision = ?, proposal_revision = ?,
                 approvata_il = datetime('now'), updated_at = datetime('now')
           where project_id = ? and basis_revision = ?`,
    args: [
      JSON.stringify(senzaSemantica(d.scelte)), d.basis_nuova, d.proposal_revision,
      projectId, d.basis_attesa,
    ],
  });
  return rs.rowsAffected > 0;
}

/** Rifiuto: si registra che nessuna di queste fotografie va in pagina.
 *  Non tocca la pubblicazione — cio che e online resta online. */
export async function rifiutaProposta(projectId: string, basisAttesa: string): Promise<boolean> {
  if (!turso) return false;
  await ensureProposteSchema();
  const attuale = await leggiProposta(projectId);
  if (!attuale) return false;
  const scelte = attuale.curatela.scelte.map((s) => ({ ...s, stato: "not_selected" as const }));
  const rs = await turso.execute({
    sql: `update demo_proposte
             set scelte = ?, basis_revision = '', proposal_revision = '',
                 approvata_il = null, updated_at = datetime('now')
           where project_id = ? and basis_revision = ?`,
    args: [JSON.stringify(senzaSemantica(scelte)), projectId, basisAttesa],
  });
  return rs.rowsAffected > 0;
}

export const nuovaRevisioneProposta = (): string => randomUUID().replace(/-/g, "").slice(0, 12);

// ----- Pubblicazione --------------------------------------------------

export async function leggiPubblicata(projectId: string): Promise<SpecPubblicata | null> {
  if (!turso) return null;
  await ensureProposteSchema();
  const rs = await turso.execute({
    sql: "select spec from demo_pubblicazioni where project_id = ? limit 1",
    args: [projectId],
  });
  const r = rs.rows[0] as { spec?: unknown } | undefined;
  if (!r) return null;
  const s = parse<SpecPubblicata | null>(r.spec, null);
  return s && Array.isArray(s.foto) ? s : null;
}

export async function salvaPubblicata(
  projectId: string, leadId: string, spec: SpecPubblicata,
): Promise<void> {
  if (!turso) return;
  await ensureProposteSchema();
  await turso.execute({
    sql: `insert into demo_pubblicazioni
            (project_id, lead_id, proposal_revision, basis_revision, spec, pubblicata_il)
          values (?,?,?,?,?, datetime('now'))
          on conflict(project_id) do update set
            proposal_revision = excluded.proposal_revision,
            basis_revision = excluded.basis_revision,
            spec = excluded.spec,
            pubblicata_il = datetime('now')`,
    args: [
      projectId, leadId, spec.proposal_revision, spec.basis_revision,
      JSON.stringify(senzaSemantica(spec)),
    ],
  });
}
