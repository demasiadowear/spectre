import { randomUUID } from "crypto";
import { turso } from "@/lib/turso";
import type {
  ZoneCard,
  ZoneCardStatus,
  ZoneClient,
  ZoneClientDetail,
  ZoneClientStatus,
  ZoneLoanStatus,
  ZoneProduct,
  ZoneReviewSnapshot,
  ZoneSale,
  ZoneStats,
} from "@/types/zone";

// ============================================================
// Zone CRM data access (Turso). Come lib/intent/db.ts: schema
// auto-migrato al primo uso (idempotente), senza Turso le letture
// tornano vuote e le scritture lanciano (il registro È il dato:
// un salvataggio perso in silenzio qui costa un cliente).
// ============================================================

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

export const ZONE_STATUSES: ZoneClientStatus[] = [
  "da_visitare",
  "visitato",
  "venduto",
  "non_interessato",
  "da_richiamare",
];

// ----- Schema (auto-migrazione) --------------------------------
// Specchio runtime di lib/zone/schema.sql.

let schemaEnsured = false;

export async function ensureZoneSchema(): Promise<void> {
  if (!turso || schemaEnsured) return;
  await turso.executeMultiple(`
    create table if not exists zone_clients (
      id             text primary key,
      name           text not null,
      category       text default '',
      address        text default '',
      cap            text default '',
      phone          text default '',
      lat            real,
      lng            real,
      maps_url       text default '',
      nfc_review_url text default '',
      rating         real default 0,
      reviews        integer default 0,
      zone_label     text default '',
      status         text not null default 'da_visitare',
      callback_at    text,
      referent       text default '',
      notes          text default '',
      fatt_ragione_sociale text default '',
      fatt_piva      text default '',
      fatt_cf        text default '',
      fatt_indirizzo text default '',
      fatt_cap       text default '',
      fatt_citta     text default '',
      fatt_email     text default '',
      fatt_pec       text default '',
      fatt_sdi       text default '',
      fatt_telefono  text default '',
      invoice_status text not null default '',
      reviews_at_sale integer,
      reviews_updated_at text,
      created_at     text default (datetime('now')),
      updated_at     text default (datetime('now'))
    );
    create table if not exists zone_products (
      id            text primary key,
      name          text not null unique,
      default_price real not null default 0,
      active        integer not null default 1,
      created_at    text default (datetime('now'))
    );
    create table if not exists zone_sales (
      id           text primary key,
      client_id    text not null references zone_clients(id) on delete cascade,
      product_id   text default '',
      product_name text not null,
      qty          integer not null default 1,
      price        real not null default 0,
      sold_at      text default (datetime('now')),
      notes        text default '',
      created_at   text default (datetime('now'))
    );
    create table if not exists zone_cards (
      code        text primary key,
      client_id   text not null references zone_clients(id) on delete cascade,
      sale_id     text default '',
      status      text not null default 'attiva',
      assigned_at text default (datetime('now')),
      notes       text default ''
    );
    create table if not exists zone_stock_moves (
      id         integer primary key autoincrement,
      product_id text not null,
      delta      integer not null,
      motivo     text not null default 'rettifica',
      ref_id     text default '',
      ts         text default (datetime('now')),
      notes      text default ''
    );
    create table if not exists zone_review_snapshots (
      id        integer primary key autoincrement,
      client_id text not null references zone_clients(id) on delete cascade,
      reviews   integer not null default 0,
      rating    real not null default 0,
      taken_at  text default (datetime('now')),
      source    text not null default 'refresh'
    );
    create index if not exists idx_zone_snapshots_client on zone_review_snapshots(client_id, taken_at);
    create index if not exists idx_zone_moves_product on zone_stock_moves(product_id);
    create index if not exists idx_zone_clients_status on zone_clients(status);
    create index if not exists idx_zone_clients_cap on zone_clients(cap);
    create index if not exists idx_zone_clients_callback on zone_clients(callback_at);
    create index if not exists idx_zone_sales_client on zone_sales(client_id);
    create index if not exists idx_zone_sales_sold_at on zone_sales(sold_at);
    create index if not exists idx_zone_cards_client on zone_cards(client_id);
    insert or ignore into zone_products (id, name, default_price) values
      ('prod-card', 'Card singola', 15),
      ('prod-targhetta', 'Targhetta 10x10 (con biadesivo)', 50),
      ('prod-targhetta-piedino', 'Targhetta 10x10 con supporto/piedino', 55),
      ('prod-bundle', 'Bundle 1+1 (1 targhetta + 1 card)', 60),
      ('prod-bundle-2', 'Bundle 1+2 (1 targhetta + 2 card)', 70),
      ('prod-bundle-3', 'Bundle 1+3 (1 targhetta + 3 card)', 80);
  `);
  // Migrazione fatturazione: colonne aggiunte ai DB esistenti, una
  // per una ("duplicate column" = già migrata, si ignora).
  for (const col of [
    "fatt_ragione_sociale", "fatt_piva", "fatt_cf", "fatt_indirizzo",
    "fatt_cap", "fatt_citta", "fatt_email", "fatt_pec", "fatt_sdi",
    "fatt_telefono",
  ]) {
    try {
      await turso.execute(`alter table zone_clients add column ${col} text default ''`);
    } catch { /* colonna già presente */ }
  }
  try {
    await turso.execute(
      "alter table zone_clients add column invoice_status text not null default ''",
    );
  } catch { /* colonna già presente */ }
  // Delta recensioni per upsell: baseline alla PRIMA vendita + data
  // ultimo aggiornamento del conteggio attuale.
  for (const ddl of [
    "alter table zone_clients add column reviews_at_sale integer",
    "alter table zone_clients add column reviews_updated_at text",
    // Comodato (asse parallelo a invoice_status)
    "alter table zone_clients add column loan_status text not null default 'nessuno'",
    "alter table zone_clients add column loan_started_at text",
    "alter table zone_clients add column loan_due_at text",
    "alter table zone_clients add column reviews_at_loan integer",
    // Giacenza sul listino
    "alter table zone_products add column stock_qty integer not null default 0",
    "alter table zone_products add column stock_soglia integer not null default 0",
    "alter table zone_products add column fornitore text default ''",
  ]) {
    try {
      await turso.execute(ddl);
    } catch { /* colonna già presente */ }
  }

  // Migrazione listino: i 3 prodotti del seed provvisorio (card 10 /
  // targhetta 40 / bundle 60) diventano il listino definitivo — SOLO
  // se hanno ancora nome+prezzo originali: una modifica manuale di
  // Puccio non viene mai sovrascritta. Idempotente.
  await turso.executeMultiple(`
    update zone_products set name = 'Card singola', default_price = 15
      where id = 'prod-card' and name = 'Card NFC singola' and default_price = 10;
    update zone_products set name = 'Targhetta 10x10 (con biadesivo)', default_price = 50
      where id = 'prod-targhetta' and name = 'Targhetta da banco' and default_price = 40;
    update zone_products set name = 'Bundle 1+1 (1 targhetta + 1 card)', default_price = 60
      where id = 'prod-bundle' and name = 'Bundle' and default_price = 60;
  `);
  // Seed giacenza iniziale (una volta sola: guard su fornitore vuoto,
  // così i valori toccati a mano non vengono mai ripristinati).
  await turso.executeMultiple(`
    update zone_products set stock_qty = 100, stock_soglia = 20, fornitore = 'Beppe De Bartolo'
      where id = 'prod-targhetta' and fornitore = '';
    update zone_products set stock_qty = 0, stock_soglia = 40, fornitore = 'IDColor'
      where id = 'prod-card' and fornitore = '';
  `);

  // Migrazione link NFC: il vecchio formato g.page (incluso il trucco
  // ",5", oggi 404) viene riscritto nel formato ufficiale writereview,
  // costruito dal place_id (= id cliente). Idempotente.
  await turso.execute(
    `update zone_clients
     set nfc_review_url = 'https://search.google.com/local/writereview?placeid=' || id
     where nfc_review_url = '' or nfc_review_url like 'https://g.page/%'`,
  );
  schemaEnsured = true;
}

