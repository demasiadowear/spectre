# Capacità realmente disponibili per la Premium Website Factory

> Inventario verificato su questa installazione, non elencato a memoria.
> Ogni riga "installata: sì" è accompagnata dal percorso o dal comando che
> lo dimostra. Data: 2026-09-17.

---

## 0. Esito in una riga

**Nessuna skill di web design, animazione o 3D è installata su questa
macchina.** Le skill di design che si potrebbero immaginare (GSAP,
Three.js, motion design, frontend design, visual QA) **non esistono** qui.

Esistono invece tre capacità reali e sostanziose che tengono in piedi il
progetto: la skill **`artifact-design`**, il **registro npm** (da cui
arrivano GSAP, Three.js, i font), e **Playwright + Chromium** per il QA
visivo. In più, cosa non scontata, la **CLI `claude` funziona in modalità
non interattiva**, il che rende il runner della Fase 1 costruibile davvero.

---

## 1. Skill

### 1.1 Come sono state cercate

```
find ~/.claude/skills -name SKILL.md      # skill su disco
ListSkills                                 # skill abilitate sull'account
SearchSkills ["web design","frontend design","GSAP animation",
              "Three.js WebGL","landing page","motion design",
              "typography","css"]          # → 0 risultati
```

### 1.2 Skill su disco

| Skill | Percorso | Pertinente al design web? |
|---|---|---|
| `session-start-hook` | `~/.claude/skills/session-start-hook/SKILL.md` | no |
| `docx` | `~/.claude/skills/synced/…/docx/SKILL.md` | no |
| `import-memory` | `~/.claude/skills/synced/…/import-memory/SKILL.md` | no |
| `morning` | `~/.claude/skills/synced/…/morning/SKILL.md` | no |
| `pdf` | `~/.claude/skills/synced/…/pdf/SKILL.md` | no |
| `pptx` | `~/.claude/skills/synced/…/pptx/SKILL.md` | no |
| `skill-creator` | `~/.claude/skills/synced/…/skill-creator/SKILL.md` | no |
| `xlsx` | `~/.claude/skills/synced/…/xlsx/SKILL.md` | no |

### 1.3 Skill impacchettate nella CLI (non su disco)

Non hanno un percorso ispezionabile: vivono dentro il binario da 218 MB
in `/opt/claude-code/bin/claude`, e sono invocabili con lo strumento
`Skill`. Quelle rilevanti qui:

| Skill | Pertinente | Uso nella Factory |
|---|---|---|
| **`artifact-design`** | **sì, molto** | **Letta integralmente e applicata.** Vedi §1.4 |
| `dataviz` | marginale | Regole su palette e grafici. Un sito di barbiere non ha grafici: non usata |
| `artifact-diagramming` | no | Diagrammi SVG |
| `artifact-capabilities` | no | Runtime degli Artifact |
| `code-review`, `simplify`, `security-review` | trasversali | Revisione, non design |
| `run`, `init`, `loop`, `update-config`, `workflow-authoring`, `claude-api`, `keybindings-help`, `fewer-permission-prompts` | no | — |

### 1.4 `artifact-design` — l'unica autorità di design disponibile

Letta per intero prima di progettare. Cosa ne ho preso e cosa no:

**Preso (principi di design, trasferibili a qualsiasi pagina):**
- *"Avoid AI-generated design"* — elenca esattamente i cliché che la
  Fase 4 del brief vieta: crema caldo con serif e accento terracotta,
  nero con un solo verde acido, gradiente viola-blu, Inter o Space
  Grotesk come scelta "sicura", emoji come marcatori di sezione, tutto
  centrato, `rounded-lg` ovunque, barra d'accento su card arrotondate.
- *"When the request is editorial"* — il committente ha già rifiutato
  proposte che sembravano template; servono scelte con un punto di vista
  e **un rischio estetico reale**. Rivedere il piano prima di costruire:
  se una parte somiglia al default che produrresti per qualsiasi pagina
  simile, riscriverla.
- *"Spend your boldness in one place; keep everything around it quiet."*
- *"Structure is information"* — i marcatori numerati (01/02/03) si usano
  solo se il contenuto **è** una sequenza.
- *"Ground it in the subject"* — portare almeno un dettaglio che solo
  questo soggetto avrebbe: i suoi materiali, il suo lessico.
- Tipografia: accoppiare i caratteri deliberatamente, scala di tipo
  dichiarata, `text-wrap: balance` sui titoli, testo corrente ~65 caratteri.
- *"Not everything is a card"* — bordo, riempimento, raggio e ombra
  dicono "oggetto separato": spenderli per ruolo, non stamparli su tutto.
- *"Show the page at rest"* — niente sezioni parcheggiate a `opacity: 0`
  in attesa di un observer.

**NON preso (contratto specifico degli Artifact, qui non applicabile):**
- Niente `<!doctype>`/`<head>` propri, allowlist CSP dei CDN, `favicon`
  come emoji, limite di 16 MB, `window.claude.*`. Il sito gold standard
  è un **progetto Vite autonomo**, non un Artifact: ha il suo
  `index.html`, il suo bundler e le sue dipendenze npm.

