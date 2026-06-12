# SPECTRE Autopilot — Worker

Processo long-running dello Stadio 2 della pipeline Autopilot.
Gira su una macchina sempre accesa (VPS o Mac locale), **non su Vercel**:
whatsapp-web.js ha bisogno di una sessione browser persistente.

Condivide il DB Turso di SPECTRE: dashboard e cron (Vercel) scrivono la
pipeline, il worker la consuma.

> SPECTRE **non builda demo**: le demo le prepara Puccio fuori da SPECTRE.
> Il worker invia solo il link (`demo_url`) incollato e approvato in
> dashboard. Nessun build runner, nessun token Vercel.

## Componenti

| Processo | Comando | Cosa fa |
| --- | --- | --- |
| Worker WA | `npm start` | Outreach primo contatto, follow-up gg 3/7, classificatore risposte a 3 vie, notifiche a Puccio, invio link demo approvati, anomaly detection, heartbeat |

## Setup

```bash
cd worker
npm install
cp .env.example .env              # compila i valori
npm start
```

Su Windows usa `start-worker.ps1`: watchdog con auto-restart (nel
commento in testa c'è il comando `schtasks` per l'avvio al boot).

Al primo avvio compare un QR in console: scansionalo con il **numero WA
Business AYROMEX** (WhatsApp > Dispositivi collegati). La sessione resta
in `WA_SESSION_DIR` (default `./.wwebjs_auth`) e non viene più richiesta.

## Regole operative (hardcoded / da settings)

- **Warm-up**: parte al primo invio (`warmup_started_at`). Primi 14 giorni:
  max 10 nuovi contatti/giorno e primo messaggio **solo se approvato** in
  dashboard. Dopo: 15/giorno (cap modificabili da dashboard) e invio auto.
- **Finestre**: invio lun-sab 9-20 Europe/Rome (solo domenica esclusa). Delay random 60-240s
  tra messaggi.
- **Kill switch**: flag globale in `autopilot_settings`, togglabile dalla
  dashboard. Si attiva da solo su: 3 invii consecutivi falliti, 5+
  messaggi non consegnati in giornata, sessione WA disconnessa.
- **Classificatore risposte (3 vie)**: auto-reply WA Business (pattern,
  latenza <3s, menu interattivi, Gemini nei dubbi — dubbio = umana) → un
  solo messaggio di sblocco (`bypass_autoreply`), poi silenzio; risposta
  umana → notifica WA immediata a Puccio + stage `risposto_manuale`, bot
  muto per sempre su quella chat; opt-out → archivio gentile, zero
  notifiche. Bot conversazionale legacy dietro flag `bot_conversational`
  (default OFF).
- **Follow-up gg 3/7**: solo per lead **mai** risposti da umano; archivio
  automatico al giorno 10.
- **Demo (manuale)**: `demo_richiesta` è solo uno stato. Puccio prepara
  la demo fuori, incolla il link nel drawer e approva: il worker invia
  il messaggio `demo_ready` e marca `demo_sent_at`.
- **Heartbeat**: `worker_heartbeat` in `autopilot_settings` ogni ~60s;
  la dashboard mostra WORKER OFFLINE se manca da più di 3 minuti.
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
