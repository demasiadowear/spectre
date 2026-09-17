-- ============================================================
-- SPECTER — Autonomous Website Factory + CRM agentico.
-- Specchio statico di ensureFactorySchema() (lib/factory/db.ts):
-- lo schema è auto-migrato al primo uso, questo file serve come
-- riferimento leggibile e per ispezioni manuali sul DB.
--
-- NB: ribalta la nota in lib/autopilot/schema.sql ("SPECTRE non
-- genera demo", 12/06/2026). Ora le demo le genera SPECTER, ma
-- l'INVIO al prospect resta manuale come nel resto del sistema.
-- ============================================================

-- Progetto sito di un lead: SiteSpec versionata + esito QA + demo.
create table if not exists forge_projects (
  id                  text primary key,
  lead_id             text not null,
  -- Slug preview non enumerabile (crypto.randomBytes).
  slug                text not null unique,
  stage               text not null default 'discovered',
  spec_version        integer not null default 1,
  -- SiteSpec JSON già sanificata (nessun fatto privo di fonte).
  spec                text default '',
  template            text not null default 'local-business',
  demo_url            text default '',
  qa_score            integer not null default 0,
  qa_report           text default '',
  screenshot_desktop  text default '',
  screenshot_mobile   text default '',
  approved_at         text,
  created_at          text default (datetime('now')),
  updated_at          text default (datetime('now'))
);

-- Coda agentica. Niente FOR UPDATE SKIP LOCKED su libSQL: il claim
-- è un UPDATE condizionale che vince una sola volta (vedi claimJob).
create table if not exists agent_jobs (
  id               text primary key,
  lead_id          text default '',
  deal_id          text default '',
  forge_project_id text default '',
  kind             text not null,
  -- Perché il job esiste: visibile in timeline, mai un'azione opaca.
  reason           text default '',
  payload          text default '{}',
  priority         integer not null default 0,
  -- Tetto di chiamate esterne consentite al job (anti-spesa).
  budget           integer not null default 1,
  attempts         integer not null default 0,
  max_attempts     integer not null default 3,
  status           text not null default 'pending',
  due_at           text default (datetime('now')),
  leased_until     text,
  worker_id        text default '',
  started_at       text,
  finished_at      text,
  outcome          text default '',
  error            text default '',
  -- Un solo job vivo per (lead, kind): anti-duplicato del dispatcher.
  -- null = nessuna chiave. NON stringa vuota: l'indice unico è TOTALE
  -- perché "on conflict(col)" non accetta un indice parziale come
  -- bersaglio, e SQLite considera i null tutti distinti.
  idempotency_key  text,
  created_at       text default (datetime('now')),
  updated_at       text default (datetime('now'))
);

-- Timeline unica del lead: note, visite, cambi fase, azioni AI, QA.
create table if not exists activities (
  id               text primary key,
  lead_id          text not null,
  forge_project_id text default '',
  type             text not null default 'note',
  subject          text default '',
  body             text default '',
  metadata         text default '{}',
  occurred_at      text default (datetime('now')),
  due_at           text,
  completed_at     text,
  -- 'ai' | 'system' | 'puccio': chi ha prodotto la riga.
  created_by       text default 'system',
  created_at       text default (datetime('now')),
  updated_at       text default (datetime('now'))
);

-- Fatti con evidenza. Separazione netta fra ciò che è VERIFICATO
-- (applied) e ciò che l'automazione PROPONE (proposed): un fatto
-- proposto non entra mai in un sito o in un messaggio finché non
-- viene approvato a mano.
create table if not exists contact_facts (
  id          text primary key,
  lead_id     text not null,
  field       text not null,
  value       text default '',
  band        text not null default 'possible',
  status      text not null default 'proposed',
  evidence    text default '{}',
  source_url  text default '',
  method      text default '',
  observed_at text default (datetime('now')),
  decided_at  text,
  created_at  text default (datetime('now'))
);

-- Promemoria. Il sistema NON invia nulla: ricorda soltanto.
create table if not exists followups (
  id               text primary key,
  lead_id          text not null,
  forge_project_id text default '',
  title            text default '',
  note             text default '',
  due_at           text not null,
  completed_at     text,
  assigned_to      text default 'puccio',
  -- lead + titolo normalizzato + giorno: niente promemoria doppi.
  -- null = nessun dedup (come idempotency_key sopra).
  dedup_key        text,
  created_at       text default (datetime('now')),
  updated_at       text default (datetime('now'))
);

-- Tracking demo: aggregato e anonimo, nessun fingerprinting.
create table if not exists demo_views (
  id               text primary key,
  forge_project_id text not null,
  lead_id          text default '',
  device           text default 'desktop',
  cta_clicked      text default '',
  viewed_at        text default (datetime('now'))
);

create unique index if not exists idx_agent_jobs_idem
  on agent_jobs(idempotency_key);
create index if not exists idx_agent_jobs_claim on agent_jobs(status, due_at, priority);
create index if not exists idx_agent_jobs_lead on agent_jobs(lead_id, kind);
create index if not exists idx_forge_lead on forge_projects(lead_id);
create index if not exists idx_forge_stage on forge_projects(stage);
create index if not exists idx_activities_lead on activities(lead_id, occurred_at);
create index if not exists idx_contact_facts_lead on contact_facts(lead_id, field);
create index if not exists idx_followups_due on followups(due_at, completed_at);
create unique index if not exists idx_followups_dedup
  on followups(dedup_key);
create index if not exists idx_demo_views_project on demo_views(forge_project_id, viewed_at);

-- Colonne aggiunte a autopilot_pipeline (ALTER protetto da try/catch
-- nel codice: "duplicate column" = già migrata).
-- alter table autopilot_pipeline add column website_status text default '';
-- alter table autopilot_pipeline add column website_opportunity_score integer not null default 0;
-- alter table autopilot_pipeline add column website_reasons text default '[]';
-- alter table autopilot_pipeline add column website_checked_at text;
-- alter table autopilot_pipeline add column factory_stage text default '';