// ----- Mapping ---------------------------------------------------

function rowToClient(r: Row): ZoneClient {
  return {
    id: str(r.id),
    name: str(r.name),
    category: str(r.category),
    address: str(r.address),
    cap: str(r.cap),
    phone: str(r.phone),
    lat: typeof r.lat === "number" ? r.lat : null,
    lng: typeof r.lng === "number" ? r.lng : null,
    maps_url: str(r.maps_url),
    nfc_review_url: str(r.nfc_review_url),
    rating: num(r.rating),
    reviews: num(r.reviews),
    zone_label: str(r.zone_label),
    status: (str(r.status) || "da_visitare") as ZoneClientStatus,
    callback_at: r.callback_at ? str(r.callback_at) : null,
    referent: str(r.referent),
    notes: str(r.notes),
    fatt_ragione_sociale: str(r.fatt_ragione_sociale),
    fatt_piva: str(r.fatt_piva),
    fatt_cf: str(r.fatt_cf),
    fatt_indirizzo: str(r.fatt_indirizzo),
    fatt_cap: str(r.fatt_cap),
    fatt_citta: str(r.fatt_citta),
    fatt_email: str(r.fatt_email),
    fatt_pec: str(r.fatt_pec),
    fatt_sdi: str(r.fatt_sdi),
    fatt_telefono: str(r.fatt_telefono),
    invoice_status: (str(r.invoice_status) || "") as ZoneClient["invoice_status"],
    reviews_at_sale:
      typeof r.reviews_at_sale === "number" || typeof r.reviews_at_sale === "bigint"
        ? Number(r.reviews_at_sale)
        : null,
    reviews_updated_at: r.reviews_updated_at ? str(r.reviews_updated_at) : null,
    loan_status: (str(r.loan_status) || "nessuno") as ZoneLoanStatus,
    loan_started_at: r.loan_started_at ? str(r.loan_started_at) : null,
    loan_due_at: r.loan_due_at ? str(r.loan_due_at) : null,
    reviews_at_loan:
      typeof r.reviews_at_loan === "number" || typeof r.reviews_at_loan === "bigint"
        ? Number(r.reviews_at_loan)
        : null,
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
  };
}

