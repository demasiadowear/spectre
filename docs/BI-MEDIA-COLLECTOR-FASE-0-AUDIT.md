# Business Intelligence & Media Collector — FASE 0, audit

**Data:** 2026-09-17
**Stato:** audit. Nessuna riga di codice scritta.
**Regola seguita:** non duplicare tabelle, tipi o funzioni esistenti; non
dichiarare eseguita una fonte senza accesso reale.

---

## Sintesi

Gran parte di quello che serve **esiste gia**, e in due copie che non si
parlano. Il pezzo davvero mancante e uno solo, ed e il media: nessuna
riga del repository calcola un checksum di un'immagine, ne un hash
percettivo, ne registra diritti o ambito d'uso. Non esiste alcuno
storage oggetti.

Il secondo risultato dell'audit e che **in questo ambiente il collector
non e eseguibile per davvero**, e non per mancanza di chiavi soltanto:
l'egress blocca i siti web arbitrari, cioe la fonte B, che e il cuore
del lavoro.

---

## 1. Schema lead attuale

`lib/turso/schema.sql` — tabella `leads`: 15 colonne piatte piu `meta`
come JSON testuale. `types/index.ts:21` definisce `LeadMeta`, che porta
gia:

`place_id`, `maps_url`, `website`, `has_website`, `ig`, `fb`,
`category`, `segmento`, `rating`, `reviews`, `address`, `city`,
`lat`, `lng`, `phone_type`, `manual: Record<string,string>`,
`linked_pages: string[]`, `source_url`.

**Limite strutturale:** ogni campo di `meta` e un valore nudo. Non c'e
fonte, non c'e metodo, non c'e data di osservazione, non c'e confidenza.
`manual` esiste come mappa separata proprio per aggirare questo: e la
prova che la mancanza di provenienza era gia stata sentita come un
problema e tamponata a mano.

`meta` e JSON dentro SQLite: non indicizzabile, non interrogabile per
campo. Va bene per un pannello, non per riconciliare fatti.

## 2. Dati gia raccolti da Maps/Places

Due chiamate distinte, in due moduli che non si conoscono.

**`lib/hunter/google-places.ts`** — Places API (New), Text Search,
fino a 3 pagine da 20. FieldMask:

```
places.id, places.displayName, places.formattedAddress,
places.nationalPhoneNumber, places.websiteUri, places.rating,
places.userRatingCount, places.location, places.types
```

**`lib/detective/investigate.ts:190`** — Places Details, FieldMask:

```
rating, userRatingCount, googleMapsUri, reviews
```

**Cosa manca rispetto alla fonte A richiesta:** gli **orari**
(`regularOpeningHours`) non li chiede nessuno; il `googleMapsUri` c'e
solo nel Detective; le **fotografie e le loro attribuzioni non sono
richieste da nessuna parte**. Cercando `photos`, `photoUri`,
`photo_reference` e `attribution` in tutto `lib/` non c'e una sola
occorrenza.

Quindi: della fonte A e implementato tutto tranne la parte media, che e
zero. E la parte media e anche quella con i vincoli di licenza piu
stretti, perche le foto Places si possono mostrare solo alle condizioni
del provider (URL, attribuzione, scadenza) — che e esattamente il caso
`provider_display_only` del mandato.

## 3. Job `research_business`

`lib/factory/research.ts`, 634 righe. E gia un motore di
riconciliazione con provenienza, e implementa buona parte di quanto
richiesto sotto «BUSINESS DOSSIER» e «fact reconciliation»:

- **precedenza fra fonti** a 7 livelli (`SOURCE_RANK`):
  `manual` 100 > `lead` 80 > `places` 70 > `official_site` 60 >
  `structured` 55 > `linked_page` 40 > `public` 20;
- **tetto di banda per fonte** (`SOURCE_MAX_BAND`): una deduzione non
  sale mai a `verified`; `capBand()` abbassa e non alza mai;
- **banda dedotta dal metodo** (`bandForMethod`): JSON-LD e
  un'affermazione esplicita, un pattern nel testo no;
- **conflitti non risolti in silenzio**: `mergeCandidates()` tiene il
  valore della fonte piu alta e restituisce `FactConflict[]` con il
  valore tenuto e tutti quelli scartati;
- **normalizzazione per il confronto** (`normalizePhone`, `sameValue`):
  due telefoni scritti diversamente non sono un conflitto;
- **`missing[]`**: campi cercati e non trovati, distinti dai campi mai
  cercati;
- **`sources_used[]`** con esito per fonte;
- **budget**: `maxPages` limita le pagine scaricate; `fetchSite:false`
  esegue tutto senza rete.

