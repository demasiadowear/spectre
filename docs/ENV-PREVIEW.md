# Variabili necessarie allo scope Preview

Ricavate leggendo il codice, non da memoria. Ogni nome qui sotto e
letto da un modulo del percorso che il collaudo attraversa. **Solo
nomi: nessun valore compare in questo documento, nella dashboard o
nelle API.**

Dopo averle abilitate per lo scope Preview serve un **redeploy**: le
variabili si legano al deployment, e quelli gia costruiti non le
vedono.

Non toccare la Deployment Protection di Vercel: resta com'e.

---

## 1. Indispensabili per l'autenticazione

Senza queste due l'applicazione **non si apre**: risponde 503
`authentication_not_configured` su dashboard e API. Non c'e piu nessun
ripiego a modalita aperta.

| nome | letta da | perche |
|---|---|---|
| `SPECTRE_PASSWORD` | `lib/auth.ts`, `lib/auth-mode.ts` | la credenziale dell'operatore |
| `NEXTAUTH_SECRET` | `lib/auth.ts`, `middleware.ts` | firma le sessioni. **Non ha piu un valore di ripiego**: quello precedente era una stringa fissa dentro un repository pubblico, quindi chiunque poteva firmarsi un token valido |

Opzionale: `SPECTRE_USER` (il nome dell'operatore; senza, vale
`puccio`).

## 2. Indispensabili per Turso

Senza queste il dossier si costruisce ma non si salva, e la dashboard
mostra `database_not_configured`.

| nome | letta da |
|---|---|
| `TURSO_DATABASE_URL` | `lib/turso.ts` |
| `TURSO_AUTH_TOKEN` | `lib/turso.ts` |

Se sono presenti ma l'host non risponde, lo stato diventa
`database_unreachable`; se risponde ma mancano le tabelle,
`database_schema_missing`. Sono tre guasti diversi e la dashboard li
distingue.

## 3. Indispensabile per Google Places

| nome | letta da |
|---|---|
| `GOOGLE_PLACES_API_KEY` | `lib/collector/places.ts`, `lib/hunter/*`, `lib/zone/google.ts`, `lib/autopilot/study.ts`, `lib/detective/investigate.ts` |

Nota: alimenta anche PageSpeed Insights
(`lib/detective/investigate.ts`), quindi non e una chiave «Places» ma
una chiave di progetto Google Cloud.

## 4. Opzionali — storage e browser

Assenti si puo lavorare lo stesso, e il comportamento cambia in modo
dichiarato, non in silenzio.

| nome | conseguenza se assente |
|---|---|
| `MEDIA_STORAGE_URL` | i media restano riferimenti e checksum; nessun byte viene conservato. E il comportamento previsto finche non esiste lo storage (ADR-001) |
| `BROWSER_WORKER_URL` | i profili che richiedono un browser vero restano `browser_required` invece di essere dichiarati inesistenti |
| `BROWSER_WORKER_TOKEN` | solo se il browser remoto richiede autenticazione |

## 5. Gia presenti, da lasciare come sono

Non servono al collaudo del collector ma il codice le legge. Non vanno
aggiunte se non ci sono.

`CRON_SECRET` (bearer dei cron), `FACTORY_PUBLIC_URL`,
`FACTORY_PAUSED`, `FACTORY_MAX_SITE_AUDITS`,
`FACTORY_MAX_DEMOS_PER_DAY`, `FACTORY_MIN_SCORE`,
`FACTORY_RECHECK_DAYS`, `FACTORY_DEMO_FRESH_DAYS`,
`FACTORY_MAX_ATTEMPTS`, `FACTORY_TIMEOUT_MS`, `FACTORY_CONCURRENCY`,
`FACTORY_DRY_RUN`, `FACTORY_SCOUT_MODE`.

`VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `NODE_ENV` le imposta Vercel.

## 6. Da NON impostare su Vercel

| nome | perche |
|---|---|
| `ALLOW_DEV_NO_AUTH` | e l'opt-in della modalita aperta. Su Vercel non ha effetto per costruzione — un test lo verifica — ma impostarla comunicherebbe un'intenzione sbagliata |

---

## Come verificare che sia andata

Aperta la Preview, la pagina `/factory` mostra in cima **Stato del
runtime** con sette voci si/no e lo stato preciso del database. Quando
sono tutte a posto, «Raccogli» si accende; finche non lo sono, resta
spento e dice quale condizione manca.

Lo stesso si legge da `GET /api/collector/capability`, che sta dietro
la sessione operatore e restituisce booleani e nomi di variabili.