function rowToSale(r: Row): ZoneSale {
  return {
    id: str(r.id),
    client_id: str(r.client_id),
    product_id: str(r.product_id),
    product_name: str(r.product_name),
    qty: num(r.qty),
    price: num(r.price),
    sold_at: str(r.sold_at),
    notes: str(r.notes),
  };
}

function rowToCard(r: Row): ZoneCard {
  return {
    code: str(r.code),
    client_id: str(r.client_id),
    sale_id: str(r.sale_id),
    status: (str(r.status) || "attiva") as ZoneCardStatus,
    assigned_at: str(r.assigned_at),
    notes: str(r.notes),
  };
}

/** CAP italiano estratto dall'indirizzo formattato ('' se assente). */
export function capFromAddress(address: string): string {
  const m = /\b(\d{5})\b/.exec(address);
  return m ? m[1] : "";
}

// ----- Clienti ---------------------------------------------------

export interface UpsertClientInput {
  id: string;
  name: string;
  category?: string;
  address?: string;
  phone?: string;
  lat?: number | null;
  lng?: number | null;
  maps_url?: string;
  nfc_review_url?: string;
  rating?: number;
  reviews?: number;
  zone_label?: string;
  status?: ZoneClientStatus;
}

/** Inserisce (o aggiorna anagrafica+snapshot di) un cliente. Lo stato
 *  si tocca SOLO se passato esplicitamente: un re-scan non deve
 *  retrocedere un "venduto" a "da_visitare". */
export async function upsertClient(input: UpsertClientInput): Promise<ZoneClient> {
  if (!turso) throw new Error("Turso non configurato: il registro Zone richiede il DB.");
  await ensureZoneSchema();
  await turso.execute({
    sql: `insert into zone_clients
            (id, name, category, address, cap, phone, lat, lng, maps_url,
             nfc_review_url, rating, reviews, reviews_updated_at, zone_label, status)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, case when ? > 0 then datetime('now') end, ?, ?)
          on conflict(id) do update set
            name = excluded.name,
            -- anagrafica: il valore nuovo vince solo se non vuoto — un
            -- upsert parziale non deve cancellare telefono/indirizzo.
            category = case when excluded.category != '' then excluded.category else zone_clients.category end,
            address = case when excluded.address != '' then excluded.address else zone_clients.address end,
            cap = case when excluded.cap != '' then excluded.cap else zone_clients.cap end,
            phone = case when excluded.phone != '' then excluded.phone else zone_clients.phone end,
            lat = coalesce(excluded.lat, zone_clients.lat),
            lng = coalesce(excluded.lng, zone_clients.lng),
            maps_url = case when excluded.maps_url != '' then excluded.maps_url else zone_clients.maps_url end,
            nfc_review_url = case when excluded.nfc_review_url != '' then excluded.nfc_review_url else zone_clients.nfc_review_url end,
            rating = case when excluded.rating > 0 then excluded.rating else zone_clients.rating end,
            reviews = case when excluded.reviews > 0 then excluded.reviews else zone_clients.reviews end,
            reviews_updated_at = case when excluded.reviews > 0 then datetime('now') else zone_clients.reviews_updated_at end,
            zone_label = case when excluded.zone_label != '' then excluded.zone_label else zone_clients.zone_label end,
            status = coalesce(?, zone_clients.status),
            updated_at = datetime('now')`,
    args: [
      input.id,
      input.name,
      input.category ?? "",
      input.address ?? "",
      capFromAddress(input.address ?? ""),
      input.phone ?? "",
      input.lat ?? null,
      input.lng ?? null,
      input.maps_url ?? "",
      input.nfc_review_url ?? "",
      input.rating ?? 0,
      input.reviews ?? 0,
      input.reviews ?? 0,
      input.zone_label ?? "",
      input.status ?? "da_visitare",
      input.status ?? null,
    ],
  });
  const client = await getClient(input.id);
  if (!client) throw new Error("Upsert cliente fallito.");
  // Storico recensioni: lo scan è uno dei due punti in cui il
  // conteggio si muove (dedup dentro recordSnapshot).
  if ((input.reviews ?? 0) > 0) {
    await recordSnapshot(input.id, input.reviews ?? 0, input.rating ?? 0, "scan");
  }
  return client;
}

