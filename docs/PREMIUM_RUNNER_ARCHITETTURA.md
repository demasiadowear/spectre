# Runner premium — architettura

> Fase 1 del brief. Il renderer deterministico esistente **resta**, ma
> cambia ruolo. Data: 2026-09-17.

## 1. Due generatori, non uno

| | Renderer deterministico (esistente) | Claude Code Runner (nuovo) |
|---|---|---|
| Dove | dentro Specter (`components/factory/SiteRenderer.tsx`) | worker separato, fuori da Vercel |
| Costo | ~0 (nessuna chiamata AI) | una sessione Claude Code per sito |
| Tempo | millisecondi | minuti |
| Esito | pagina corretta, verticale, prevedibile | sito con direzione artistica propria |
| Ruolo | **fallback, modalità rapida, modalità economica, rete di sicurezza** | **generatore principale** |

Il fallback non è un ripiego da togliere appena possibile: è quello che
gira quando il runner è in coda, quando il budget del giorno è finito,
quando serve una demo in trenta secondi, e quando il runner fallisce.
Una Factory con un solo generatore che costa minuti e soldi non è
utilizzabile in produzione.

## 2. Perché non dentro Vercel

Verificato, non supposto:

- il binario `claude` pesa **218 MB** (`/opt/claude-code/bin/claude`);
  il limite di una lambda è ordini di grandezza sotto;
- una generazione dura **minuti**; `maxDuration` di una function si
  misura in secondi;
- il runner deve installare dipendenze npm e lanciare una build: una
  function serverless ha filesystem effimero e sola lettura fuori da
  `/tmp`.

## 3. La forma scelta

```
Specter (Vercel)                          Runner (worker persistente)
─────────────────                         ────────────────────────────
job generate_premium_site
  stato: pending
        │  POST /genera  { job_id, brief, hmac }
        ├────────────────────────────────────────────►
        │                                   1. crea workspace isolato
        │                                   2. scrive brief.json
        │                                   3. claude -p --add-dir <ws>
        │                                        --allowedTools "Read Write Edit Bash(npm *)"
        │                                   4. npm install && npm run build
        │                                   5. screenshot + audit (Playwright)
        │                                   6. se QA fallisce → un retry
        │                                   7. pubblica dist/ statico
        │  POST /api/factory/premium-callback
        │◄────────────────────────────────────────────
  stato: ready | qa_failed | failed
  demo_url, qa_report, screenshot
```

**Perché un worker persistente e non GitHub Actions.** Actions sarebbe
comodo (isolamento gratis, log, retry), ma va scartato per una ragione
concreta: il runner deve autenticare Claude Code, e su Actions
servirebbe una credenziale a lunga vita in un secret del repository,
usata da un processo che poi **scrive ed esegue codice generato**. Il
worker persistente tiene quella credenziale su una macchina sola, sotto
il nostro controllo, e non la espone a ogni workflow del repo.

## 4. Isolamento

Ogni sito vive in una directory propria (`forge-projects/<slug>/`) con
proprie dipendenze e propria build. Il codice generato **non deve**:

- importare o modificare codice di Specter;
- aprire il database;
- leggere variabili d'ambiente;
- eseguire comandi arbitrari;
- chiamare servizi esterni a runtime.

Come si fa rispettare, non solo dichiarare:

| Vincolo | Meccanismo |
|---|---|
| niente accesso a Specter | `claude --add-dir <workspace>` limita l'accesso alla sola directory del progetto |
| niente comandi arbitrari | `--allowedTools "Read Write Edit Bash(npm run *) Bash(npm install)"` |
| niente segreti | il worker esegue con un ambiente ripulito: passa solo `PATH`, `HOME`, `NODE_ENV` |
| niente rete a runtime | nessun CDN: font e librerie bundlati (in questo ambiente è già imposto, vedi capabilities §4) |
| dipendenze approvate | allowlist in `package.json` del runner; una dipendenza fuori lista fa fallire la build |
| il progetto vede solo dati verificati | riceve **un solo file**, `brief/brief.json` |

## 5. Tetti di costo

Riusano quelli già in `lib/factory/scout-config.ts`, con due voci nuove:

| Voce | Predefinito | Motivo |
|---|---|---|
| `FACTORY_PREMIUM_PER_DAY` | 3 | una generazione premium costa una sessione Claude Code |
| `FACTORY_PREMIUM_TIMEOUT_MIN` | 12 | oltre, il job si considera perso e il lease scade |
| tentativi | 1 retry | se il QA boccia due volte serve una persona, non un terzo giro |

Il job premium usa la **coda che esiste già**: claim atomico, lease,
backoff, idempotenza e freno d'emergenza sono quelli di
`lib/factory/queue.ts`, già provati con test di concorrenza.

## 6. Stato: cosa è costruito e cosa no

| Pezzo | Stato |
|---|---|
| Progetto isolato con build riproducibile | **fatto** (`forge-projects/gold-barberia-centrale/`) |
| Contratto del brief (un solo file in ingresso) | **fatto** (`brief/brief.json`) |
| QA visivo automatico con screenshot e misure | **fatto** (`scripts/premium-shots.mjs`) |
| Sito gold standard | **fatto** |
| Job `generate_premium_site`, endpoint del worker, callback | **NON costruiti** |

L'ultima riga è voluta: il brief dice di non collegare ancora il
generatore premium alla produzione automatica, e di consegnare prima il
riferimento qualitativo. Progettare la coda premium prima di sapere che
aspetto ha un sito accettabile avrebbe significato automatizzare una
qualità non ancora decisa.
