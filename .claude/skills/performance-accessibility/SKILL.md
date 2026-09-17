---
name: performance-accessibility
description: Prestazioni e accessibilità dei siti della Factory, misurate davvero e non dichiarate. Usala quando controlli il peso di una pagina, il bundle, i fotogrammi, il contrasto, la navigazione da tastiera o i lettori di schermo, e quando qualcuno chiede un punteggio Lighthouse. Contiene cosa misurare quando Lighthouse non è installato e il tetto di peso ragionevole per un sito di attività locale.
---

# Prestazioni e accessibilità

## Se Lighthouse non c'è, si dice

Non si inventano punteggi. Verifica con `npx lighthouse --version` o
guardando le dipendenze. Se non c'è, misura queste cose, che sono quelle
che contano davvero per una pagina di questo tipo, e dichiara che sono
misure diverse da un punteggio Lighthouse.

## Tetti per un sito di attività locale

| Voce | Ragionevole | Limite |
|---|---|---|
| JS del sito (gzip) | < 25 KB | 40 KB |
| Font (woff2, tutti) | < 120 KB | 200 KB |
| Peso totale prima interazione | < 250 KB | 400 KB |
| Fotogrammi desktop | 60 | ≥ 50 |
| Chunk WebGL, se c'è | separato e dinamico | mai nel bundle principale |

Riferimento reale: due famiglie variabili + GSAP con ScrollTrigger +
il codice del sito stanno in ~194 KB trasferiti, 19 KB gzip di JS
proprio. È un tetto raggiungibile, non teorico.

## Come si misurano

```js
// fotogrammi reali su un secondo
await page.evaluate(() => new Promise((done) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++;
    performance.now() - t0 < 1000
      ? requestAnimationFrame(tick)
      : done(Math.round(n * 1000 / (performance.now() - t0)));
  };
  requestAnimationFrame(tick);
}));
```

Il peso trasferito si somma dai `content-length` delle risposte. Il peso
del bundle si legge nell'output del bundler, e va guardato **per
chunk**: un chunk grande ma dinamico che non si carica non conta.

## Accessibilità: il minimo che non è negoziabile

- **Contrasto ≥ 4.5** per il testo corrente. Il testo "fioco" decorativo
  è la prima cosa che scende sotto soglia: `rgba(bianco, .30)` su fondo
  scuro non si legge su un telefono al sole.
- **Focus visibile**: `:focus-visible { outline: 2px solid …;
  outline-offset: 3px }`. Mai `outline: none` senza sostituto.
- **Skip link** verso il contenuto o il contatto.
- **Struttura vera**: un solo `h1`, sezioni con `aria-labelledby`
  agganciato al loro titolo, `<table>` con `<caption>` e `scope="row"`
  per una tabella di orari, `<address>` per l'indirizzo.
- **Segnaposto grafici** con `role="img"` e `aria-label`.
- **Icone decorative** con `aria-hidden="true"`.
- **`prefers-reduced-motion`** rispettato, e la pagina resta completa.

## Senza JavaScript

La pagina deve essere **completa e leggibile**. Non "degradata": se il
contenuto vive in un `opacity: 0` che aspetta un observer, senza JS la
pagina è bianca. Vedi `gsap-motion-design`.

Si verifica davvero, con il contesto del browser che ha JS disattivato,
non ragionando sul codice.

## Ordine di intervento quando si sfora

1. Togli una libreria. Sempre la prima mossa: Lenis, una libreria di
   icone, un polyfill. Quasi sempre ce n'è una che non serve.
2. Riduci i sottoinsiemi dei font: `vietnamese` e `cyrillic` su un sito
   italiano sono peso puro.
3. Rendi dinamico ciò che non serve alla prima videata.
4. Solo alla fine tocca le immagini — se ci sono, il che nella Factory è
   raro.

## Criteri di accettazione

- Peso dichiarato con i numeri, non "leggero".
- Fotogrammi misurati su entrambi i viewport.
- Contrasto minimo della pagina riportato, con quale elemento lo tiene.
- Stato senza JS e con movimento ridotto fotografati.
- Se Lighthouse manca, detto esplicitamente.

## Errori da evitare

- Riportare punteggi non misurati.
- Chiamare "ottimizzato" un sito perché usa font variabili.
- Contare il peso del chunk WebGL fra quelli caricati quando è dinamico,
  o al contrario dimenticarlo quando invece si carica.
- Togliere l'outline del focus perché "sporca".
- Considerare accessibile una pagina perché ha gli `alt`.
