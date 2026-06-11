-- ============================================================
-- SPECTER DETECTIVE — schema extension (Turso / libSQL).
-- Funnel separato dal web agency funnel e dall'Autopilot:
-- nessuna tabella esistente viene toccata.
-- Apply with:  node scripts/setup-detective.mjs
-- ============================================================

create table if not exists detective_cases (
  id            text primary key,
  place_id      text unique,
  business_name text not null,
  website_url   text default '',
  phone         text default '',
  city          text default '',
  category      text default '',
  raw_data      text default '{}',  -- JSON DetectiveRawData (fonti pubbliche)
  scores        text default '{}',  -- JSON DetectiveScores (5 score 0-100)
  losses        text default '[]',  -- JSON DetectiveLoss[] (max 7, con evidenze)
  analysis      text default '{}',  -- JSON DetectiveAnalysis completa (range, assunzioni)
  report_slug   text unique,        -- slug non indovinabile per /detective/[slug]
  status        text default 'scouted',
  -- scouted -> investigated -> report_ready -> sent -> interested -> pilot -> archived
  wa_message    text default '',    -- messaggio pronto da copiare (invio SEMPRE manuale)
  error         text default '',
  created_at    text default (datetime('now')),
  updated_at    text default (datetime('now'))
);

create index if not exists idx_detective_status on detective_cases(status);
create index if not exists idx_detective_slug on detective_cases(report_slug);