const CLIENT_EDITABLE = [
  "status",
  "callback_at",
  "referent",
  "notes",
  "zone_label",
  "phone",
  "nfc_review_url",
  "fatt_ragione_sociale",
  "fatt_piva",
  "fatt_cf",
  "fatt_indirizzo",
  "fatt_cap",
  "fatt_citta",
  "fatt_email",
  "fatt_pec",
  "fatt_sdi",
  "fatt_telefono",
  "invoice_status",
] as const;

export async function updateClient(
  id: string,
  fields: Partial<Record<(typeof CLIENT_EDITABLE)[number], unknown>>,
): Promise<ZoneClient | null> {
  if (!turso) throw new Error("Turso non configurato: il registro Zone richiede il DB.");
  await ensureZoneSchema();
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const key of CLIENT_EDITABLE) {
    if (!(key in fields)) continue;
    sets.push(`${key} = ?`);
    args.push(fields[key] === null ? null : String(fields[key]));
  }
  if (sets.length === 0) return getClient(id);
  args.push(id);
  await turso.execute({
    sql: `update zone_clients set ${sets.join(", ")}, updated_at = datetime('now') where id = ?`,
    args: args as (string | null)[],
  });
  return getClient(id);
}

export async function getClient(id: string): Promise<ZoneClient | null> {
  if (!turso) return null;
  await ensureZoneSchema();
  const res = await turso.execute({
    sql: "select * from zone_clients where id = ? limit 1",
    args: [id],
  });
  return res.rows[0] ? rowToClient(res.rows[0] as Row) : null;
}

export async function getClientDetail(id: string): Promise<ZoneClientDetail | null> {
  if (!turso) return null;
  const client = await getClient(id);
  if (!client) return null;
  const [sales, cards, snaps] = await Promise.all([
    turso.execute({
      sql: "select * from zone_sales where client_id = ? order by sold_at desc, id desc",
      args: [id],
    }),
    turso.execute({
      sql: "select * from zone_cards where client_id = ? order by assigned_at desc",
      args: [id],
    }),
    turso.execute({
      sql: `select * from zone_review_snapshots where client_id = ?
            order by id desc limit 12`,
      args: [id],
    }),
  ]);
  return {
    ...client,
    sales: sales.rows.map((r) => rowToSale(r as Row)),
    cards: cards.rows.map((r) => rowToCard(r as Row)),
    snapshots: (snaps.rows as Row[]).map((r) => ({
      id: num(r.id),
      client_id: str(r.client_id),
      reviews: num(r.reviews),
      rating: num(r.rating),
      taken_at: str(r.taken_at),
      source: (str(r.source) || "refresh") as ZoneReviewSnapshot["source"],
    })),
  };
}

export interface ClientFilters {
  status?: ZoneClientStatus;
  cap?: string;
  zone_label?: string;
  q?: string;
  /** Filtro stato fattura ('richiesta' = fatture da emettere). */
  invoice?: "richiesta" | "fatturata";
  /** Candidati upsell: delta recensioni dalla vendita >= soglia.
   *  Ordina per delta decrescente. */
  upsell_min?: number;
  /** Filtro comodato ('attivo' = pezzi in giro da rivisitare). */
  loan?: ZoneLoanStatus;
}

export async function listClients(filters: ClientFilters = {}): Promise<ZoneClient[]> {
  if (!turso) return [];
  await ensureZoneSchema();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filters.status) {
    where.push("status = ?");
    args.push(filters.status);
  }
  if (filters.cap) {
    where.push("cap = ?");
    args.push(filters.cap);
  }
  if (filters.zone_label) {
    where.push("zone_label = ?");
    args.push(filters.zone_label);
  }
  if (filters.invoice) {
    where.push("invoice_status = ?");
    args.push(filters.invoice);
  }
  if (filters.loan) {
    where.push("loan_status = ?");
    args.push(filters.loan);
  }
  if (filters.upsell_min != null) {
    where.push(
      "reviews_at_sale is not null and (reviews - reviews_at_sale) >= ?",
    );
    // numero, NON stringa: SQLite ordina INTEGER < TEXT, quindi
    // 58 >= '20' sarebbe sempre falso.
    args.push(Math.max(1, Math.round(filters.upsell_min)));
  }
  if (filters.q) {
    where.push("(name like ? or address like ? or referent like ? or notes like ?)");
    const like = `%${filters.q}%`;
    args.push(like, like, like, like);
  }
  const orderBy =
    filters.upsell_min != null
      ? "(reviews - reviews_at_sale) desc, reviews desc"
      : `case when status = 'da_richiamare' then 0 else 1 end,
            callback_at asc nulls last,
            updated_at desc`;
  const res = await turso.execute({
    sql: `select * from zone_clients
          ${where.length ? `where ${where.join(" and ")}` : ""}
          order by ${orderBy}
          limit 500`,
    args,
  });
  return res.rows.map((r) => rowToClient(r as Row));
}

