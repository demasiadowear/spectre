# Grecale — storyboard e mappa delle conversioni

> Documento scritto **prima** del codice. Il lavoro è fermo in attesa
> delle fotografie: nessuna delle dieci scene del manifest esiste.

## Cosa resta della direzione attuale

Non si butta via tutto. Il terracotta, l'oliva e i sei motivi di maiolica
restano, ma cambiano ruolo: da **contenuto** diventano **sistema
grafico** che lega le fotografie — filetti fra le sezioni, il timbro
sulla targa del nome, il motivo sotto i numeri. La fotografia porta il
calore, la maiolica porta l'identità.

Quello che sparisce: la scena della sala disegnata in SVG (la sostituisce
una fotografia vera), le filigrane dei motivi dietro il testo, e il muro
di dieci piastrelle in apertura, che diventa una fascia sola sopra la
fotografia.

## Storyboard

Undici blocchi. Accanto a ciascuno: cosa deve fare, che immagini usa, e
che cosa è marcato `demoOnly`.

| # | Blocco | Cosa deve fare | Immagini | demoOnly |
|---|---|---|---|---|
| 1 | **Apertura** | Far venire voglia in tre secondi. Fotografia a tutto schermo della sala di sera, velo scuro dal basso, claim emozionale sopra, nome in targa di maiolica. | `hero-sala-verticale` (telefono), `hero-sala-orizzontale` (desktop) | — |
| 2 | **Prova, sopra la piega** | Dare fiducia prima dello scroll: valutazione, numero di recensioni, una riga di riconoscimento. Marcata a vista come esempio. | — | ✔ valutazione, conteggio |
| 3 | **Barra fissa** | CHIAMA · WHATSAPP sempre a portata di pollice, da subito su telefono. Non compone e non invia: apre una scheda che dice che è una dimostrazione. | — | ✔ recapiti |
| 4 | **La cucina** | Racconto breve, tre frasi, prima persona. Due fotografie: il forno acceso e le mani che fanno le orecchiette. | `forno-fuoco`, `mani-orecchiette` | — |
| 5 | **I piatti** | Desiderio. Quattro fotografie grandi in griglia sfalsata, nome del piatto sotto. Su telefono scorrono col pollice. | `piatto-orecchiette`, `piatto-agnello`, `piatto-polpo`, `piatto-fichi` | ✔ nomi dei piatti |
| 6 | **La carta** | Selettiva: quattro portate, non un menu infinito. Elenco editoriale, nessun prezzo. Un rimando: «la carta cambia ogni settimana». | — | ✔ piatti |
| 7 | **La materia** | Territorio. Due primi piani a tutta forza — grano arso e olio nuovo — con due paragrafi corti. | `materia-grano-arso`, `materia-olio-nuovo` | — |
| 8 | **La sala** | Atmosfera. Una fotografia molto larga della tavolata apparecchiata, testo sotto, orari accanto. | `sala-tavolata` | ✔ orari |
| 9 | **Recensioni** | Prova sociale estesa, **isolata in un riquadro con etichetta visibile** e attributo `data-demo` nel DOM. Tre voci brevi, iniziali al posto dei nomi. | — | ✔ tutto il blocco |
| 10 | **Dove e quando** | Posizione (mappa **non** interattiva, disegnata), orari, e il modulo di prenotazione: giorno, coperti, orario, nome. | — | ✔ indirizzo, orari |
| 11 | **Chiusura** | Una CTA sola, grande, su campo terracotta pieno: «Prenota un tavolo». Sotto, il piede. | — | — |

### Ordine e ragione

L'ordine è: **desiderio → fiducia → dettaglio → azione**. La prova sta in
alto perché è lì che decide chi non vi conosce; i piatti stanno prima
della carta perché si guarda prima di leggere; la prenotazione sta in
fondo e in barra fissa, così è raggiungibile da qualunque punto.

## Mappa delle conversioni

Una sola azione: **prenotare un tavolo**. Tre strade, e nessuna spedisce
niente davvero.

| Punto | Comando | Cosa succede | Sempre raggiungibile |
|---|---|---|---|
| Apertura | `Prenota un tavolo` (pieno) | porta al modulo del blocco 10 | prima videata |
| Apertura | `Scrivici` (contorno) | apre la scheda "è una dimostrazione" | prima videata |
| Barra fissa telefono | `CHIAMA` · `WHATSAPP` | apre la scheda "è una dimostrazione" | da 0 a fondo pagina |
| Testata desktop | `Prenota` | porta al modulo | sempre, testata appiccicata |
| Fine blocco piatti | `Prenota un tavolo` | porta al modulo | a metà pagina |
| Blocco 10 | modulo: giorno, coperti, orario, nome | messaggio in linea: la richiesta non parte | — |
| Chiusura | `Prenota un tavolo` | porta al modulo | ultima videata |

Ogni comando che finge un contatto apre la stessa scheda, con lo stesso
testo. Non si inventa un numero di telefono: la barra dice CHIAMA ma non
porta un `tel:`, perché un numero inventato su una pagina apribile da
chiunque è esattamente la cosa che il brief vieta.

## Separazione strutturale

Tre insiemi, e si vedono anche nel DOM.

```
contenuti/
  verified.json    → vuoto. L'attività non esiste, quindi non c'è niente di verificato.
  demo.json        → recensioni, valutazione, orari, indirizzo, recapiti, piatti
  asset-manifest.json → le immagini, con synthetic: true/false per ciascuna
```

Regole che un test dovrà far rispettare:

1. Ogni nodo che rende un valore da `demo.json` porta `data-demo`.
2. Nessun `data-demo` compare dentro `<script type="application/ld+json">`
   — e infatti non c'è nessun JSON-LD.
3. Il blocco recensioni ha un'etichetta visibile, non solo l'attributo.
4. La nota di chi pubblica elenca: attività inventata, immagini generate,
   recensioni di esempio.
5. Nessun `href="tel:"` e nessun `href="https://wa.me/"` in pagina.

## Vincoli tecnici che non si toccano

| Vincolo | Come lo tengo |
|---|---|
| CLS < 0,05 | `width`/`height` su ogni `<img>`, `aspect-ratio` in CSS, font precaricati con nomi stabili (già fatto) |
| Performance mobile ≥ 90 | hero in `preload` + `fetchpriority=high`, tutto il resto `loading=lazy`; AVIF con WebP di ripiego; peso immagini sotto 2,0 MB |
| Accessibilità 100 | `alt` descrittivo su ogni fotografia, contrasto ≥ 4,5 sul testo sopra le immagini garantito dal velo, focus visibile |
| Niente `opacity:0` senza JavaScript | nessun reveal allo scroll sul testo; gli stati iniziali li mette GSAP, mai il CSS |
| Massimo 3 famiglie di movimento | 1. **apertura** (velo che si alza, claim che sale); 2. **parallasse leggera** sulle fotografie grandi, solo desktop, solo `transform`; 3. **risposta al tocco** (apertura portata, invio modulo, scheda demo) |
| Nessun CDN nell'autonomo | le immagini entrano nel file autonomo come data URI: va verificato che il peso resti gestibile, altrimenti l'autonomo userà tagli più piccoli |

### Nota sul file autonomo

Dieci fotografie in base64 dentro un solo HTML pesano circa 1,35× il peso
dei file (≈1,8 MB). Sommate ai font (136 KB) e a GSAP, il file autonomo
supererebbe i 2 MB. Se è un problema, l'autonomo userà tagli a metà
risoluzione: lo decido quando vedo le immagini vere, non prima.
