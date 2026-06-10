# SPECTRE AUTOPILOT

Pipeline autonoma: **lead → studio → contatto WA → demo → escalation a
Puccio / archivio**. Estende il progetto SPECTRE esistente (stesso DB
Turso, stack lock Gemini Flash, deploy Vercel).

```
┌────────────┐   ┌────────────┐   ┌──────────────┐   ┌──────────────┐
│ STADIO 1   │   │ STADIO 1.5 │   │ STADIO 2     │   │ STADIO 3     │
│ SCOUT      │──▶│ STUDY      │──▶│ WA OUTREACH  │──▶│ BUILD DEMO   │
│ cron Vercel│   │ cron Vercel│   │ worker (VPS) │   │ worker (VPS) │
└────────────┘   └────────────┘   └──────────────┘   └──────────────┘
   "nuovo"        "studiato"        "contattato"      "demo_richiesta"
                  + coda approvaz.  + escalation       + approvazione
                                    + archiviato        manuale demo
```

## Componenti

### Stadio 1 — Scout (`/api/autopilot/scout`, cron giornaliero 6:00 lun-ven)
- Google Places (New) Text Search: parrucchieri, ristoranti, lidi, centri
  estetici, enoteche su Bari/Modugno/provincia (griglia ruotata, 5 query/run).
- Filtro: rating ≥ 4.5, 30+ recensioni, **senza sito web**.
- Tier: T1 ≥4.8/100+ rec · T2 ≥4.6/50+ · T3 ≥4.5/30+.
- Dedup contro tutto il DB SPECTRE (place_id + telefono) → insert lead +
  riga `autopilot_pipeline` stato **nuovo**.

### Stadio 1.5 — Study (`/api/autopilot/study`, cron 6:30 lun-ven)
- Places Details: recensioni recenti (cosa amano i clienti).
- Gap analysis per categoria (prenotazioni dirette vs commissioni,
  ricerca locale, vetrina servizi/menu/prezzi).
- Gemini Flash genera **lead brief (5 righe)** + **primo messaggio WA
  unico** (dettaglio vero dell'attività, gap concreto, demo non
  preventivo, tono pugliese-professionale, max 4 righe).
- Warm-up (primi 14 gg): messaggio in coda **"da approvare"** in
  dashboard; dopo: `auto`.

### Stadio 2 — WA Outreach (worker, vedi `worker/README.md`)
- whatsapp-web.js, sessione persistente sul numero WA Business AYROMEX.
- Warm-up 10/giorno → poi 15-20/giorno; invio lun-sab 9-20 (solo domenica esclusa),
  delay random 60-240s.
- Bot Gemini Flash: obiettivo demo gratuita + **Offerta Giugno €499**
  tutto incluso (listino €980+), 100% anticipato, solo siti vetrina.
- Positivo → `demo_richiesta` + notifica Puccio. Caldo/prezzo
  complesso/"voglio parlare con qualcuno" → **escalation** (bot fermo,
  riassunto chat a Puccio — la chiusura è sempre sua).
- No risposta → follow-up gg 3 e 7 → archivio. Rifiuto → archivio gentile.
- Kill switch globale (dashboard) + auto-stop su pattern anomali.

### Stadio 3 — Build (worker `build/runner.mjs`)
- `demo_richiesta` → task build: scraping (ristoranti: processo JustEat
  standard con Playwright → `public/images/menu/[slug].jpg` +
  `manifest.json`), template dai 5 di ayromex-templates-gallery, deploy
  Vercel preview (team christians-projects-7637c213).
- Notifica "demo pronta: [link]" → **approvazione manuale** in dashboard
  prima dell'invio al cliente.

## Dashboard

`/autopilot` in SPECTRE: pipeline view (nuovo / studiato / contattato /
demo_richiesta / escalation / archiviato), contatore outreach giornaliero
vs cap, coda messaggi da approvare (editabili), demo da approvare,
notifiche, kill switch.

## Setup

1. **Schema** (estende il Turso esistente, non duplica):
   ```bash
   TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… node scripts/setup-autopilot.mjs
   ```
2. **Env Vercel**: aggiungi `CRON_SECRET` (oltre alle chiavi già presenti
   Turso/Gemini/Places). I cron sono in `vercel.json`.
3. **Worker**: vedi `worker/README.md` (VPS/macchina sempre accesa).

## Tabelle aggiunte

`autopilot_pipeline` (stato per lead, FK su `leads`), `wa_messages`
(log completo conversazioni), `autopilot_builds`, `autopilot_settings`
(kill switch, warm-up, cap), `autopilot_counters`, `autopilot_alerts`.