/** Overlay per la Caccia: stato salvato dei place_id già in registro. */
export async function savedStatusMap(
  placeIds: string[],
): Promise<Map<string, ZoneClientStatus>> {
  const map = new Map<string, ZoneClientStatus>();
  if (!turso || placeIds.length === 0) return map;
  await ensureZoneSchema();
  const chunk = placeIds.slice(0, 400); // ben oltre i ~180 max di uno scan
  const res = await turso.execute({
    sql: `select id, status from zone_clients where id in (${chunk.map(() => "?").join(",")})`,
    args: chunk,
  });
  for (const r of res.rows as Row[]) {
    map.set(str(r.id), str(r.status) as ZoneClientStatus);
  }
  return map;
}

/** Baseline manuale "a oggi": SOLO se non esiste già (la baseline
 *  della prima vendita è sacra) — per i clienti venduti prima della
 *  feature delta, che altrimenti resterebbero fuori dall'upsell. */
export async function setBaselineNow(id: string): Promise<ZoneClient | null> {
  if (!turso) throw new Error("Turso non configurato: il registro Zone richiede il DB.");
  await ensureZoneSchema();
  await turso.execute({
    sql: `update zone_clients set reviews_at_sale = reviews,
            updated_at = datetime('now')
          where id = ? and reviews_at_sale is null`,
    args: [id],
  });
  return getClient(id);
}

/** Aggiorna il conteggio recensioni/voto di UN cliente (bottone
 *  "Aggiorna dati": una Place Details, niente scan di zona). */
export async function refreshClientReviews(
  id: string,
  rating: number,
  reviews: number,
): Promise<ZoneClient | null> {
  if (!turso) throw new Error("Turso non configurato: il registro Zone richiede il DB.");
  await ensureZoneSchema();
  await turso.execute({
    sql: `update zone_clients set
            rating = case when ? > 0 then ? else rating end,
            reviews = case when ? > 0 then ? else reviews end,
            reviews_updated_at = datetime('now'),
            updated_at = datetime('now')
          where id = ?`,
    args: [rating, rating, reviews, reviews, id],
  });
  if (reviews > 0) await recordSnapshot(id, reviews, rating, "refresh");
  return getClient(id);
}

/** Appende uno snapshot allo storico recensioni — dedup: se l'ultimo
 *  ha stessi reviews+rating non si duplica (i re-scan frequenti non
 *  sporcano la serie). Best-effort: un errore qui non blocca mai
 *  l'operazione principale. */
export async function recordSnapshot(
  clientId: string,
  reviews: number,
  rating: number,
  source: "scan" | "refresh",
): Promise<void> {
  if (!turso) return;
  try {
    await ensureZoneSchema();
    const last = await turso.execute({
      sql: `select reviews, rating from zone_review_snapshots
            where client_id = ? order by id desc limit 1`,
      args: [clientId],
    });
    const prev = last.rows[0] as Row | undefined;
    if (prev && num(prev.reviews) === reviews && num(prev.rating) === rating) return;
    await turso.execute({
      sql: `insert into zone_review_snapshots (client_id, reviews, rating, source)
            values (?, ?, ?, ?)`,
      args: [clientId, reviews, rating, source],
    });
  } catch (err) {
    console.error("[zone] snapshot fallito:", (err as Error).message);
  }
}

// ----- Giacenza ---------------------------------------------------

/** Movimento di magazzino: registra il move E aggiorna stock_qty.
 *  delta negativo = uscita (vendita/comodato), positivo = carico. */
export async function addStockMove(
  productId: string,
  delta: number,
  motivo: "vendita" | "comodato" | "rientro" | "carico" | "rettifica",
  refId = "",
  notes = "",
): Promise<void> {
  if (!turso || !productId || delta === 0) return;
  await ensureZoneSchema();
  await turso.execute({
    sql: `insert into zone_stock_moves (product_id, delta, motivo, ref_id, notes)
          values (?, ?, ?, ?, ?)`,
    args: [productId, Math.round(delta), motivo, refId, notes],
  });
  await turso.execute({
    sql: "update zone_products set stock_qty = stock_qty + ? where id = ?",
    args: [Math.round(delta), productId],
  });
}