**Da estendere, non da riscrivere.** Mancano rispetto al mandato:
`source_type` distinto da `source_url`, una `confidence` numerica
0–100 (oggi e una banda a 3 livelli), `conflict_group`, `usage_scope`.

**E soprattutto: i conflitti non vengono persistiti.** `FactConflict`
vive in memoria dentro il risultato del job e non ha una tabella. Un
conflitto su telefono o orari deve mandare il lead in REVIEW, e per
farlo deve sopravvivere alla fine del job.

## 4. Sistema `Fact<T>` e provenienza

`types/factory.ts:16`:

```ts
interface Fact<T = string> {
  value: T; source: string; method: string;
  observed_at: string; band: FactBand;
}
type FactBand   = "verified" | "probable" | "possible";
type FactStatus = "applied" | "proposed" | "dismissed" | "superseded";
```

Tabella `contact_facts` (`lib/factory/schema.sql`): `id, lead_id, field,
value, band, status, evidence, source_url, method, observed_at,
decided_at, created_at`.

Copertura rispetto ai nove campi richiesti:

| richiesto | stato |
|---|---|
| `value` | c'e |
| `source_url` | c'e |
| `source_type` | **manca** (c'e `SourceKind` in research.ts, non persistito come colonna) |
| `extraction_method` | c'e, come `method` |
| `observed_at` | c'e |
| `confidence` | parziale: banda a 3 livelli, non 0–100 |
| `evidence` | c'e |
| `conflict_group` | **manca** |
| `usage_scope` | **manca** |

`SiteSpec` (`types/factory.ts:118`) obbliga gia i campi commerciali a
viaggiare dentro `Fact<T>`, e `SiteCta.target` deve derivare da un fatto
verificato. La disciplina anti-invenzione c'e gia ed e strutturale.

## 5. Website analyzer

**`lib/factory/website.ts`** (246 righe): HTTP e HTML, nessun browser,
nessun modello. Punteggio opportunita 0–100 dove ogni punto porta un
`OpportunityReason{code,label,points,measured}` — il numero e sempre
scomponibile. Rete isolata in `fetchSite()`, punteggio puro in
`scoreWebsite()`.

**`lib/factory/extract.ts`** (450 righe) — copre gia quasi tutta la
fonte B: JSON-LD (`parseJsonLd`, `extractFromJsonLd`), microdati
(`extractFromMicrodata`), Open Graph e meta (`extractFromMeta`), link
(`extractFromLinks`), immagini (`extractImages`).

`ExtractedSite` raccoglie: `name, legal_name, description, category,
phone, email, address, city, postal_code, hours, services, area_served,
social, images, logo, menu_url, booking_url, price_range, rating,
review_count, schema_types`.

E c'e gia la scoperta social dal sito (`extract.ts:238`):

```
/^https?:\/\/(?:www\.)?(?:facebook|instagram|linkedin|twitter|x|youtube|tiktok|pinterest)\.com\//i
```

**Manca della fonte B:** sitemap e selezione delle pagine rilevanti, e
il team. Tutto il resto c'e.

## 6. Chiavi API realmente disponibili

Verificate per presenza, senza leggerne il valore:

| variabile | stato in questo ambiente |
|---|---|
| `GOOGLE_PLACES_API_KEY` | **assente** |
| `SERPER_API_KEY` | **assente** |
| `GEMINI_API_KEY` | **assente** |
| `TURSO_DATABASE_URL` | **assente** |
| `TURSO_AUTH_TOKEN` | **assente** |
| `ELEVENLABS_API_KEY` | assente |
| `TELEGRAM_BOT_TOKEN` | assente |
| `CRON_SECRET` | assente |

Nessun file `.env` presente: esiste solo `.env.local.example`.

## 7. Provider egress realmente raggiungibili

Misurato, non dedotto. `curl` verso ogni host, esito del CONNECT:

**Raggiungibili**

| host | esito |
|---|---|
| `places.googleapis.com` | HTTP 404 (host risponde) |
| `maps.googleapis.com` | HTTP 302 |
| `generativelanguage.googleapis.com` | HTTP 404 |
| `github.com`, `raw.githubusercontent.com` | HTTP 400 / 301 |
| npm, PyPI, crates.io, proxy.golang.org | in `noProxy` |

**Bloccati — 403 al CONNECT (policy)**

| host | serve a |
|---|---|
| `google.serper.dev` | fonte di ricerca (`lib/enrich/serper.ts`) |
| `www.instagram.com` | fonte C |
| `graph.facebook.com` | fonte C |
| `www.tiktok.com` | fonte C |
| `www.youtube.com` | fonte C |
| `www.linkedin.com` | fonte C |
| `api.turso.tech` | persistenza |
| `example.com`, `www.wikipedia.org`, `schema.org`, un sito d'esempio di un ristorante | **fonte B: qualunque sito web** |

**Conseguenza, senza attenuanti:**

- **fonte A** e l'unica tecnicamente possibile, e solo se arriva la
  chiave: l'host risponde;
- **fonte B non e eseguibile.** Non e un dettaglio di configurazione:
  l'egress nega i siti arbitrari, e la fonte B *e* i siti arbitrari;
- **fonte C non e eseguibile**, nessuna piattaforma raggiungibile;
- **niente puo essere persistito**: Turso e irraggiungibile.

Quindi tutto va scritto contro adapter con fixture, e **nessuna parte
del flusso reale potra essere dichiarata collaudata da qui.**

## 8. Collector e scraper gia esistenti

Ne esistono quattro. Due fanno lo stesso mestiere.

**`lib/factory/research.ts`** — vedi §3. E il candidato naturale a
diventare il collector: e gia costruito attorno alla provenienza.

**`lib/detective/investigate.ts`** (362 righe) — un collector completo,
gia scritto: sito (fetch e parsing, niente browser), Places Details,
IG/FB se linkati dal sito, il tutto distillato in fatti `F1..Fn` come
unica base citabile. Ha gia i filtri di percorso `IG_SKIP` e `FB_SKIP`
che scartano `/p/`, `/reel/`, `/stories/`, `/sharer.php` e simili: e
l'abbozzo dell'identity resolution.

Persiste in `detective_cases` (`place_id` unico, `raw_data` JSON,
`scores`, `losses`, `analysis`, `report_slug`).

**`lib/detective/scout.ts`** — scoperta via Places con dedup
obbligatoria contro tutto il DB prima dell'inserimento.

**`lib/intent/scrapers/`** (`addlance`, `aste`, `freelanceboard`) +
`lib/intent/browser.ts` — scraper Playwright su un dominio diverso
(annunci freelance). Non riusabili nel merito, ma il launcher Chromium
si.

**`lib/enrich/serper.ts`** (69 righe) — ricerca via Serper, gia scritta
per fallire in silenzio senza chiave. **Provider bloccato dall'egress.**

### Il rischio di duplicazione piu serio

`detective_cases` e la pipeline Factory raccolgono **le stesse cose
dalle stesse fonti in due forme diverse**: `DetectiveRawData{website,
gbp, social, facts}` da una parte, `ResearchResult{facts, conflicts,
sources_used, missing, images}` dall'altra. Due fetch dello stesso sito,
due chiamate Places per lo stesso `place_id`, due nozioni di «fatto»
(`DetectiveFact{id,text}` contro `ResearchFact` con banda e fonte).

Costruire un terzo collector accanto a questi due sarebbe l'errore piu
costoso possibile. **Va deciso prima di scrivere codice** se il
BusinessDossier assorbe `investigate.ts` o se resta un consumatore dei
suoi risultati. La mia raccomandazione: il dossier diventa l'unico
raccoglitore, il Detective diventa un *analizzatore* che legge dal
dossier invece di raccogliere per conto suo — il suo valore e nei
punteggi e nel report, non nel fetch.

## 9. Coda agentica

`agent_jobs` (`types/factory.ts:221`) ha gia quello che il mandato
chiede sotto «retry, timeout e cost cap»:

- `budget` — tetto di chiamate esterne per job;
- `attempts` / `max_attempts` — retry;
- `leased_until` + `worker_id` — lease, quindi timeout e ripresa;
- `idempotency_key` — un solo job vivo per (lead, kind);
- `priority`, `due_at`, `status` con `waiting_approval`.

`JobKind` contiene gia `research_business` e `analyze_website`.
Da estendere con le nuove fasi, non da rifare.

## 10. Media — il vero buco

`lib/factory/images.ts` (153 righe) ha gia una politica seria, e va
tenuta:

- host bloccati perche i contenuti sono degli utenti, non
  dell'attivita: `lh3..lh6.googleusercontent.com`,
  `streetviewpixels-pa.googleapis.com`, `maps.gstatic.com`,
  `media-cdn.tripadvisor.com`, `media.thefork.com`,
  `images.deliveryhero.io`;
- schemi pericolosi bloccati sulla stringa grezza prima di qualunque
  parsing (`javascript:`, `data:`, `vbscript:`, `file:`, `blob:`);
- estensioni ammesse chiuse, **niente SVG di terzi** (XSS);
- pixel di tracciamento riconosciuti;
- solo il dominio ufficiale o un suo sottodominio;
- segnaposto quando non c'e niente di usabile: l'assenza di immagini
  non blocca mai la generazione.

**Manca tutto il resto del MediaManifest richiesto:**
`sha256`, `perceptual_hash`, `width`/`height`, `formato`, `filesize`,
`orientation`, `probable_role`, `quality_score`, `relevance_score`,
`duplicate_group`, `people_present`, `rights_status`, `allowed_scope`,
`expires_at`, `attribution`, `copyright_owner`, `account verificato`.

La deduplicazione oggi e solo per URL identico — cioe non funziona nel
caso reale, che e la stessa fotografia servita da tre URL diversi.

**Non esiste alcuno storage oggetti.** Nessun S3, nessun blob, niente.
Questo rende ADR-001 un prerequisito e non un miglioramento.

## 11. UI

`app/(hud)/factory/page.tsx` → `components/factory/FactoryConsole.tsx`
(436 righe): mostra job, progetti e promemoria.

`app/api/factory/facts/route.ts` esiste e fa `PATCH` con
`applied`/`dismissed`, registrando la decisione in timeline —
«fra sei mesi si deve poter risalire a chi ha detto si a un numero di
telefono, e quando».

**Ma nella console non c'e nessuna interfaccia per i fatti.** Nessun
elenco, nessun conflitto, nessuna provenienza, nessuna galleria. La
rotta di approvazione esiste senza una schermata che la usi. La UI di
revisione richiesta e da costruire interamente, su una API che c'e gia.

## 12. Due problemi di correttezza trovati strada facendo

**Nessuno legge `robots.txt`.** Ne `website.ts`, ne `research.ts`, ne
`investigate.ts`. Per un collector che deve «non aggirare blocchi»,
questa e una lacuna da colmare prima di allargare il crawling.

**Due user agent in conflitto fra loro.** La Factory si presenta
onestamente:

```
User-Agent: SpecterSiteAudit/1.0 (+audit interno AYROMEX)
```

Il Detective (`investigate.ts:23`) si traveste da iPhone Safari. Le due
scelte non possono convivere in un sistema che dichiara di non aggirare
blocchi: o ci si identifica, o si sta fingendo di essere un visitatore.
Va uniformata sulla prima.

---

## Cosa NON va duplicato

| esiste | dove | come usarlo |
|---|---|---|
| `Fact<T>`, `FactBand`, `FactStatus` | `types/factory.ts` | estendere con `source_type`, `confidence`, `conflict_group`, `usage_scope` |
| `contact_facts` | `lib/factory/schema.sql` | migrare con le colonne nuove |
| precedenza fonti, tetti di banda, conflitti | `lib/factory/research.ts` | base del fact reconciliation |
| JSON-LD / OG / microdati / social | `lib/factory/extract.ts` | base della fonte B |
| analyzer e opportunity score | `lib/factory/website.ts` | invariato |
| coda con budget, retry, lease, idempotenza | `agent_jobs` | aggiungere solo i nuovi `JobKind` |
| politica URL immagini | `lib/factory/images.ts` | estendere, non sostituire |
| Places Text Search e Details | `lib/hunter/`, `lib/detective/` | unificare in un solo adapter; aggiungere orari, maps URI, foto |
| launcher Chromium | `lib/intent/browser.ts` | riusabile |
| dedup per `place_id` | `lib/detective/db.ts` | riusabile |

## Decisioni da prendere prima di scrivere codice

1. **`investigate.ts` viene assorbito o resta?** E la domanda piu
   importante: da essa dipende se il risultato e un sistema o due.
2. **Dove vivono i media**, dato che nessuno storage esiste (ADR-001).
3. **`confidence` numerica 0–100 accanto alla banda, o al posto suo?**
   Il mandato chiede 0–100 per l'identity resolution; il codice
   esistente ragiona a bande. Convivono se la banda resta la sintesi
   leggibile della soglia.
4. **Quale provider di ricerca**, visto che Serper e bloccato e la
   scoperta social senza ricerca si riduce ai link sul sito e ai
   collegamenti reciproci.

## Cosa si potra e cosa non si potra collaudare

**Collaudabile qui, con fixture:** tutta la logica pura — identity
resolution e punteggi, riconciliazione e conflitti, classificazione dei
diritti, deduplicazione esatta e percettiva, decisione
GO/REVIEW/REJECT, retry, timeout e cost cap, e i casi limite elencati
nel mandato (omonimi, telefono discordante, link reciproco, orari
discordanti, immagini duplicate, foto senza diritti, sito senza social,
social senza sito, lead senza fonti, collector senza credenziali,
provider bloccato).

**Non collaudabile qui:** ogni chiamata reale. Places manca della
chiave; i siti web e tutte le piattaforme social sono negati
dall'egress; Turso e irraggiungibile. Gli adapter andranno scritti
dietro un'interfaccia con implementazione a fixture, e il flusso reale
resta **non collaudato** finche non gira in un ambiente con chiavi ed
egress aperti.
