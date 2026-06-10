# SPECTRE Autopilot — Worker

Processo long-running per gli stadi 2 e 3 della pipeline Autopilot.
Gira su una macchina sempre accesa (VPS o Mac locale), **non su Vercel**:
whatsapp-web.js ha bisogno di una sessione browser persistente.

Condivide il DB Turso di SPECTRE: dashboard e cron (Vercel) scrivono la
pipeline, il worker la consuma.

## Componenti

| Processo | Comando | Cosa fa |
| --- | --- | --- |
| Worker WA | `npm start` | Outreach primo contatto, follow-up gg 3/7, bot conversazione Gemini, escalation a Puccio, invio demo approvate, anomaly detection |
| Build runner | `npm run build-runner` | Task `autopilot_builds`: scraping (JustEat per ristoranti), template gallery, deploy Vercel preview |

## Setup

```bash
cd worker
npm install
npx playwright install chromium   # solo se usi il build runner
cp .env.example .env              # compila i valori
npm start
```

Al primo avvio compare un QR in console: scansionalo con il **numero WA
Business AYROMEX** (WhatsApp > Dispositivi collegati). La sessione resta
in `WA_SESSION_DIR` (default `./.wwebjs_auth`) e non viene più richiesta.

## Regole operative (hardcoded / da settings)

- **Warm-up**: parte al primo invio (`warmup_started_at`). Primi 14 giorni:
  max 10 nuovi contatti/giorno e primo messaggio **solo se approvato** in
  dashboard. Dopo: 15/giorno (cap modificabili da dashboard) e invio auto.
- **Finestre**: lun-ven, 9-13 / 16-20 Europe/Rome. Delay random 60-240s
  tra messaggi.
- **Kill switch**: flag globale in `autopilot_settings`, togglabile dalla
  dashboard. Si attiva da solo su: 3 invii consecutivi falliti, 5+
  messaggi non consegnati in giornata, sessione WA disconnessa.
- **Escalation**: lead caldo / domande complesse di prezzo / "posso
  parlare con qualcuno?" → il bot si ferma su quella chat
  (`bot_paused = 1`), Puccio riceve notifica WA con riassunto. La chiamata
  di chiusura la fa sempre Puccio.
- **Demo**: `demo_richiesta` crea il task di build; la preview deployata
  va **approvata in dashboard** prima che il worker la invii al cliente.
- **Logging**: ogni messaggio in/out finisce in `wa_messages` (stato
  consegna aggiornato dagli ack).

## Avvio come servizio (esempio systemd)

```ini
[Unit]
Description=SPECTRE Autopilot WA worker
After=network-online.target

[Service]
WorkingDirectory=/opt/spectre/worker
ExecStart=/usr/bin/node index.mjs
Restart=always
EnvironmentFile=/opt/spectre/worker/.env

[Install]
WantedBy=multi-user.target
```

(Stesso schema per `build/runner.mjs` come secondo servizio.)