/** Soglia alert e fornitore di un prodotto (dalla UI Analisi). */
export async function updateProductStockMeta(
  productId: string,
  meta: { stock_soglia?: number; fornitore?: string },
): Promise<void> {
  if (!turso) throw new Error("Turso non configurato: il registro Zone richiede il DB.");
  await ensureZoneSchema();
  const sets: string[] = [];
  const args: (string | number)[] = [];
  if (meta.stock_soglia !== undefined) {
    sets.push("stock_soglia = ?");
    args.push(meta.stock_soglia);
  }
  if (meta.fornitore !== undefined) {
    sets.push("fornitore = ?");
    args.push(meta.fornitore);
  }
  if (sets.length === 0) return;
  args.push(productId);
  await turso.execute({
    sql: `update zone_products set ${sets.join(", ")} where id = ?`,
    args,
  });
}

// ----- Comodato ----------------------------------------------------

/** Mette il cliente in comodato: stato+date (scadenza = +15gg),
 *  baseline recensioni dedicata (mai sovrascritta), scarico giacenza
 *  del prodotto lasciato, card opzionali marcate 'in_comodato'. */
export async function startLoan(
  clientId: string,
  productId: string,
  cardCodes: string[] = [],
): Promise<ZoneClientDetail | null> {
  if (!turso) throw new Error("Turso non configurato: il registro Zone richiede il DB.");
  await ensureZoneSchema();
  const client = await getClient(clientId);
  if (!client) throw new Error("Cliente non trovato nel registro.");
  if (client.loan_status === "attivo") {
    throw new Error("Comodato già attivo su questo cliente.");
  }
  await turso.execute({
    sql: `update zone_clients set
            loan_status = 'attivo',
            loan_started_at = datetime('now'),
            loan_due_at = datetime('now', '+15 days'),
            reviews_at_loan = coalesce(reviews_at_loan, reviews),
            updated_at = datetime('now')
          where id = ?`,
    args: [clientId],
  });
  await addStockMove(productId, -1, "comodato", clientId, `comodato ${client.name}`);
  for (const code of cardCodes) {
    const clean = code.trim();
    if (clean) await assignCard(clean, clientId, "", "comodato", "in_comodato");
  }
  return getClientDetail(clientId);
}

/** Chiude il comodato. 'ritirato': pezzo rientra in giacenza, card
 *  dismesse. 'convertito': il pezzo resta dal cliente — si storna lo
 *  scarico comodato così la VENDITA che segue fa il suo scarico senza
 *  contare il pezzo due volte; le card passano 'attiva'. */
export async function endLoan(
  clientId: string,
  outcome: "ritirato" | "convertito",
): Promise<ZoneClientDetail | null> {
  if (!turso) throw new Error("Turso non configurato: il registro Zone richiede il DB.");
  await ensureZoneSchema();
  const client = await getClient(clientId);
  if (!client) throw new Error("Cliente non trovato nel registro.");
  if (client.loan_status !== "attivo") {
    throw new Error("Nessun comodato attivo su questo cliente.");
  }
  // Il prodotto scaricato al posizionamento: l'ultimo move 'comodato'.
  const move = await turso.execute({
    sql: `select product_id, delta from zone_stock_moves
          where motivo = 'comodato' and ref_id = ?
          order by id desc limit 1`,
    args: [clientId],
  });
  const m = move.rows[0] as Row | undefined;
  if (m) {
    await addStockMove(
      str(m.product_id),
      Math.abs(num(m.delta)),
      outcome === "ritirato" ? "rientro" : "rettifica",
      clientId,
      outcome === "ritirato"
        ? `rientro comodato ${client.name}`
        : `conversione comodato ${client.name}: lo scarico passa alla vendita`,
    );
  }
  await turso.execute({
    sql: `update zone_clients set loan_status = ?, updated_at = datetime('now') where id = ?`,
    args: [outcome, clientId],
  });
  await turso.execute({
    sql: `update zone_cards set status = ? where client_id = ? and status = 'in_comodato'`,
    args: [outcome === "ritirato" ? "dismessa" : "attiva", clientId],
  });
  return getClientDetail(clientId);
}

// ----- Prodotti --------------------------------------------------

export async function listProducts(includeInactive = false): Promise<ZoneProduct[]> {
  if (!turso) return [];
  await ensureZoneSchema();
  const res = await turso.execute(
    `select * from zone_products ${includeInactive ? "" : "where active = 1"} order by name`,
  );
  return (res.rows as Row[]).map((r) => ({
    id: str(r.id),
    name: str(r.name),
    default_price: num(r.default_price),
    active: num(r.active) === 1,
    stock_qty: num(r.stock_qty),
    stock_soglia: num(r.stock_soglia),
    fornitore: str(r.fornitore),
  }));
}

