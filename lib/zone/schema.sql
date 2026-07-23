-- ============================================================
-- AYRO SPECTRE — Zone CRM (card NFC recensioni) — Turso / libSQL
-- Registro clienti del giro porta-a-porta: separato dal funnel
-- siti (leads/autopilot) — prodotto diverso, ciclo diverso.
-- Identità cliente = place_id Google (stabile tra gli scan).
-- Auto-migrazione al primo uso (lib/zone/db.ts), questo file è
-- la copia leggibile di riferimento.
-- ============================================================

-- Stati: da_visitare | visitato | venduto | non_interessato | da_richiamare
create table if not exists zone_clients (
  id             text primary key,              -- place_id Google
  name           text not null,
  category       text default '',               -- famiglia (ristorazione, bellezza, …)
  address        text default '',
  cap            text default '',               -- estratto dall'indirizzo (analisi per zona)
  phone          text default '',
  whatsapp       text default '',               -- numero WhatsApp per il report recensioni
  lat            real,
  lng            real,
  maps_url       text default '',
  nfc_review_url text default '',               -- g.page/r/<id>/review,5 (vuoto = non ricavabile)
  rating         real default 0,                -- snapshot ultimo scan
  reviews        integer default 0,             -- snapshot ultimo scan
  zone_label     text default '',               -- etichetta giro manuale ("Poggiofranco")
  status         text not null default 'da_visitare',
  callback_at    text,                          -- quando ripassare/richiamare (ISO)
  referent       text default '',               -- nome del referente
  notes          text default '',
  created_at     text default (datetime('now')),
  updated_at     text default (datetime('now'))
);

-- Prodotti configurabili (bundle, targhetta, card, …): aggiunti e
-- ritoccati dalla dashboard, prezzo di default modificabile a vendita.
create table if not exists zone_products (
  id            text primary key,
  name          text not null unique,
  default_price real not null default 0,
  active        integer not null default 1,     -- 0 = ritirato (resta nelle vendite passate)
  unit_cost     real not null default 0,        -- costo unitario acquisto (€), editabile in anagrafica
  created_at    text default (datetime('now'))
);

-- Vendite: 0..N per cliente. product_name/price denormalizzati:
-- lo storico non cambia se il listino evolve.
create table if not exists zone_sales (
  id           text primary key,
  client_id    text not null references zone_clients(id) on delete cascade,
  product_id   text default '',
  product_name text not null,
  qty          integer not null default 1,
  price        real not null default 0,         -- incasso totale riga (€)
  unit_cost    real not null default 0,         -- costo unitario STORICIZZATO al salvataggio (€)
  sold_at      text default (datetime('now')),
  notes        text default '',
  created_at   text default (datetime('now'))
);

-- Registro card fisiche: codice sul pezzo -> cliente. La sostituzione
-- non cancella: vecchia card 'sostituita', nuova riga 'attiva'.
create table if not exists zone_cards (
  code        text primary key,                 -- codice stampato/NFC
  client_id   text not null references zone_clients(id) on delete cascade,
  sale_id     text default '',
  status      text not null default 'attiva',   -- attiva | sostituita | dismessa
  assigned_at text default (datetime('now')),
  notes       text default ''
);

-- Cache delle ricerche zona (risparmio API Google): ogni "Cerca in
-- zona" viene salvata coi risultati; "Riapri" li rimostra senza API,
-- "Aggiorna" rifà la chiamata solo su richiesta. Dedup su centro+raggio.
create table if not exists zone_searches (
  id         text primary key,
  label      text default '',                  -- via/CAP digitato o CAP prevalente dei risultati
  lat        real not null,
  lng        real not null,
  radius     integer not null default 800,
  filters    text default '{}',                -- JSON: categorie + min/max recensioni/voto
  result     text default '{}',                -- JSON: ZoneHuntResult (attività + scoring)
  count      integer not null default 0,
  created_at text default (datetime('now')),
  updated_at text default (datetime('now'))
);

create index if not exists idx_zone_clients_status on zone_clients(status);
create index if not exists idx_zone_clients_cap on zone_clients(cap);
create index if not exists idx_zone_clients_callback on zone_clients(callback_at);
create index if not exists idx_zone_searches_updated on zone_searches(updated_at);
create index if not exists idx_zone_sales_client on zone_sales(client_id);
create index if not exists idx_zone_sales_sold_at on zone_sales(sold_at);
create index if not exists idx_zone_cards_client on zone_cards(client_id);

-- Listino definitivo (prezzi di default: si precompilano nella
-- vendita, l'incasso resta modificabile sulla singola riga).
insert or ignore into zone_products (id, name, default_price) values
  ('prod-card', 'Card singola', 15),
  ('prod-targhetta', 'Targhetta 10x10 (con biadesivo)', 50),
  ('prod-targhetta-piedino', 'Targhetta 10x10 con supporto/piedino', 55),
  ('prod-bundle', 'Bundle 1+1 (1 targhetta + 1 card)', 60),
  ('prod-bundle-2', 'Bundle 1+2 (1 targhetta + 2 card)', 70),
  ('prod-bundle-3', 'Bundle 1+3 (1 targhetta + 3 card)', 80);
