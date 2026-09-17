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

Vedi la sezione finale di questo documento, aggiornata al termine
dell'implementazione, e i commit elencati nel riepilogo di consegna.

---

**Nota di metodo:** nessun dato è stato inviato a prospect; nessun messaggio
WhatsApp/email/SMS viene spedito dal sistema. L'invio resta manuale, come nel
resto di SPECTER.