export async function upsertProduct(p: {
  id?: string;
  name: string;
  default_price: number;
  active?: boolean;
}): Promise<void> {
  if (!turso) throw new Error("Turso non configurato: il registro Zone richiede il DB.");
  await ensureZoneSchema();
  await turso.execute({
    sql: `insert into zone_products (id, name, default_price, active)
          values (?, ?, ?, ?)
          on conflict(id) do update set
            name = excluded.name,
            default_price = excluded.default_price,
            active = excluded.active`,
    args: [
      p.id || `prod-${randomUUID().slice(0, 8)}`,
      p.name,
      p.default_price,
      p.active === false ? 0 : 1,
    ],
  });
}

// ----- Vendite ---------------------------------------------------

export interface AddSaleInput {
  client_id: string;
  product_id?: string;
  product_name: string;
  qty: number;
  price: number;
  sold_at?: string;
  notes?: string;
  /** Codici card da assegnare al cliente insieme alla vendita. */
  card_codes?: string[];
}

/** Registra la vendita, assegna le eventuali card e marca il cliente
 *  "venduto". Ritorna la scheda aggiornata. */
export async function addSale(input: AddSaleInput): Promise<ZoneClientDetail | null> {
  if (!turso) throw new Error("Turso non configurato: il registro Zone richiede il DB.");
  await ensureZoneSchema();
  if (!(await getClient(input.client_id))) {
    throw new Error("Cliente non trovato nel registro: importalo prima di registrare la vendita.");
  }
  const saleId = `sale-${randomUUID().slice(0, 12)}`;
  await turso.execute({
    sql: `insert into zone_sales (id, client_id, product_id, product_name, qty, price, sold_at, notes)
          values (?, ?, ?, ?, ?, ?, coalesce(?, datetime('now')), ?)`,
    args: [
      saleId,
      input.client_id,
      input.product_id ?? "",
      input.product_name,
      Math.max(1, Math.round(input.qty)),
      input.price,
      input.sold_at ?? null,
      input.notes ?? "",
    ],
  });
  for (const code of input.card_codes ?? []) {
    const clean = code.trim();
    if (clean) await assignCard(clean, input.client_id, saleId);
  }
  // Scarico giacenza del prodotto venduto (se collegato al listino).
  if (input.product_id) {
    await addStockMove(
      input.product_id,
      -Math.max(1, Math.round(input.qty)),
      "vendita",
      saleId,
      input.product_name,
    );
  }
  await turso.execute({
    sql: `update zone_clients set
            status = 'venduto',
            -- baseline delta: le recensioni al momento della PRIMA
            -- vendita. Le vendite successive NON la toccano (si misura
            -- l'effetto della card dall'inizio).
            reviews_at_sale = coalesce(reviews_at_sale, reviews),
            updated_at = datetime('now')
          where id = ?`,
    args: [input.client_id],
  });
  return getClientDetail(input.client_id);
}

// ----- Card ------------------------------------------------------

export async function assignCard(
  code: string,
  clientId: string,
  saleId = "",
  notes = "",
  status: ZoneCardStatus = "attiva",
): Promise<void> {
  if (!turso) throw new Error("Turso non configurato: il registro Zone richiede il DB.");
  await ensureZoneSchema();
  // Una card in mano a un ALTRO cliente (attiva o in comodato) non si
  // ruba con un refuso di codice: errore esplicito. Ri-assegnare allo
  // stesso cliente o riattivare una dismessa/sostituita resta permesso.
  const existing = await turso.execute({
    sql: "select client_id, status from zone_cards where code = ? limit 1",
    args: [code],
  });
  const row = existing.rows[0] as Row | undefined;
  if (
    row &&
    ["attiva", "in_comodato"].includes(str(row.status)) &&
    str(row.client_id) !== clientId
  ) {
    const owner = await getClient(str(row.client_id));
    throw new Error(
      `Card "${code}" già in mano a ${owner?.name ?? "un altro cliente"}: controlla il codice.`,
    );
  }
  await turso.execute({
    sql: `insert into zone_cards (code, client_id, sale_id, status, notes)
          values (?, ?, ?, ?, ?)
          on conflict(code) do update set
            client_id = excluded.client_id,
            sale_id = excluded.sale_id,
            status = excluded.status,
            notes = excluded.notes,
            assigned_at = datetime('now')`,
    args: [code, clientId, saleId, status, notes],
  });
}

/** Sostituzione: la vecchia resta in storia come 'sostituita', la
 *  nuova nasce 'attiva' sullo stesso cliente. */
