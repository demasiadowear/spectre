-- ============================================================
-- TEMPLATE MANAGER — testi WA unificati di tutto SPECTER.
-- Estensione additiva: nessuna tabella esistente viene toccata.
-- Ogni testo inviato (o copiato) dal sistema vive qui: worker,
-- Study, Cockpit/Visor e notifiche a Puccio leggono SOLO da qui.
-- ============================================================

CREATE TABLE IF NOT EXISTS message_templates (
  key        text PRIMARY KEY,                       -- id stabile (es. followup_day3)
  label      text NOT NULL,                          -- nome leggibile in dashboard
  content    text NOT NULL DEFAULT '',               -- testo con placeholder {X}
  variables  text NOT NULL DEFAULT '[]',             -- JSON array placeholder usati
  updated_at text NOT NULL DEFAULT (datetime('now'))
);
