# SPECTER — Autonomous Website Factory + Agentic Sales CRM

> Documento di audit e architettura. Redatto in fase F0 (audit obbligatorio) e
> aggiornato durante l'implementazione. Rappresenta il codice **realmente**
> presente nel repository, non il codice desiderato.

Data audit: 2026-09-17 · Branch: `claude/spectre-autopilot-pipeline-vbezmj`

---

## 1. Esito dell'audit: il presupposto di partenza era falso

La richiesta iniziale assumeva che esistesse un modulo **Forge** da "recuperare e
completare", con `forge_projects`, `SiteSpec`, renderer e route `/preview/[slug]`,
e faceva riferimento al commit `b907595`.

**Nessuno di questi elementi esiste in questo repository.** Verificato con
ricerca esaustiva su `*.ts`, `*.tsx`, `*.sql`, `*.md`, `*.json` (esclusi
`node_modules` e `.next`):

| Elemento atteso | Riscontro | Evidenza |
|---|---|---|
| commit `b907595` | **ASSENTE** | `git cat-file -t b907595` → *Not a valid object name*; assente da `git log --all` e da `git reflog` |
| modulo `Forge` | **ASSENTE** | 0 file contengono la stringa `forge` (case-insensitive) |
| tabella `forge_projects` | **ASSENTE** | 0 occorrenze |
| `SiteSpec` | **ASSENTE** | 0 occorrenze |
| renderer Forge | **ASSENTE** | — |
| route `/preview/[slug]` | **ASSENTE** | unica occorrenza di `preview/` è la classe CSS `fn-preview` in `lib/constants.ts:69` |
| `website_status` | **ASSENTE** | 0 occorrenze |
| `website_opportunity_score` | **ASSENTE** | 0 occorrenze |
| `agent_jobs` | **ASSENTE** | 0 occorrenze |

**Conclusione:** non si tratta di un recupero, ma di una **costruzione
greenfield**. Il lavoro è stato eseguito di conseguenza.

### 1.1 Decisione architetturale preesistente, ora ribaltata

`lib/autopilot/schema.sql:60-62` contiene una decisione esplicita e datata:

```sql
-- NESSUNA tabella build: SPECTRE non genera demo (decisione 12/06/2026).
-- Le demo le prepara Puccio fuori; demo_url/demo_sent_at vivono sulla
-- pipeline e il worker invia il link solo dietro approvazione.
```

`demo_url` esiste quindi **solo come campo testuale incollato a mano**
(`autopilot_pipeline.demo_url`, azione `mark_demo_sent` in
`app/api/autopilot/conversation/route.ts:168`, campo nel drawer
`components/autopilot/AutopilotLeadDrawer.tsx:175`). Non esiste alcun
generatore.

L'implementazione di Forge **ribalta consapevolmente** quella decisione. Il
commento nello schema è stato aggiornato per non lasciare documentazione
contraddittoria.

---

## 2. Architettura attuale verificata

