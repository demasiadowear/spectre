---
name: gsap-motion-design
description: Come animare un sito della Factory con GSAP e ScrollTrigger senza rompere la leggibilità. Usala quando aggiungi animazioni, transizioni, reveal allo scroll, timeline di apertura o effetti di movimento a una pagina web, quando qualcuno chiede "un po' di movimento" o "che si animi scorrendo", e quando devi decidere quante animazioni mettere. Contiene il difetto yPercent che rende un titolo invisibile per sempre e la regola che vieta di parcheggiare il contenuto.
---

# Movimento con GSAP

GSAP è una libreria npm, non una skill del sistema: si installa
(`gsap@3.15.0`) e si impacchetta col sito. Qui c'è come usarla senza
fare danni.

## Quanto movimento

Due gesti orchestrati, non dieci effetti. `frontend-design` lo dice in
generale: *"fade-and-slide-up entrances on each section and hover
transitions on every card are the generic default and read as
AI-generated"*. In pratica, per un sito di attività locale:

1. **una timeline di apertura**, che parte da sola al caricamento;
2. **un gesto legato allo scroll**, che sia struttura e non decorazione —
   una linea che si disegna, un elemento che accompagna la lettura.

Tutto il resto è rumore. Un'animazione in più non rende un sito più
curato: lo fa sembrare generato.

## La regola che conta più di tutte

**Il movimento legato allo scroll non deve mai spostare né nascondere il
contenuto.**

Un `gsap.from(el, { opacity: 0, scrollTrigger: {...} })` parcheggia
l'elemento a zero finché l'observer non scatta. Sembra innocuo finché
non consideri chi:

- apre un link con un'ancora a metà pagina;
- vede l'anteprima di un link condiviso;
- guarda una miniatura generata automaticamente;
- ha JavaScript lento e scorre prima che parta;
- riceve uno screenshot a pagina intera.

Tutti costoro vedono una pagina vuota o disallineata. Lo stesso vale per
`x` e `y`: un `from({ x: -14 })` lascia gli elementi sotto la piega
spostati di 14px, e in uno screenshot l'elenco esce a scalini. Questo non
lo cattura nessun controllo automatico sull'opacità: si vede solo
guardando.

Cosa resta lecito allo scroll: animare **proprietà di elementi
decorativi** che non contengono testo (una linea che si disegna con
`strokeDashoffset`, un riempimento che cresce). Se un elemento porta
parole, quelle parole devono essere già lì.

## Il difetto che rende invisibile un titolo

Questo costa mezz'ora se non lo sai, e non dà nessun errore.

```css
/* SBAGLIATO */
.riga span { transform: translateY(100%); }
```
```js
gsap.to(".riga span", { yPercent: 0 });   // non muove niente
```

`getComputedStyle` risolve `translateY(100%)` in **pixel**: GSAP legge
la matrice e memorizza `y: 173.9`, non `yPercent: 100`. Animare
`yPercent` da 0 a 0 non cambia nulla, e il testo resta fuori vista per
sempre, in silenzio.

```js
/* GIUSTO: l'offset lo mette GSAP, non il CSS */
gsap.set(".riga span", { yPercent: 100 });
gsap.to(".riga span", { yPercent: 0, duration: 1, stagger: 0.08 });
```

Questo è anche il modo **migliore** a prescindere dal difetto: se il
JavaScript non parte, senza offset nel CSS la pagina resta leggibile.
Lo stato a riposo di una pagina è quello senza JS, e deve essere
completo.

## prefers-reduced-motion

Si legge una volta e si rami­fica presto:

```js
const ridotto = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (!ridotto) { /* tutti gli offset e le timeline */ }
```

Con il movimento ridotto **non** serve un ramo che "rimette a posto"
qualcosa: se gli offset li mette solo GSAP nel ramo animato, la pagina è
già al suo posto. Un ramo `else` pieno di `gsap.set(...)` è il segnale
che il CSS sta nascondendo qualcosa che non dovrebbe.

Metti anche `scroll-behavior: auto` dentro la media query: uno scroll
smorzato è movimento quanto un'animazione.

## ScrollTrigger

- `scrub` per legare il progresso allo scroll (una linea che si disegna);
  un valore basso (0.4-0.8) smorza senza sembrare in ritardo.
- `start: "top 88%"` è ragionevole per un ingresso; sopra il 90% scatta
  troppo tardi su schermi bassi.
- Il trigger di un'animazione a scorrimento su tutta la pagina è
  `document.body` con `start: "top top"`, `end: "bottom bottom"`.
- Registra il plugin una volta: `gsap.registerPlugin(ScrollTrigger)`.

## Peso

GSAP core + ScrollTrigger sono circa 46 KB minificati, 19 KB gzip, se
bundlati. È accettabile per due gesti. Non lo è per due gesti più otto
reveal: a quel punto stai pagando un peso per peggiorare la pagina.

Niente CDN: la libreria viaggia col bundle. Un CDN aggiunge una
dipendenza di rete a runtime e, negli ambienti chiusi, semplicemente non
carica.

## Criteri di accettazione

- Screenshot a pagina intera: nessun testo invisibile, nessuno scalino.
- Con `prefers-reduced-motion` la pagina è completa e ferma.
- Con JavaScript disattivato la pagina è completa.
- Fotogrammi misurati, non supposti: sotto i 50 fps su desktop c'è un
  problema.
- Le animazioni sono due, e sai dire cosa raccontano.

## Errori da evitare

- Mettere gli offset iniziali nel CSS.
- Un reveal per ogni sezione.
- Hover che spostano le card.
- Usare lo scroll smorzato (Lenis) "perché è premium": aggiunge peso e
  toglie il controllo a chi usa la rotella. Serve solo se il gesto della
  pagina lo richiede davvero.
- Dichiarare fluide animazioni che non hai misurato.
