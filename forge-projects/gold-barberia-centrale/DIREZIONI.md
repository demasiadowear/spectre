# Tre direzioni artistiche, e perché ha vinto la seconda

> Costruite tutte e tre e fotografate, non descritte a parole.
> Screenshot in `shots-concept/`.

Vincolo che ha determinato tutto: **nessuna fotografia disponibile**.
Nessuno strumento di image generation utilizzabile, host di stock
bloccati (vedi `docs/CLAUDE_PREMIUM_FACTORY_CAPABILITIES.md` §3.1). Le
tre direzioni dovevano quindi reggere su tipografia, colore, materia e
movimento. È un vincolo, ma tiene alla larga per costruzione dallo stock
generico che il brief vieta.

---

## A — "Insegna smaltata"

| | |
|---|---|
| **Concept** | La targa smaltata del negozio diventa la pagina intera |
| **Mood** | Bottega di città, artigiano, niente nostalgia americana |
| **Palette** | Verde smalto `#0E3B2E`, osso `#EDE6D6`, ottone `#B08D4F` |
| **Tipografia** | Archivo Black enorme + Fraunces per i dati |
| **Composizione** | Nome fuori scala che esce dal bordo; rail verticale con l'indirizzo inciso; bulloni d'ottone |
| **Animazione** | La vernice che "prende": le lettere salgono da sotto, il filetto si stende |
| **Interazione** | Nessuna: è un oggetto, non uno strumento |
| **Tecnologia** | CSS + GSAP. Grana disegnata su canvas (8 KB invece di una texture da 300 KB) |
| **Vantaggi** | Identità immediata, materiale, specifica del mestiere italiano. Il gioco pieno/contorno sulle due righe è una vera idea tipografica |
| **Rischi** | Calcata diventa pastiche retrò. E soprattutto: è **un blocco da una schermata** — riempie la prima videata e non ha dove svilupparsi scorrendo |

## B — "Il gesto" · **SCELTA**

| | |
|---|---|
| **Concept** | Una sola linea continua, l'arco che il rasoio percorre. Il contenuto ci si appende |
| **Mood** | Editoriale, asciutto, sicuro di sé |
| **Palette** | Fondo `#0F1411` (nero con deriva verde), osso `#F4F1EA`, acciaio `#8FA0A9`, ottone per i segni piccoli |
| **Tipografia** | Fraunces variabile (WONK attivo) a 9,5rem + Instrument Sans |
| **Composizione** | Asimmetrica, colonna stretta fuori asse, griglia editoriale titolo/contenuto |
| **Animazione** | La linea si disegna col rotolo; le righe del titolo salgono all'apertura |
| **Interazione** | **"Aperto adesso"** calcolato dagli orari verificati |
| **Tecnologia** | CSS + GSAP + ScrollTrigger + SVG. Nessun WebGL |
| **Vantaggi** | L'idea sta nella **tipografia e nelle parole**, non in un effetto: regge lo scroll. La linea diventa struttura informativa, non ornamento |
| **Rischi** | La linea può far sembrare il sito il portfolio di uno studio. Mitigato dal copy, che è di bottega: *"Una passata sola, fatta come si deve"* |

## C — "Specchio appannato" · **RESPINTA**

| | |
|---|---|
| **Concept** | Lo specchio velato dal vapore dell'asciugamano caldo, che si pulisce col dito |
| **Palette** | Tungsteno `#E9C892` su piastrella `#17110D` |
| **Tecnologia** | Three.js, shader di condensa con fbm |
| **Perché era difendibile** | Il WebGL simulava un **materiale vero della stanza**, non una forma astratta |
| **Perché è respinta** | **Misurata: 19 fps su desktop.** E visivamente la condensa si legge come una macchia marrone sfocata, non come uno specchio. Su telefono non si carica nemmeno (scelta giusta), quindi metà del pubblico non vedrebbe l'idea. È esattamente la trappola del brief: 3D perché "fa premium" |

---

## Decisione

**B**, con un prestito da A: il fondo passa dal nero neutro a un nero
con deriva verde presa dallo smalto dell'insegna, e l'ottone resta per i
segni piccoli. Non è indecisione: `artifact-design` elenca *"near-black
with a lone acid-green or vermilion pop"* fra i cliché da evitare, e un
nero neutro si legge come non scelto. Il verde lega il sito a **questa**
bottega invece che a un generico sito editoriale scuro.

## Divieti della Fase 4 — verifica

| Cliché vietato | Presente? |
|---|---|
| gradienti viola/blu | no |
| glassmorphism | no |
| griglie di card uguali | no — i servizi sono un elenco editoriale, non card |
| icone fluttuanti, orb luminosi | no |
| tutto centrato | no — impaginazione asimmetrica su due colonne |
| hero titolo + sottotitolo + due pulsanti | no — una frase sola e una CTA sola |
| statistiche inventate | no — 4,8/143 è il dato Google verificato |
| "esperienze uniche", "soluzioni su misura" | no |
| stock photo generiche | no — nessuna fotografia |
| animazioni per fare scena | due gesti in tutto: apertura e spina |
| layout identico cambiando palette | no |
| eccesso di bordi arrotondati | raggio 2px sulla sola CTA |
| estetica da dashboard SaaS | no |
