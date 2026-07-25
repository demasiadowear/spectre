-- ============================================================
-- AYRO SPECTRE — Intent Scout schema extension (Turso / libSQL)
-- Lead "intent": aziende che hanno PUBBLICATO una richiesta per
-- sito web / servizi digitali. Estende il DB esistente: le righe
-- puntano a leads(id) come autopilot_pipeline, funnel separato.
-- Apply with:  node scripts/setup-intent.mjs
-- ============================================================

-- Funnel kanban dedicato:
--   intent_found -> contacted -> meeting -> won / lost
create table if not exists intent_pipeline (
  lead_id      text primary key references leads(id) on delete cascade,
  stage        text not null default 'intent_found',
  platform     text not null default '',        -- addlance / freelanceboard
  source_url   text unique,                     -- link annuncio (dedup primario)
  title        text default '',                 -- titolo richiesta
  body         text default '',                 -- testo richiesta
  category     text default '',                 -- categoria piattaforma
  zone         text default '',                 -- zona/città dichiarata
  budget       text default '',                 -- budget dichiarato ('' o "Da definire" = nessuno)
  published_at text,                            -- data pubblicazione richiesta (ISO)
  score        integer default 0,               -- 0-100 (freschezza + zona + budget)
  hook         text default '',                 -- gancio apertura generato da Study
  notified     integer default 0,               -- 1 = notifica Telegram inviata
  created_at   text default (datetime('now')),
  updated_at   text default (datetime('now'))
);

create index if not exists idx_intent_stage on intent_pipeline(stage);
create index if not exists idx_intent_score on intent_pipeline(score);

-- ============================================================
-- Aste giudiziarie (sorgente Scout aggiuntiva): un lotto per riga,
-- dedup su tribunale+procedura+lotto. Prezzi/date aggiornati a ogni
-- scan (upsert), first_seen conservato. Auto-migrata in lib/intent/aste.ts.
-- ============================================================
create table if not exists aste_lots (
  key             text primary key,               -- tribunale|procedura|lotto (normalizzato)
  tribunale       text default '',
  procedura       text default '',
  lotto           text default '',
  comune          text default '',
  tipo            text default '',                 -- tipologia immobile
  mq              real,
  vani            real,
  offerta_minima  real,                            -- prezzo base d'asta (€)
  valore_stima    real,                            -- valore perizia (€)
  data_asta       text default '',                 -- ISO
  termine_offerte text default '',                 -- ISO (base dell'alert termine)
  numero_pubblicazione integer,                    -- n. pubblicazione/tentativo (>=2 = già ribassato)
  link            text default '',                 -- avviso/perizia
  risparmio_pct   real,                            -- (stima - offerta)/stima
  gemini_score    integer default 0,               -- appeal 0-100 (scoring Gemini, opzionale)
  gemini_nota     text default '',
  first_seen      text default (datetime('now')),
  updated_at      text default (datetime('now'))
);

create index if not exists idx_aste_risparmio on aste_lots(risparmio_pct);
create index if not exists idx_aste_termine on aste_lots(termine_offerte);
