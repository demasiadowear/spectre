# SPECTRE INTENT SCOUT — richieste pubblicate

Trova aziende/PMI che hanno **PUBBLICATO una richiesta** per
realizzazione sito web o servizi digitali. A differenza dello scout
Autopilot (che cerca attività senza sito), qui l'intento è esplicito:
**il lead va contattato entro 1 ora dalla notifica**.

## Fonti (v1)

| Fonte | Stato | Note |
|-------|-------|------|
| AddLance | ✅ attiva | Lista pubblica `/lavoro-freelance` (~20 più recenti), budget + data relativa. Contatto dietro account. |
| Freelanceboard | ✅ attiva | Lista pubblica `progetti.php` (20 più recenti, il filtro categoria è ignorato dall'AJAX). Posizione + data. Ragione sociale dietro login. |
| ProntoPro | ❌ esclusa | Richieste visibili solo ai professionisti registrati, contatti a pagamento. |
| Sevedemo | ❌ esclusa | Nessuna lista progetti pubblica. |
| Subito.it | ❌ esclusa | Anti-bot DataDome: blocca l'headless. Alternativa pulita: ricerche salvate + email alert di Subito. |

## Pipeline

```
scraper (Playwright headless) → filtro keyword (sito web / servizi digitali)
  → dedup vs DB (source_url UNIQUE + piattaforma|titolo normalizzato)
  → scoring 0-100 → insert leads (source="intent_<piattaforma>") + intent_pipeline
  → Study Gemini: gancio apertura 2-3 righe (fallback deterministico senza key)
  → score >= 60: alert dashboard + notifica Telegram immediata
```

**Scoring**: base 10 · freschezza <24h +50 / <48h +30 / <7g +15 ·
zona Puglia +25 · budget dichiarato +15. Soglia notifica 60 = solo
richieste <24h arrivano a notifica anche senza bonus.

**Kanban dedicato** `/intent`: `intent_found → contacted → meeting → won / lost`.

## Scheduling — ogni 2 ore, 7-21

L'endpoint è `GET /api/intent/scout`, protetto dallo stesso
`CRON_SECRET` degli altri scout (header `Authorization: Bearer <secret>`).

- **Vercel Hobby** (default): cron esterno su [cron-job.org](https://cron-job.org) —
  gratuito, supporta header custom e schedule `0 7-21/2 * * *`.
- **Vercel Pro**: si può aggiungere a `vercel.json`:
  `{ "path": "/api/intent/scout", "schedule": "0 7-21/2 * * *" }`
  (su Hobby i cron sono solo giornalieri: non aggiungerlo).

## Setup

1. Schema: `node scripts/setup-intent.mjs` (idempotente, estende il Turso esistente)
2. Env: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (v. `.env.local.example`)
3. Scheduler: v. sopra
4. Test scraper senza DB: `npx tsx scripts/test-intent-scrapers.mts`

## Tabelle

`intent_pipeline` (FK su `leads`): stage, platform, source_url (UNIQUE,
dedup), title/body/category/zone/budget, published_at, score, hook
(gancio Study), notified. I lead vivono nella tabella `leads` condivisa
con `source = "intent_addlance" | "intent_freelanceboard"`.
