# Misure — i quattro siti della Factory

Tutte prese sulla `dist/` servita da un server statico locale, con il
Chromium dell'immagine. Nessun numero è stimato.

## Lighthouse 13.4.1

| Sito | | Performance | Accessibilità | Best practices | CLS | LCP | TBT |
|---|---|---|---|---|---|---|---|
| **Barberia Centrale** | desktop | 100 | 100 | 100 | 0 | 0,4 s | 0 ms |
| | mobile | 100 | 100 | 100 | 0 | 1,6 s | 20 ms |
| **Grecale** | desktop | 100 | 100 | 100 | 0 | 0,5 s | 0 ms |
| | mobile | 98 | 100 | 100 | 0 | 2,2 s | 50 ms |
| **Studio Cardine** | desktop | 100 | 100 | 100 | 0 | 0,5 s | 0 ms |
| | mobile | 99 | 100 | 100 | 0 | 1,9 s | 0 ms |
| **Camelia** | desktop | 100 | 100 | 100 | 0 | 0,4 s | 0 ms |
| | mobile | 99 | 100 | 100 | 0 | 1,9 s | 0 ms |

Soglie richieste: performance ≥ 90, accessibilità ≥ 95, best practices
≥ 95, CLS < 0,1. Tutte rispettate su tutti e quattro, su entrambi i
viewport.

La categoria **SEO non è riportata** perché i quattro siti sono
`noindex` per scelta: il punteggio sarebbe basso per una ragione voluta,
e riportarlo come difetto o "aggiustarlo" sarebbe falsificarlo.

## Peso e fotogrammi

| Sito | Trasferito | JS del sito | CSS | Font (woff2) | FPS desktop | FPS mobile | File autonomo |
|---|---|---|---|---|---|---|---|
| Barberia Centrale | ~204 KB | 73 KB | 10 KB | 132 KB | 61 | 60 | 283 KB |
| Grecale | ~236 KB | 73 KB | 12 KB | 136 KB | 61 | 61 | 280 KB |
| Studio Cardine | ~166 KB | 72 KB | 13 KB | 68 KB | 61 | 62 | 188 KB |
| Camelia | ~172 KB | 73 KB | 11 KB | 73 KB | 62 | 62 | 196 KB |

Il JS è quasi tutto GSAP (46 KB minificati, 19 KB gzip); il codice
proprio di ciascun sito sta sotto i 5 KB.

Il chunk di `three` nello Studio Cardine — **747 KB**, 192 KB gzip —
esiste solo per la pagina di prova `prove/dente-3d.html` e **non entra
nel bundle del sito**: verificato nell'output del bundler, dove compare
come chunk separato caricato solo da quella pagina.

## Audit a pagina viva

Zero problemi su tutti e quattro, su desktop e telefono: nessuno
scorrimento orizzontale, nessun testo troncato, nessuna sezione vuota,
nessun testo invisibile a riposo, nessun errore in console, nessuna
richiesta fallita.

| Sito | Contrasto minimo | Su cosa | CTA (mobile) |
|---|---|---|---|
| Barberia Centrale | 6,72 | "Oggi, giovedì" | 346×56 px, contrasto 13,2 |
| Grecale | 5,43 | "Grecale" (insegna) | 358×66 px, contrasto 14,4 |
| Studio Cardine | 6,48 | intro del percorso | 354×64 px, contrasto 10,1 |
| Camelia | 5,34 | "Camelia" nell'arco | 351×61 px, contrasto 12,6 |

## Stati fotografati

Per ciascun sito, in `shots-finale/`, `shots-nojs/`, `shots-reduced/`:

- desktop 1440×900 e telefono 390×844, a pagina intera;
- in `videate-finale/`, i **ritagli a dimensione reale**: prima videata
  mobile, sezione centrale mobile, conversione mobile, prima videata
  desktop. Sono quelli su cui si giudica: una pagina intera rimpicciolita
  nasconde proprio il corpo del testo e il peso dei bordi;
- **senza JavaScript**: tutti e quattro restano completi e leggibili. I
  `<details>` si aprono da soli, i moduli sono compilabili, il disegno
  del dente e le silhouette ci sono, il rasoio è aperto. Manca solo la
  grana di semola del ristorante, che è un asset generato;
- **con `prefers-reduced-motion: reduce`**: pagina completa e ferma, zero
  problemi.

Nell'esecuzione senza JavaScript lo Studio Cardine segnala due richieste
fallite: è il polyfill dei `modulepreload`, bloccato perché gli script
sono disattivati. È l'effetto del test, non un difetto della pagina.

## Video

`video/animazioni-1440x900.webm` in ciascun progetto: apertura, scroll
lento fino in fondo, il gesto interattivo del sito (aprire una portata,
aprire una tappa del percorso, cambiare nuance), ritorno su.

Non c'è `ffmpeg` nell'immagine, quindi il formato è webm così come lo
produce Chromium: nessuna conversione, nessun ricampionamento.

## Three.js

Valutato una volta sola, per lo Studio Cardine, dove aveva l'unica scusa
seria (lo smalto traslucido). Respinto: **1 fps** su desktop e 2 su
telefono sul rasterizzatore software di headless — contro i 33 fps della
prova 3D della barberia nella stessa condizione — e, cosa che decide da
sola, nello screenshot non si riconosce un dente. Dettagli e immagini in
`showcase-studio-dentistico/DIREZIONE.md` e in `prove-shots/`.

## Test anti-omologazione

`tests/factory/creative-diversity.test.ts`, 14 controlli, tutti verdi.
Vedi `MATRICE-CREATIVA.md` per l'esito letto dimensione per dimensione.