| Aspetto | Stato reale | Evidenza |
|---|---|---|
| Framework | Next.js **14.2.35** App Router, React 18, TS 5 | `package.json` |
| Runtime | Node 22 | `node -v` |
| DB | **Turso/libSQL** (`@libsql/client`), con fallback mock in-memory | `lib/turso.ts`, `lib/data.ts:23-35` |
| Auth | NextAuth v4 Credentials, JWT, **single-user**, password da env; **aperta se `SPECTRE_PASSWORD` è vuota** | `lib/auth.ts:11-47`, `middleware.ts:11-16` |
| Hosting | Vercel (serverless) | `vercel.json`, `next.config.mjs` |
| Cron | 2 Vercel cron feriali UTC: `/api/autopilot/scout` 06:00, `/api/autopilot/study` 06:30 | `vercel.json` |
| AI | **Gemini** (`gemini-2.5-flash-lite` / `gemini-2.5-flash`), fallback-to-mock, **no tool-calling, no retry** | `lib/gemini.ts:20-133` |
| Browser headless | `playwright-core` + `@sparticuz/chromium` (già usati da Intent/aste) | `package.json`, `next.config.mjs` |
| Places | Google Places API v1 | `lib/hunter/google-places.ts`, `lib/zone/google.ts` |
| Notifiche | Telegram (unico canale reale, verso l'operatore) | `lib/telegram.ts` |
| Test | **Nessun test runner** prima di questo lavoro | `package.json` (no jest/vitest) |

### 2.1 Moduli realmente presenti

**Vivi:** Hunter (`components/hunter/*`, `lib/hunter/*`), Zone
(`components/zone/*`, `lib/zone/*` — CRM porta-a-porta AyroStar completo con
agenti/provvigioni), Autopilot/Pipeline (`lib/autopilot/*`), Intent
(`lib/intent/*`), Detective (`lib/detective/*`), Templates, Hand, Voice.

**Storici / non moduli a sé:**
- **Visor** — confluito in Pipeline. `types/voice.ts:43`: *"storico: nessun
  listener, Visor è confluito in Pipeline"*; `components/hunter/HunterConsole.tsx:24`:
  *"Visor non esiste come pagina a sé"*. `VisorFrame.tsx` è un componente UI vuoto.
- **Deals** — non è un modulo: la pipeline commerciale è `leads` +
  `autopilot_pipeline`.
- **Forecast** — 3 occorrenze testuali, nessun modulo.

### 2.2 Macchina a stati preesistente (da riusare, non duplicare)

`lib/autopilot/constants.ts` / `types/autopilot.ts`:

```
da_contattare → contattato → ha_risposto → in_trattativa → vinto | perso
                                                         (+ archiviato)
```

---

## 3. Stato reale di Forge prima di questo lavoro

**Inesistente.** Non "incompleto" né "rotto": mai scritto. L'unico residuo
semantico è il campo `demo_url` compilato a mano.

Esistono invece **fossili di un worker WhatsApp dismesso** (campi mai scritti in
`autopilot_pipeline`): `approval_status`, `bot_paused`, `bypass_sent_at`,
`escalated_at`, `escalation_reason`, `followup1_at`, `followup2_at`. Sono stati
lasciati intatti (nessuna regressione) ma non vengono usati dalla Factory.

---

## 4. Funzionalità recuperabili / riusate

| Capacità esistente | Riuso nella Factory |
|---|---|
| Google Places (nome, categoria, indirizzo, coord, telefono, sito, rating, recensioni, place_id) | sorgente dati verificati per la SiteSpec |
| `has_website` di Hunter | segnale iniziale per `analyze_website` |
| `lib/gemini.ts` `geminiJSON<T>` | generazione **solo dati strutturati** |
| `playwright-core` + `@sparticuz/chromium` | screenshot QA |
| `lib/telegram.ts` | notifiche (nessun invio al prospect) |
| `leads` + `autopilot_pipeline` | il lead e la sua fase restano la fonte di verità |
| Pattern `ensureXSchema()` idempotente (Zone/Intent) | migrazioni auto-applicate senza accesso al DB prod |
| Design cyan/magenta glassmorphism (`GlassCard`, `NeonButton`) | UI Factory |

---

## 5. Funzionalità mancanti (costruite in questo lavoro)

1. Analisi e classificazione del sito esistente + `website_opportunity_score`.
2. `SiteSpec` strutturata e validata, con **provenienza obbligatoria** dei fatti.
3. Generazione via Gemini di **soli dati** (mai HTML/React).
4. Renderer deterministico controllato dal repo.
5. Route preview pubblica con slug non enumerabile e `noindex,nofollow`.
6. Coda agentica persistente su Turso con claim atomico, lease, retry, budget.
7. Orchestrazione Hunter → analyze → research → generate → QA → outreach.
8. QA automatico con report, punteggio e screenshot.
9. CRM agentico: timeline attività, fatti con evidenza e banda di affidabilità,
   follow-up.
10. Outreach preparato (mai inviato automaticamente).
11. Tracking visualizzazione demo.
12. Test suite (prima inesistente).

---

## 6. Schema dati introdotto

Tutte le tabelle sono create in modo **idempotente** da
`ensureFactorySchema()` (`lib/factory/db.ts`), coerente col pattern di
`ensureZoneSchema()`. Nessuna tabella esistente viene modificata in modo
distruttivo; le colonne aggiunte a `autopilot_pipeline` usano
`ALTER TABLE ... ADD COLUMN` protetto da try/catch (pattern del repo).

| Tabella | Ruolo |
|---|---|
| `forge_projects` | progetto sito per lead: SiteSpec versionata, slug preview, stato, QA, demo_url |
| `agent_jobs` | coda agentica: kind, payload, priority, budget, attempts, lease, status |
| `activities` | timeline unica (note, chiamate, cambi fase, AI, QA, demo view…) |
| `contact_facts` | fatti con `band` (verified/probable/possible) e `status` (applied/proposed/dismissed/superseded) + evidenza |
| `followups` | promemoria collegati a lead/demo, con dedup |
| `demo_views` | tracking essenziale e anonimo delle visualizzazioni |

Colonne aggiunte a `autopilot_pipeline`: `website_status`,
`website_opportunity_score`, `website_reasons`, `website_checked_at`,
`factory_stage`.

---

## 7. Regole anti-allucinazione (vincolanti)

Implementate in `lib/factory/sitespec.ts`:

- Ogni valore commerciale vive in un `Fact<T>` con `value`, `source`,
  `observed_at`, `band`.
- `sanitizeSiteSpec()` **rimuove** i campi privi di fonte e li elenca in
  `dropped[]`; il renderer non può quindi mostrare dati non tracciabili.
- Campi vietati alla generazione libera (prezzi, promozioni, team, anni di
  esperienza, certificazioni, testimonianze, risultati): se il modello li
  produce senza fonte vengono scartati e registrati.
- Telefono/indirizzo/orari sono ammessi **solo** se provenienti da Places o da
  un fatto verificato; mai inventati dal modello.
- In assenza di dato si usa copy neutro e il campo è marcato `incomplete`.

---

## 8. Sicurezza

- Preview: slug a 22 caratteri da `crypto.randomBytes` (non enumerabile) +
  `robots: noindex, nofollow` a livello di `metadata`.
- Le API interne restano dietro il middleware a sessione; i cron/worker dietro
  `Authorization: Bearer ${CRON_SECRET}` (pattern `isCronAuthorized`).
- Nessuna esecuzione di codice generato dal modello: Gemini produce **JSON**,
  il rendering è fatto da componenti del repository.
- Nessun segreto loggato; solo nomi di variabili d'ambiente in questo documento.

---

## 9. Rischi noti

| Rischio | Mitigazione adottata |
|---|---|
| Consumo incontrollato API (Places/Gemini) | batch max 5, limite giornaliero configurabile, dry-run, budget per job |
| Demo difettosa pubblicata come "pronta" | QA bloccante: `ready` solo se il report passa |
| Allucinazioni del modello | fatti con fonte obbligatoria + sanitizzazione + test dedicati |
| Lease/worker concorrenti | claim atomico condizionale (vedi §10) |
| Auth aperta se `SPECTRE_PASSWORD` non impostata | pre-esistente, **non introdotto qui**; segnalato |
| Screenshot su serverless | `@sparticuz/chromium` già in uso; QA degrada senza fallire se il browser non parte |

---

## 10. Claim atomico su Turso (niente `SKIP LOCKED`)

libSQL non supporta `FOR UPDATE SKIP LOCKED`. Il claim usa un **UPDATE
condizionale** che vince una sola volta:

```sql
update agent_jobs
   set status='running', worker_id=?, leased_until=?, started_at=..., attempts=attempts+1
 where id = (select id from agent_jobs
              where status='pending' and due_at <= now
                and (leased_until is null or leased_until < now)
              order by priority desc, due_at asc limit 1)
   and status='pending'
```

La riga viene aggiornata solo se è ancora `pending` al momento della scrittura:
due worker non possono acquisire lo stesso job. I lease scaduti vengono
recuperati rimettendo il job in `pending`.

---

## 11. Risultati finali

### 11.1 Verifiche

| Controllo | Esito |
|---|---|
| `npx tsc --noEmit` | **pulito** |
| `npm run lint` | **pulito** sui file nuovi (restano 2 warning preesistenti in `components/zone/ZoneClientSheet.tsx` e `lib/autopilot/study.ts`, non toccati) |
| `npm run build` | **compila**, 24/24 pagine; `/factory` e `/preview/[slug]` presenti |
| `npm test` | **183 test, 183 passati** |

Il test runner prima non esisteva: aggiunti `tsx` (unica dipendenza
nuova, dev-only) e `node --test`. `scripts/test.mjs` imposta
`TSX_TSCONFIG_PATH` in modo portabile (su `cmd.exe` `VAR=x comando` non
funziona, e `cross-env` non valeva una dipendenza).
`tsconfig.test.json` serve perché il tsconfig principale tiene
`jsx: "preserve"` per Next: fuori da Next i componenti andrebbero
compilati col runtime classico e cercherebbero un `React` in scope che
giustamente non importano.

### 11.2 Difetti trovati e corretti durante il lavoro

1. **`on conflict(col)` su indice parziale** — l'idempotenza della coda
   usava `create unique index … where idempotency_key <> ''`, ma SQLite
   non accetta un indice **parziale** come bersaglio di
   `on conflict(col)`: ogni `enqueueJob` falliva con *"ON CONFLICT clause
   does not match any PRIMARY KEY or UNIQUE constraint"*. Corretto con
   indice **totale** e chiave `null` (non stringa vuota) quando assente:
   SQLite considera i `null` tutti distinti. Lo stesso difetto era
   presente su `followups.dedup_key`, corretto insieme.
2. **`auditSummary` ordinava per ordine di controllo** — teneva i primi
   quattro rilievi nell'ordine in cui i check girano, quindi il rilievo
   che pesa più poteva restare fuori dal messaggio. Ora ordina per punti.
3. **Tre pattern anti-affermazione troppo stretti** — `testimonial` non
   copriva *"i nostri clienti dicono che…"* (la forma che un modello
   produce davvero), `guarantee` non copriva *"garantita/garantito"* (solo
   tre forme elencate a mano) e `superlative` non copriva il plurale
   *"i migliori"*. `results` non aveva alcun caso di test. Tutti corretti,
   e un test verifica che ogni pattern dichiarato abbia il suo caso.

### 11.3 Limiti noti che restano

- **La ricerca non arricchisce davvero.** `research_business` promuove a
  fatti ciò che è già in `leads.meta`; non legge il sito del prospect né
  i social. La struttura per farlo c'è (`contact_facts` con banda ed
  evidenza), il raccoglitore no.
