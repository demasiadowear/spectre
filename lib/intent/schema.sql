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