### 1.5 Skill CERCATE E NON TROVATE

`SearchSkills` su web design, frontend design, GSAP, Three.js, WebGL,
landing page, motion design, tipografia, CSS ha restituito **zero
risultati**. Non esiste in questa installazione nessuna skill di:

frontend design · GSAP · ScrollTrigger · Three.js · React Three Fiber ·
WebGL · motion design · interaction design · image generation ·
typography · responsive design · accessibility · visual testing ·
performance optimization · SEO · copywriting · browser testing.

Le competenze corrispondenti le porto io come modello; non sono
pacchetti installati, e in questo documento non vengono contate come tali.

---

## 2. Plugin

`ListPlugins` ne riporta 16 abilitati. Uno solo ha un nome pertinente:

| Plugin | Contenuto dichiarato | Verdetto |
|---|---|---|
| `design` | "critique, design system management, UX writing, accessibility audits, research synthesis, dev handoff" | **Non utilizzabile qui.** È un plugin di *processo* di design (critique, handoff, audit), non di costruzione. Nessuna sua skill compare fra quelle invocabili in questa sessione |

Gli altri 15 (`small-business` ×2, `brightdata-plugin`, `operations`,
`brand-voice`, `human-resources`, `engineering`, `bio-research`, `sales`,
`legal`, `product-management`, `marketing`, `enterprise-search`,
`customer-support`, `cowork-plugin-management`) non riguardano la
costruzione di siti.

---

## 3. MCP e strumenti esterni

| Capacità | Stato | Uso in Forge |
|---|---|---|
| **Vercel MCP** | connesso | deploy, log, build, protezione deployment |
| **GitHub MCP** | connesso (repo `demasiadowear/spectre`) | PR, branch, CI |
| **Canva MCP** (`generate-design`, `export-design`) | connesso ma **inutilizzabile** | Genera design su Canva, ma `canva.com` e `export-download.canva.com` rispondono **000** dal proxy: l'asset non è scaricabile. Non è una capacità di image generation utilizzabile da questa pipeline |
| **Bright Data** (plugin) | presente | scraping; non serve al design |
| **Notion** | richiede autorizzazione OAuth | non disponibile in sessione non interattiva |
| Google Drive / Calendar / Gmail / Hugging Face / Expedia / Motion | connessi | non pertinenti |

### 3.1 Image generation: NON disponibile

Nessuno strumento di generazione immagini raster è utilizzabile:
- non esiste una skill o un tool di image generation;
- Canva genera ma non consente il download (host bloccato);
- gli host di stock (`images.unsplash.com`) rispondono **000**.

**Conseguenza progettuale, non aggirabile:** il sito gold standard deve
reggere **senza una sola fotografia**. Non è un ripiego mascherato: è il
vincolo che ha determinato la direzione artistica, che è costruita su
tipografia, materia cromatica, texture disegnate in CSS/canvas e motion.
Evita per costruzione il cliché dello stock generico che la Fase 4 vieta.

---

## 4. Rete: cosa si raggiunge e cosa no

Misurato con `curl` attraverso il proxy dell'ambiente.

| Host | Codice | Conseguenza |
|---|---|---|
| `registry.npmjs.org` | **200** | **npm funziona**: librerie e font si installano |
| `fonts.googleapis.com` | 404 sulla radice (raggiungibile) | i font si potrebbero linkare, ma **non lo faccio**: vedi sotto |
| `cdnjs.cloudflare.com` | **000** | **niente CDN.** Le librerie vanno bundlate |
| `canva.com`, `export-download.canva.com` | **000** | asset Canva non scaricabili |
| `images.unsplash.com` | **000** | niente stock |
| siti di terzi (es. `www.ayromex.it`) | **000** (403 CONNECT) | nessun audit di siti pubblici reali |

**Font auto-ospitati, non da Google.** Anche se `fonts.googleapis.com`
risponde, li installo da npm (`@fontsource*`) e li servo dal progetto:
Chromium in headless non usa il proxy dell'ambiente, quindi un font
caricato da CDN sparirebbe proprio negli screenshot del QA. In più un
sito che non chiama Google a ogni visita è più veloce e più pulito lato
privacy — è la scelta giusta a prescindere dal vincolo.

---

## 5. Librerie npm (disponibili, NON skill)

Verificate con `npm view <pkg> version`:

| Pacchetto | Versione | Uso |
|---|---|---|
| `gsap` | 3.15.0 | timeline e ScrollTrigger |
| `three` | 0.186.0 | WebGL, **solo se guadagna il suo posto** |
| `lenis` | 1.0.42 | scroll smorzato |
| `@fontsource/*`, `@fontsource-variable/*` | 5.3.0 | font auto-ospitati |
| `vite` | ultima | build del progetto isolato |
| `playwright-core` + `@sparticuz/chromium` | già nel repo | QA visivo |

---

## 6. Browser, screenshot, QA visivo

