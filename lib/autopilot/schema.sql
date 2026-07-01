-- ============================================================
-- AYRO SPECTRE — Pipeline schema extension (Turso / libSQL)
-- Estende il DB SPECTRE esistente: le righe puntano a leads(id),
-- nessuna duplicazione dei dati anagrafici.
-- Apply with:  node scripts/setup-autopilot.mjs
--
-- Stato corrente (post migrazione Pipeline v2, vedi
-- scripts/migrate-pipeline-v2.mjs): questo file è la fonte
-- canonica per un DB da zero, allineata al codice — non serve
-- rieseguire le migrazioni one-off precedenti (setup-deals.mjs,
-- setup-classifier.mjs, setup-remove-builds.mjs) su un DB nuovo,
-- le colonne che introducevano sono già qui.
-- ============================================================

-- Macchina a stati unica della Pipeline:
--   da_contattare -> contattato -> ha_risposto -> in_trattativa
--   -> vinto / perso   (+ archiviato come bidone laterale)
-- Il dettaglio fine (demo da fare, richiamo, prezzo) vive in next_action.
create table if not exists autopilot_pipeline (
  lead_id           text primary key references leads(id) on delete cascade,
  stage             text not null default 'da_contattare',
  tier              text not null default 'T3',      -- T1/T2/T3 (storico)
  place_id          text unique,                     -- Google Places id (dedup)
  category          text default '',                 -- parrucchiere/ristorante/lido/…
  city              text default '',
  study_json        text default '{}',               -- JSON AutopilotStudy
  brief             text default '',                 -- lead brief 5 righe (Gemini)
  wa_first_message  text default '',                 -- primo msg WA unico per il lead
  approval_status   text default 'pending',          -- pending/approved/rejected/auto
  approved_at       text,
  contacted_at      text,
  followup1_at      text,
  followup2_at      text,
  escalated_at      text,
  escalation_reason text default '',
  archived_reason   text default '',
  bot_paused        integer default 0,               -- 1 = bot muto su questa chat
  bypass_sent_at    text,                            -- sblocco auto-reply (max 1)
  demo_url          text,                            -- link demo incollato da Puccio
  demo_sent_at      text,                            -- inviato al lead dal worker
  next_action       text,                            -- dettaglio libero (demo/richiamo/prezzo…)
  next_action_at    text,                            -- promemoria agenda (ISO)
  lost_reason       text,                            -- motivo se stage = 'perso'
  created_at        text default (datetime('now')),
  updated_at        text default (datetime('now'))
);

-- Logging completo di tutte le conversazioni WA (in/out, bot e umano).
create table if not exists wa_messages (
  id           text primary key,
  lead_id      text references leads(id) on delete cascade,
  direction    text not null default 'out',          -- in/out
  body         text default '',
  status       text default 'queued',                -- queued/sent/delivered/read/failed
  wa_id        text default '',                      -- id messaggio whatsapp-web.js
  ai_generated integer default 0,
  created_at   text default (datetime('now'))
);

-- NESSUNA tabella build: SPECTRE non genera demo (decisione 12/06/2026).
-- Le demo le prepara Puccio fuori; demo_url/demo_sent_at vivono sulla
-- pipeline e il worker invia il link solo dietro approvazione.

-- Notifiche per Puccio (escalation, demo pronte, anomalie).
create table if not exists autopilot_alerts (
  id         text primary key,
  type       text default 'info',  -- escalation/anomaly/demo_ready/info
  message    text default '',
  lead_id    text,
  read       integer default 0,
  created_at text default (datetime('now'))
);

create index if not exists idx_ap_pipeline_stage on autopilot_pipeline(stage);
create index if not exists idx_ap_wa_lead on wa_messages(lead_id);
create index if not exists idx_ap_wa_created on wa_messages(created_at);
create index if not exists idx_ap_alerts_read on autopilot_alerts(read);