- **I servizi non vengono mai popolati.** Nessuna fonte verificata li
  fornisce, quindi la sezione resta vuota e il campo è marcato
  `incomplete`. È voluto: preferibile una sezione assente a servizi
  inventati.
- **Nessuna immagine reale.** Il renderer disegna un segnaposto: usare le
  foto Google del locale su un dominio nostro è un problema di licenza,
  non un dettaglio estetico.
- **Leads senza sito solo dallo Scout.** `runScout` qualifica solo chi
  non ha sito (`lib/autopilot/scout.ts`), quindi il ramo "sito debole"
  dell'analisi si esercita solo sui lead arruolati a mano via
  `POST /api/factory/jobs`. Non ho cambiato la regola dello Scout: è una
  decisione commerciale preesistente, non un difetto.
- **QA bocciato = intervento manuale.** Non c'è rigenerazione automatica:
  in loop brucerebbe quota senza cambiare il risultato.
- **Screenshot non attivi per default.** Si abilitano per singolo job
  (`payload.screenshots = true`); il QA non li richiede perché non deve
  dipendere dal browser per dare un verdetto.
- **`SPECTRE_PASSWORD` vuota lascia l'app aperta.** Preesistente,
  segnalato in §9, non introdotto qui.

### 11.4 Variabili d'ambiente (solo NOMI)