| Capacità | Stato | Prova |
|---|---|---|
| Chromium | **presente** | `/opt/pw-browsers/chromium` → `chromium-1194/chrome-linux/chrome` |
| Playwright | **presente** | `playwright-core` già dipendenza del repo |
| Screenshot desktop/mobile | **funzionante** | già usato nella fase precedente (`scripts/factory-e2e/shots.mjs`) |
| Ispezione DOM a pagina viva | **funzionante** | overflow, contrasto, sezioni vuote, errori console |
| Lighthouse | **non installato** | `lighthouse` non è fra le dipendenze. Misuro a mano ciò che conta (peso bundle, peso immagini, FPS) invece di dichiarare punteggi non misurati |

---

## 7. La CLI `claude` in modalità non interattiva

Il dato che rende costruibile il runner della Fase 1.

```
$ /opt/claude-code/bin/claude -p "Rispondi solo: OK" --allowedTools ""
OK
$ echo $?
0
```

Funziona, eredita l'autenticazione dall'ambiente, e `--help` documenta
`--allowedTools`, `--add-dir`, `--append-system-prompt`, `--agents`,
`--background`, `--bare`, `--allow-dangerously-skip-permissions`.

**Ma non gira dentro una funzione serverless Vercel**: il binario pesa
218 MB, una lambda ha un tetto molto più basso, e una generazione
richiede minuti mentre la funzione ha un timeout in secondi. Serve un
worker separato.

---

## 8. Tabella riassuntiva richiesta dal brief

| Skill/capacità | Installata | Percorso | Uso in Forge |
|---|---|---|---|
| `artifact-design` | **sì** (nella CLI) | binario CLI, via `Skill` | **Autorità di design.** Letta per intero, applicata al piano e alla revisione anti-cliché |
| `dataviz` | sì (nella CLI) | binario CLI | Non usata: il soggetto non ha dati da visualizzare |
| `code-review` / `simplify` / `security-review` | sì (nella CLI) | binario CLI | Revisione del codice generato |
| `skill-creator` | sì | `~/.claude/skills/synced/…/skill-creator` | Eventuale skill Forge futura |
| `docx`/`pdf`/`pptx`/`xlsx`/`morning`/`import-memory` | sì | `~/.claude/skills/synced/…` | Non pertinenti |
| `session-start-hook` | sì | `~/.claude/skills/session-start-hook` | Non pertinente |
| Skill GSAP | **NO** | — | Uso la libreria npm, non una skill |
| Skill Three.js / WebGL | **NO** | — | Idem |
| Skill frontend design / motion / UI-UX / responsive / a11y / perf / SEO / copywriting / visual QA / browser testing | **NO** | — | Competenze mie, non pacchetti |
| Skill image generation | **NO** | — | Nessun percorso utilizzabile (§3.1) |
| Plugin `design` | sì ma non invocabile | catalogo plugin | Nessuna skill esposta in sessione |
| Canva MCP | sì, **inutilizzabile** | MCP | Asset non scaricabili (host bloccato) |
| Vercel MCP | sì | MCP | Deploy e log della preview |
| GitHub MCP | sì | MCP | Branch e PR |
| `gsap` | sì (npm) | `registry.npmjs.org` | Timeline, ScrollTrigger |
| `three` | sì (npm) | `registry.npmjs.org` | Solo se giustificato |
| `@fontsource*` | sì (npm) | `registry.npmjs.org` | Font auto-ospitati |
| Chromium + Playwright | sì | `/opt/pw-browsers/chromium` | Screenshot e ispezione |
| Lighthouse | **NO** | — | Misure manuali dichiarate come tali |
| CLI `claude -p` | **sì** | `/opt/claude-code/bin/claude` | Motore del runner premium |

### Le quattro categorie tenute separate

1. **Skill realmente installate**: le 8 su disco + quelle nella CLI (§1.2, §1.3).
2. **Librerie npm disponibili**: gsap, three, lenis, fontsource, vite (§5).
   Sono librerie, **non** skill: nessuna porta istruzioni di design.
3. **Capacità che conosco ma NON installate**: tutte le skill di §1.5.
4. **Integrazioni che richiedono credenziali**: Notion (OAuth mancante),
   Canva (connesso ma con asset non scaricabili), Vercel e GitHub
   (connessi e funzionanti).

---

## 9. Cosa ne consegue per il progetto

1. **Il sito deve reggere senza fotografie.** Non c'è modo di ottenerne.
   È il vincolo che ha guidato la direzione artistica.
2. **Niente CDN**: tutto bundlato da npm. Vale anche per i font.
3. **Niente Lighthouse**: misuro peso del bundle, peso degli asset e
   fluidità reale; non invento punteggi.
4. **Il runner è fattibile**, perché `claude -p` funziona; ma va fuori da
   Vercel.
5. **`artifact-design` è l'unica skill di design vera**, ed è stata usata
   sul serio: il suo elenco di cliché è diventato la lista di controllo
   della Fase 4, e la sua regola editoriale ("se una parte del piano
   somiglia al default, riscrivila") è stata applicata prima di scrivere
   codice.
