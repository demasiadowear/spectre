// ============================================================
// Aggiungere colonne a una tabella che potrebbe non esserci.
//
// La versione precedente faceva partire l'ALTER e catturava
// «no such table». Funzionava, ed era sbagliato per due motivi.
//
// Il primo: un'eccezione non e un controllo di flusso. «La tabella non
// c'e» e una condizione prevista e va verificata prima, non scoperta
// sbattendoci contro.
//
// Il secondo, piu grave: catturare «no such table» rende indistinguibile
// l'assenza LEGITTIMA di una tabella opzionale da un errore vero — un
// nome sbagliato, uno schema mai applicato, un database puntato male.
// Tutti e tre producono lo stesso messaggio, e tutti e tre venivano
// ignorati allo stesso modo. Il risultato e uno schema aggiornato a
// meta che si comporta bene finche qualcuno non legge una colonna che
// non esiste.
//
// Qui l'esistenza si chiede a `sqlite_master`, e l'unico errore
// tollerato sull'ALTER e «duplicate column», che significa esattamente
// «questa migrazione e gia stata applicata».
// ============================================================

import type { Client } from "@libsql/client";

export type EsitoMigrazione =
  /** Tabella presente: le colonne mancanti sono state aggiunte. */
  | "applicata"
  /** Tabella presente e colonne gia tutte al loro posto. */
  | "gia_applicata"
  /** Tabella opzionale assente: non c'e niente da migrare, e va bene. */
  | "migration_not_applicable";

export interface RapportoMigrazione {
  tabella: string;
  esito: EsitoMigrazione;
  /** Colonne aggiunte adesso. */
  aggiunte: string[];
  /** Colonne che c'erano gia. */
  gia_presenti: string[];
  /** Perche non era applicabile, quando non lo era. */
  motivo: string;
}

export interface ColonnaDaAggiungere {
  nome: string;
  /** Il frammento SQL dopo il nome: tipo e default. */
  definizione: string;
}

/** La tabella esiste? Si chiede, non si deduce da un errore. */
export async function tabellaEsiste(db: Client, nome: string): Promise<boolean> {
  const rs = await db.execute({
    sql: "select name from sqlite_master where type = 'table' and name = ? limit 1",
    args: [nome],
  });
  return rs.rows.length > 0;
}

/** Le colonne gia presenti su una tabella. */
export async function colonneDi(db: Client, tabella: string): Promise<string[]> {
  const rs = await db.execute(`select name from pragma_table_info('${tabella}')`);
  return rs.rows.map((r) => String((r as Record<string, unknown>).name));
}

export interface OpzioniMigrazione {
  /** true = se la tabella manca la migrazione FALLISCE. Per le tabelle
   *  senza le quali il codice non puo funzionare. */
  obbligatoria?: boolean;
}

/**
 * Aggiunge le colonne mancanti a una tabella.
 *
 * - tabella presente  -> aggiunge cio che manca, salta cio che c'e gia;
 * - tabella assente e OPZIONALE -> `migration_not_applicable`, dichiarato;
 * - tabella assente e OBBLIGATORIA -> errore;
 * - «duplicate column» sull'ALTER -> tollerato (gia migrata);
 * - qualunque altro errore -> propagato, cosi il deploy fallisce invece
 *   di lasciare uno schema aggiornato a meta.
 */
export async function aggiungiColonne(
  db: Client,
  tabella: string,
  colonne: ColonnaDaAggiungere[],
  opts: OpzioniMigrazione = {},
): Promise<RapportoMigrazione> {
  const rapporto: RapportoMigrazione = {
    tabella, esito: "gia_applicata", aggiunte: [], gia_presenti: [], motivo: "",
  };

  if (!(await tabellaEsiste(db, tabella))) {
    if (opts.obbligatoria) {
      throw new Error(
        `migrazione impossibile: la tabella obbligatoria "${tabella}" non esiste. ` +
        "Applicare prima il suo schema canonico.",
      );
    }
    rapporto.esito = "migration_not_applicable";
    rapporto.motivo = `tabella opzionale "${tabella}" non presente in questo database: nessuna colonna da aggiungere`;
    return rapporto;
  }

  const presenti = await colonneDi(db, tabella);

  for (const c of colonne) {
    if (presenti.indexOf(c.nome) !== -1) {
      rapporto.gia_presenti.push(c.nome);
      continue;
    }
    try {
      await db.execute(`alter table ${tabella} add column ${c.nome} ${c.definizione}`);
      rapporto.aggiunte.push(c.nome);
    } catch (e) {
      // Fra la lettura delle colonne e l'ALTER puo essersi inserito un
      // altro processo che ha fatto la stessa migrazione: e l'unico
      // caso in cui un errore qui e normale.
      if (/duplicate column/i.test((e as Error).message ?? "")) {
        rapporto.gia_presenti.push(c.nome);
        continue;
      }
      throw e;
    }
  }

  if (rapporto.aggiunte.length) rapporto.esito = "applicata";
  return rapporto;
}
