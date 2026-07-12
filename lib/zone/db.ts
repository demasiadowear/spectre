import { randomUUID } from "crypto";
import { turso } from "@/lib/turso";
import type {
  ZoneCard,
  ZoneCardStatus,
  ZoneClient,
  ZoneClientDetail,
  ZoneClientStatus,
  ZoneProduct,
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
    create index if not exists idx_zone_clients_status on zone_clients(status);
    create index if not exists idx_zone_clients_cap on zone_clients(cap);
    create index if not exists idx_zone_clients_callback on zone_clients(callback_at);
    create index if not exists idx_zone_sales_client on zone_sales(client_id);
    create index if not exists idx_zone_sales_sold_at on zone_sales(sold_at);
    create index if not exists idx_zone_cards_client on zone_cards(client_id);
    insert or ignore into zone_products (id, name, default_price) values
      ('prod-card', 'Card NFC singola', 10),
      ('prod-targhetta', 'Targhetta da banco', 40),
      ('prod-bundle', 'Bundle', 60);
  `);
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
             nfc_review_url, rating, reviews, zone_label, status)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      input.zone_label ?? "",
      input.status ?? "da_visitare",
      input.status ?? null,
    ],
  });
  const client = await getClient(input.id);
  if (!client) throw new Error("Upsert cliente fallito.");
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
  const [sales, cards] = await Promise.all([
    turso.execute({
      sql: "select * from zone_sales where client_id = ? order by sold_at desc",
      args: [id],
    }),
    turso.execute({
      sql: "select * from zone_cards where client_id = ? order by assigned_at desc",
      args: [id],
    }),
  ]);
  return {
    ...client,
    sales: sales.rows.map((r) => rowToSale(r as Row)),
    cards: cards.rows.map((r) => rowToCard(r as Row)),
  };
}

export interface ClientFilters {
  status?: ZoneClientStatus;
  cap?: string;
  zone_label?: string;
  q?: string;
}

export async function listClients(filters: ClientFilters = {}): Promise<ZoneClient[]> {
  if (!turso) return [];
  await ensureZoneSchema();
  const where: string[] = [];
  const args: string[] = [];
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
  if (filters.q) {
    where.push("(name like ? or address like ? or referent like ? or notes like ?)");
    const like = `%${filters.q}%`;
    args.push(like, like, like, like);
  }
  const res = await turso.execute({
    sql: `select * from zone_clients
          ${where.length ? `where ${where.join(" and ")}` : ""}
          order by
            case when status = 'da_richiamare' then 0 else 1 end,
            callback_at asc nulls last,
            updated_at desc
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
  await turso.execute({
    sql: `update zone_clients set status = 'venduto', updated_at = datetime('now') where id = ?`,
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
): Promise<void> {
  if (!turso) throw new Error("Turso non configurato: il registro Zone richiede il DB.");
  await ensureZoneSchema();
  await turso.execute({
    sql: `insert into zone_cards (code, client_id, sale_id, status, notes)
          values (?, ?, ?, 'attiva', ?)
          on conflict(code) do update set
            client_id = excluded.client_id,
            sale_id = excluded.sale_id,
            status = 'attiva',
            notes = excluded.notes,
            assigned_at = datetime('now')`,
    args: [code, clientId, saleId, notes],
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
  await turso.execute({
    sql: `update zone_cards set status = 'sostituita',
            notes = case when notes = '' then ? else notes || ' · ' || ? end
          where code = ?`,
    args: [`sostituita con ${newCode}`, `sostituita con ${newCode}`, oldCode],
  });
  await assignCard(newCode, old.client_id, old.sale_id, notes || `sostituisce ${oldCode}`);
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
