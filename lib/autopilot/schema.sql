-- ============================================================
-- AYRO SPECTRE — Autopilot schema extension (Turso / libSQL)
-- Estende il DB SPECTRE esistente: le righe puntano a leads(id),
-- nessuna duplicazione dei dati anagrafici.
-- Apply with:  node scripts/setup-autopilot.mjs
-- ============================================================

-- Stato pipeline Autopilot per lead. stage:
--   nuovo -> studiato -> contattato -> demo_richiesta
--   -> escalation / archiviato
create table if not exists autopilot_pipeline (
  lead_id           text primary key references leads(id) on delete cascade,
  stage             text not null default 'nuovo',
  tier              text not null default 'T3',      -- T1/T2/T3
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

-- Task di build demo (Stadio 3). Creato quando stage -> demo_richiesta.
create table if not exists autopilot_builds (
  id            text primary key,
  lead_id       text references leads(id) on delete cascade,
  status        text default 'pending',  -- pending/scraping/building/deployed/approved/sent/failed
  template      text default '',         -- editoriale/classico/minimal/pop/mono
  source        text default '',         -- justeat/maps/manual
  manifest_json text default '{}',
  preview_url   text default '',
  error         text default '',
  created_at    text default (datetime('now')),
  updated_at    text default (datetime('now'))
);

-- Configurazione runtime (kill switch, warm-up, cap giornalieri).
create table if not exists autopilot_settings (
  key   text primary key,
  value text default ''
);

-- Contatori giornalieri (day = YYYY-MM-DD Europe/Rome).
create table if not exists autopilot_counters (
  day           text primary key,
  new_contacts  integer default 0,
  messages_sent integer default 0
);

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
create index if not exists idx_ap_builds_status on autopilot_builds(status);
create index if not exists idx_ap_alerts_read on autopilot_alerts(read);

-- Default settings (insert or ignore: non sovrascrive valori esistenti).
insert or ignore into autopilot_settings (key, value) values
  ('kill_switch', '0'),
  ('warmup_started_at', ''),
  ('warmup_daily_cap', '10'),
  ('steady_daily_cap', '15'),
  ('warmup_days', '14');
