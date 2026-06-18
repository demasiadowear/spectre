# SPECTRE AUTOPILOT — copilota manuale

Pipeline assistita, **tutta dentro la web-app, zero automazione WhatsApp**:
**lead → studio → primo messaggio (lo mandi tu) → risposta del cliente
(la incolli tu) → triage + risposta suggerita → trattativa manuale**.

Scout e Study restano automatici (cron Vercel). Tutto il contatto su
WhatsApp lo fai **tu a mano** via `wa.me`: SPECTRE prepara, smista e
suggerisce, ma non manda né legge messaggi da solo. Niente worker.

```
┌────────────┐   ┌────────────┐   ┌──────────────────────────────────────────┐
│ STADIO 1   │   │ STADIO 1.5 │   │ STADIO 2 — copilota manuale (web-app)     │
│ SCOUT      │──▶│ STUDY      │──▶│ tu mandi/incolli da WhatsApp, SPECTRE      │
│ cron Vercel│   │ cron Vercel│   │ smista (triage Gemini) e suggerisce        │
└────────────┘   └────────────┘   └──────────────────────────────────────────┘
   "nuovo"        "studiato"        "contattato" → risposto_manuale / da_chiamare
                  (pronto da         / demo_richiesta / richiesta_prezzo / tiepido
                   contattare)        / perso  (+ stati trattativa manuali)
```

## Componenti

### Stadio 1 — Scout (`/api/autopilot/scout`, cron giornaliero 6:00 lun-ven)
Google Places Text Search su categorie×località (Bari/Modugno/provincia,
griglia ruotata, 5 query/run). Filtro rating ≥4.5, 30+ recensioni, **senza
sito**. Tier scoring, dedup contro tutto il DB (place_id + telefono),
insert lead + riga `autopilot_pipeline` stato **nuovo**.

### Stadio 1.5 — Study (`/api/autopilot/study`, cron 6:30 lun-ven)
Places Details (recensioni recenti) + gap analysis per categoria, poi
Gemini Flash genera **lead brief (5 righe)** + **primo messaggio WA unico**
(dettaglio vero dell'attività, gap concreto, proposta senza preventivo,
tono pugliese-professionale). Stato → **studiato** = pronto da contattare.
Niente coda di approvazione: il messaggio è subito modificabile e si manda
a mano. I numeri fissi vengono archiviati prima (non sono su WhatsApp).

### Stadio 2 — Contatto manuale (dashboard `/autopilot`)
Tutto dal drawer del lead, nessun automatismo:

1. **Primo messaggio** — il testo preparato da Study è editabile.
   Bottone **"Apri in WhatsApp"** (`wa.me` col messaggio precompilato):
   lo rivedi e lo invii a mano. Poi **"Segna come inviato"** → stato
   **contattato**.
2. **Risposta del cliente** — incolli nel box cosa ti ha scritto.
   SPECTRE la salva come messaggio in entrata, la **TRIAGE Gemini** smista
   lo stato (demo richiesta / da chiamare con data / richiesta prezzo /
   tiepido / perso / da rispondere) e **prepara una bozza di risposta**.
3. **Risposta suggerita** — bozza editabile. **"Apri in WhatsApp"** per
   inviarla (rivedi o cambia), **"Segna come inviato"**, **"Rigenera"** per
   una bozza diversa.
4. **Demo** — la prepari tu fuori da SPECTRE, incolli il link, lo mandi a
   mano su WhatsApp e segni **"demo inviata"**. SPECTRE non builda nulla.
5. **Trattativa** — stato, prossima azione + data (agenda), note: tutto
   manuale. La conversazione (inviati / ricevuti) resta salvata e leggibile
   sul lead.

Il triage usa soglie prudenti: "perso" solo se nettissimo, nel dubbio
sempre "da rispondere". Mai un messaggio parte da solo verso il lead.

## Dashboard `/autopilot`
Pipeline view (lista + kanban), filtri a chip (richiede azione / agenda /
da contattare / da rispondere / trattative / demo / contattati / vinti-persi
/ nuovi / archiviati), ordinamento "richiede azione" in cima, agenda
ordinata per data, drawer di dettaglio col flusso sopra, notifiche.

## API
| Metodo | Endpoint | Funzione |
|--------|----------|----------|
| GET/PATCH | `/api/autopilot/pipeline` | Lista pipeline + stats · azioni (archivia, trattativa) |
| POST | `/api/autopilot/conversation` | `log_outbound` · `log_inbound` (triage + suggerimento) · `suggest` · `mark_demo_sent` |
| POST | `/api/autopilot/study` | Run study on-demand |
| GET/POST | `/api/autopilot/import` | Import lead da Visor |
| GET/PATCH | `/api/autopilot/alerts` | Notifiche |
| GET/POST | `/api/autopilot/scout` | Scout (cron) |

## Setup
1. **Schema** (estende il Turso esistente): `node scripts/setup-autopilot.mjs`
2. **Env Vercel**: `CRON_SECRET` (oltre a Turso/Gemini/Places). Cron in `vercel.json`.

## Tabelle
`autopilot_pipeline` (stato per lead, FK su `leads`; `demo_url`,
`demo_sent_at`, `next_action`, `next_action_at`, `lost_reason`),
`wa_messages` (storico conversazione, in/out scritti a mano dall'operatore),
`autopilot_alerts` (notifiche dashboard). Le tabelle worker
(`autopilot_counters`, settings di warm-up/heartbeat) non sono più usate.
