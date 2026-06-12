# SPECTRE AUTOPILOT

Pipeline autonoma: **lead → studio → approvazione messaggio → contatto WA →
classificatore risposte → escalation a Puccio / archivio**. Estende il progetto
SPECTRE esistente (stesso DB Turso, stack lock Gemini Flash, deploy Vercel).

```
┌────────────┐   ┌────────────┐   ┌──────────────┐   ┌──────────────────────┐
│ STADIO 1   │   │ STADIO 1.5 │   │ STADIO 2     │   │ STADIO 3 (manuale)   │
│ SCOUT      │──▶│ STUDY      │──▶│ WA OUTREACH  │──▶│ DEMO                 │
│ cron Vercel│   │ cron Vercel│   │ worker (VPS) │   │ Puccio fuori SPECTRE │
└────────────┘   └────────────┘   └──────────────┘   └──────────────────────┘
   "nuovo"        "studiato"        "contattato"        "demo_richiesta"
                  + coda approvaz.  + classificatore     stato manuale,
                                    + escalation         link incollato
                                    + archiviato         da Puccio
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
  unico** (dettaglio vero dell'attività, gap concreto, proposta senza
  preventivo, tono pugliese-professionale, max 4 righe).
- Warm-up (primi 14 gg): messaggio in coda **"da approvare"** in
  dashboard; dopo: `auto`.

### Stadio 2 — WA Outreach (worker, vedi `worker/README.md`)
- whatsapp-web.js, sessione persistente sul numero WA Business AYROMEX.
- Warm-up 10/giorno → poi 15-20/giorno; invio lun-sab 9-20 (solo domenica esclusa),
  delay random 60-240s.
- Classificatore risposte a 3 vie (logica nel worker):
  - **Auto-reply WA Business** — euristiche (pattern noti, latenza <3s,
    menu interattivi); nei casi dubbi, Gemini decide (dubbio = tratta come
    umana). Un solo messaggio di sblocco (template `bypass_autoreply`),
    poi il bot tace.
  - **Risposta umana** — bot si ferma immediatamente, notifica WA a Puccio
    (template `human_reply_notify`), lead → stato **risposto_manuale**.
    Da quel momento tutto il resto lo fa Puccio.
  - **Opt-out** — archivio gentile senza notifica.
- Follow-up gg 3 e 7 solo per lead mai risposti da umano; archivio al gg 10.
- Bot conversazionale legacy disponibile ma dietro flag `bot_conversational`
  (default **OFF**).
- Kill switch globale (dashboard) + auto-stop su pattern anomali.

### Stadio 3 — Demo (manuale, fuori da SPECTRE)
- Quando il lead ha chiesto la demo, il sistema aggiorna lo stato a
  **demo_richiesta** e notifica Puccio. Nessuna build automatica.
- Puccio prepara la demo esternamente e incolla il link (`demo_url`) nel
  drawer del lead nella dashboard.
- L'invio del link al cliente via WA parte solo dopo approvazione manuale
  di Puccio (template `demo_ready`).

## Worker

Un solo processo: `worker/index.mjs` avviato via `start-worker.ps1`,
watchdog con auto-restart. Il worker pubblica un heartbeat nella tabella
`autopilot_settings` ogni ~60s. La dashboard `/autopilot` mostra il banner
**WORKER OFFLINE** se il heartbeat supera i 3 minuti di silenzio.

## Dashboard

`/autopilot` in SPECTRE: pipeline view (nuovo / studiato / contattato /
risposto_manuale / demo_richiesta / escalation / archiviato), contatore
outreach giornaliero vs cap, coda messaggi da approvare (editabili),
notifiche, kill switch, stato worker (ONLINE / OFFLINE).

## Setup

1. **Schema** (estende il Turso esistente, non duplica):
   ```bash
   TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… node scripts/setup-autopilot.mjs
   ```
2. **Env Vercel**: aggiungi `CRON_SECRET` (oltre alle chiavi già presenti
   Turso/Gemini/Places). I cron sono in `vercel.json`.
3. **Worker**: vedi `worker/README.md` (VPS/macchina sempre accesa).

## Tabelle aggiunte

`autopilot_pipeline` (stato per lead, FK su `leads`; include colonne
`demo_url` e `demo_sent_at`), `wa_messages` (log completo conversazioni),
`autopilot_settings` (kill switch, warm-up, cap, heartbeat worker),
`autopilot_counters`, `autopilot_alerts`.