export async function replaceCard(
  oldCode: string,
  newCode: string,
  notes = "",
): Promise<ZoneCard | null> {
  if (!turso) throw new Error("Turso non configurato: il registro Zone richiede il DB.");
  await ensureZoneSchema();
  const res = await turso.execute({
    sql: "select * from zone_cards where code = ? limit 1",
    args: [oldCode],
  });
  const old = res.rows[0] ? rowToCard(res.rows[0] as Row) : null;
  if (!old) return null;
  // Prima la nuova (il guard anti-furto può lanciare: se fallisce non
  // abbiamo ancora toccato la vecchia), poi la vecchia in storia.
  await assignCard(newCode, old.client_id, old.sale_id, notes || `sostituisce ${oldCode}`);
  await turso.execute({
    sql: `update zone_cards set status = 'sostituita',
            notes = case when notes = '' then ? else notes || ' · ' || ? end
          where code = ?`,
    args: [`sostituita con ${newCode}`, `sostituita con ${newCode}`, oldCode],
  });
  const created = await turso.execute({
    sql: "select * from zone_cards where code = ? limit 1",
    args: [newCode],
  });
  return created.rows[0] ? rowToCard(created.rows[0] as Row) : null;
}

/** Ricerca inversa: codice card -> cliente (il caso "mi chiama per
 *  una sostituzione e ho in mano solo il codice"). */
export async function findClientByCardCode(
  code: string,
): Promise<{ card: ZoneCard; client: ZoneClient } | null> {
  if (!turso) return null;
  await ensureZoneSchema();
  const res = await turso.execute({
    sql: "select * from zone_cards where code = ? limit 1",
    args: [code],
  });
  if (!res.rows[0]) return null;
  const card = rowToCard(res.rows[0] as Row);
  const client = await getClient(card.client_id);
  return client ? { card, client } : null;
}

// ----- Analisi ---------------------------------------------------

export async function zoneStats(): Promise<ZoneStats> {
  const empty: ZoneStats = {
    clients_total: 0,
    by_status: {
      da_visitare: 0,
      visitato: 0,
      venduto: 0,
      non_interessato: 0,
      da_richiamare: 0,
    },
    revenue_total: 0,
    sales_count: 0,
    cards_active: 0,
    conversion_pct: 0,
    by_zone: [],
    callbacks: [],
  };
  if (!turso) return empty;
  await ensureZoneSchema();

  const [statusRes, salesRes, cardsRes, zoneRes, callbackRes] = await Promise.all([
    turso.execute("select status, count(*) as n from zone_clients group by status"),
    turso.execute("select count(*) as n, coalesce(sum(price), 0) as revenue from zone_sales"),
    turso.execute("select count(*) as n from zone_cards where status = 'attiva'"),
    turso.execute(`
      select
        case when c.zone_label != '' then c.zone_label else coalesce(nullif(c.cap, ''), 'senza zona') end as zone,
        count(distinct c.id) as clients,
        count(distinct case when c.status = 'venduto' then c.id end) as sold,
        count(distinct case when c.status in ('visitato','venduto','non_interessato') then c.id end) as visited,
        coalesce(sum(s.price), 0) as revenue
      from zone_clients c
      left join zone_sales s on s.client_id = c.id
      group by zone
      order by revenue desc, clients desc`),
    turso.execute(`
      select id, name, phone, callback_at, notes from zone_clients
      where status = 'da_richiamare'
      order by callback_at asc nulls last limit 50`),
  ]);

  const stats = { ...empty, by_status: { ...empty.by_status } };
  for (const r of statusRes.rows as Row[]) {
    const s = str(r.status) as ZoneClientStatus;
    if (s in stats.by_status) stats.by_status[s] = num(r.n);
    stats.clients_total += num(r.n);
  }
  stats.sales_count = num((salesRes.rows[0] as Row)?.n);
  stats.revenue_total = num((salesRes.rows[0] as Row)?.revenue);
  stats.cards_active = num((cardsRes.rows[0] as Row)?.n);
  const decided =
    stats.by_status.visitato + stats.by_status.venduto + stats.by_status.non_interessato;
  stats.conversion_pct = decided > 0 ? Math.round((stats.by_status.venduto / decided) * 100) : 0;
  stats.by_zone = (zoneRes.rows as Row[]).map((r) => {
    const visited = num(r.visited);
    return {
      zone: str(r.zone),
      clients: num(r.clients),
      sold: num(r.sold),
      revenue: num(r.revenue),
      conversion_pct: visited > 0 ? Math.round((num(r.sold) / visited) * 100) : 0,
    };
  });
  stats.callbacks = (callbackRes.rows as Row[]).map((r) => ({
    id: str(r.id),
    name: str(r.name),
    phone: str(r.phone),
    callback_at: r.callback_at ? str(r.callback_at) : null,
    notes: str(r.notes),
  }));
  return stats;
}
