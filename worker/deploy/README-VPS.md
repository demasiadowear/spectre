# SPECTRE worker su VPS — guida operativa

Sposta il worker WhatsApp su un server sempre acceso. Il numero WA
**resta lo stesso**: si ri-scansiona il QR **una volta** sul VPS.

## 1. Crea il VPS (5 min)

- Provider consigliato: **Hetzner Cloud** → https://console.hetzner.cloud
- Server: **CX22** (2 vCPU, 4 GB RAM, 40 GB) — ~**€4,30/mese** (IPv4 incl.)
  - I 4 GB servono: whatsapp-web.js gira Chromium headless. Con 1 GB va OOM.
- Immagine: **Ubuntu 24.04 LTS**
- Location: Falkenstein o Helsinki (EU, GDPR ok)
- Aggiungi la tua **chiave SSH** in fase di creazione.

Annota l'**IP pubblico** del server.

## 2. Provisioning (una volta sola)

Dal tuo PC, carica lo script e lancialo come root:

```bash
scp worker/deploy/setup-vps.sh root@<IP>:/root/
ssh root@<IP> "bash /root/setup-vps.sh"
```

Installa Node 20, le librerie Chromium e pm2.

## 3. Carica il worker (NON la sessione locale)

Da `C:\Users\ilpuc\Desktop\specter\worker`, copia il codice **escludendo**
`node_modules`, `.wwebjs_auth` (sessione locale) e `.worker.lock`:

```bash
# Windows PowerShell / Git Bash dal path worker/
scp -r index.mjs lib package.json package-lock.json ecosystem.config.cjs \
    root@<IP>:/opt/spectre/worker/
```

> ⚠️ Il `.env` contiene i segreti (Turso, Gemini): caricalo a parte.
> ```bash
> scp .env root@<IP>:/opt/spectre/worker/.env
> ```
> Sul VPS togli/azzera `WA_SESSION_DIR` non serve cambiarlo (default
> `./.wwebjs_auth`, verrà ricreato vuoto → QR nuovo).

Installa le dipendenze sul VPS:

```bash
ssh root@<IP> "cd /opt/spectre/worker && npm install --omit=dev"
```

## 4. Avvio + scansione QR (una volta)

```bash
ssh root@<IP>
cd /opt/spectre/worker
pm2 start ecosystem.config.cjs
pm2 logs spectre-worker        # qui compare il QR ASCII
```

Dal telefono col numero **WA Business AYROMEX**:
WhatsApp → **Dispositivi collegati** → *Collega un dispositivo* → inquadra il QR.

Appena vedi `WhatsApp pronto. Loop outreach attivo.` → connesso.
(`Ctrl+C` esce solo dai log, **non** ferma il worker.)

## 5. Rendi tutto automatico al boot

```bash
pm2 save
pm2 startup        # esegui la riga che stampa, poi di nuovo: pm2 save
```

Da qui: il worker riparte da solo a ogni **crash**, ogni **reboot**, e
ogni volta che il **health-probe WA** rileva la sessione zombie ed esce.

## 6. Spegni il worker locale

Sul tuo PC chiudi il watchdog/finestra del worker. Non ti serve più
tenere il PC acceso.

---

## Comandi utili (sul VPS)

```bash
pm2 status                 # stato + restart count + RAM
pm2 logs spectre-worker    # log live
pm2 restart spectre-worker # restart manuale
pm2 monit                  # dashboard testuale CPU/RAM
```

## Aggiornare il worker in futuro

```bash
scp index.mjs lib/*.mjs root@<IP>:/opt/spectre/worker/   # + lib/ se cambiata
ssh root@<IP> "pm2 restart spectre-worker"
```

## Costo reale

| Voce | €/mese |
|------|--------|
| Hetzner CX22 (4 GB) | ~3,79 |
| IPv4 | ~0,50 |
| **Totale** | **~4,30** (≈5 con IVA) |