Già in uso: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GEMINI_API_KEY`,
`CRON_SECRET`, `SPECTRE_PASSWORD`, `NEXTAUTH_SECRET`,
`GOOGLE_PLACES_API_KEY`, `INTENT_CHROME_PATH`.

Nuove, tutte opzionali:

| Nome | Ruolo | Senza di essa |
|---|---|---|
| `FACTORY_PUBLIC_URL` | base pubblica dei link demo | si ripiega su `VERCEL_URL`, poi su `http://localhost:3000` |
| `FACTORY_PAUSED` | freno globale (`1`/`true`/`on`) | la Factory lavora |
| `FACTORY_CHROME_PATH` | Chrome locale per gli screenshot | si ripiega su `INTENT_CHROME_PATH`, poi sui percorsi noti |

### 11.5 Provare in locale

```bash
npm install
npm test          # 183 test, nessuna rete, nessuna chiave richiesta
npx tsc --noEmit
npm run build
npm run dev
```

Poi, con Turso configurato: `/factory` → "Prova senza eseguire" mostra
cosa farebbe il worker senza toccare niente. Per mettere un lead in
lavorazione: `POST /api/factory/jobs` con `{"lead_id":"…"}`.
Senza Turso la dashboard resta vuota (nessun mock: la coda non deve
fingere di girare).

I test girano contro un **libSQL vero in memoria** (`:memory:`), non
contro un finto database: i vincoli che contano (unicità del dedup, un
solo fatto applicato per campo, esclusività del claim) li fa rispettare
il database. La concorrenza del claim è provata con dieci worker su tre
job.

### 11.6 Prossima fase consigliata

Il raccoglitore di dati reali per `research_business`: leggere il sito
del prospect e le pagine social per proporre servizi, orari ed email
come fatti con banda `probable`, da approvare a mano. È il pezzo che
oggi rende le bozze povere, ed è l'unico che sblocca la sezione servizi.
Tutto il resto (evidenza, approvazione, timeline) è già in piedi.

---

**Nota di metodo:** nessun dato è stato inviato a prospect; nessun messaggio
WhatsApp/email/SMS viene spedito dal sistema. L'invio resta manuale, come nel
resto di SPECTER.
