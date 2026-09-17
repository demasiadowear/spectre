---
name: threejs-webgl-direction
description: Quando usare e soprattutto quando RIFIUTARE Three.js, WebGL, shader e 3D su un sito della Factory. Usala ogni volta che compare l'idea di aggiungere 3D, WebGL, uno shader, un canvas animato, particelle, un effetto vetro o "qualcosa di tridimensionale" a una pagina, e quando qualcuno chiede un sito "più premium" sottintendendo il 3D. Contiene i test di ammissione e la misura che ha bocciato una direzione creativa reale.
---

# WebGL: quasi sempre la risposta è no

Three.js è una libreria npm (`three@0.186.0`), non una skill. Il problema
non è saperla usare: è sapere quando **non** usarla.

Il modo più rapido per far sembrare generato un sito di un'attività
locale è metterci una sfera o un piano deformato che non c'entra niente
col mestiere. Il 3D non comunica "premium": comunica "chi l'ha fatto
aveva una libreria e l'ha usata".

## I quattro test di ammissione

Il WebGL entra solo se passa **tutti e quattro**. Uno solo che fallisce
e la risposta è no.

1. **Simula un materiale o un fenomeno reale del soggetto?**
   Lo specchio appannato di una barberia, l'acqua di una piscina, la
   fiamma di un forno a legna: cose che stanno in quella stanza.
   Una sfera iridescente, un blob, delle particelle fluttuanti: no.

2. **Regge a 60 fps su desktop?** Misurato, non sperato. Un fragment
   shader con fbm a quattro ottave su tutto lo schermo è pesante più di
   quanto sembri.

3. **Si legge come previsto?** Guarda lo screenshot. Un effetto di
   condensa può diventare una macchia marrone sfocata. Se l'effetto non
   si riconosce, non è un effetto: è sporco.

4. **Che succede a chi non lo vede?** Se lo escludi da telefono — ed è
   quasi sempre giusto escluderlo — metà del pubblico non vedrà mai
   l'idea. Se l'idea è il sito, il sito non esiste per loro.

## La prova che ha bocciato una direzione

Nel gold standard della Factory una delle tre direzioni era uno
**specchio appannato**: shader di condensa che si dirada dove passa il
dito. Passava il test 1 (lo specchio è un materiale vero della bottega) e
aveva una giustificazione onesta.

Misurata: **19 fps su desktop**. E nello screenshot la condensa si
leggeva come una macchia marrone sfocata, non come uno specchio. Su
telefono non si caricava affatto, per scelta.

Respinta. La misura ha deciso, non il gusto.

## Se passa tutti e quattro

Allora si fa, con queste condizioni:

- **import dinamico**, sempre: `const THREE = await import("three")`.
  Il chunk sono ~747 KB (192 KB gzip): non deve partire per chi non lo
  vedrà. Verifica nell'output del bundler che sia un chunk separato.
- **esclusione esplicita** prima dell'import, non dopo:
  ```js
  if (!supportaWebGL() || ridotto || piccolo) {
    document.documentElement.classList.add("senza-webgl");
  } else { /* import dinamico */ }
  ```
- **fallback progettato**, non degrado. La pagina senza WebGL non deve
  sembrare quella rotta: deve essere una versione che funziona.
- `setPixelRatio(Math.min(devicePixelRatio, 1.75))`: il ratio pieno su
  uno schermo retina quadruplica i pixel da calcolare.
- `prefers-reduced-motion` esclude il WebGL animato senza discussione.

## Alternative quasi sempre migliori

Prima di WebGL, considera in quest'ordine:

- **SVG animato** — una linea che si disegna con `strokeDashoffset` pesa
  zero e può essere struttura (vedi `gsap-motion-design`).
- **Canvas 2D** — grana, rumore, texture: un `createImageData` con
  rumore costa 8 KB di codice contro 300 KB di PNG, e non richiede rete.
- **CSS** — gradienti su misura, `mix-blend-mode`, maschere. Molto più
  di quanto si creda.
- **Tipografia** — quasi sempre la cosa più memorabile della pagina è il
  titolo, non l'effetto dietro.

## Criteri di accettazione

- I quattro test scritti, con l'esito di ciascuno.
- La misura dei fotogrammi allegata.
- Il chunk separato, verificato nell'output di build.
- Lo stato senza WebGL fotografato.

## Errori da evitare

- Aggiungere 3D per alzare la percezione di qualità.
- Import statico di `three`: entra nel bundle principale anche se non lo
  usi mai.
- Chiamare "fallback" una pagina che senza WebGL è vuota.
- Misurare i fotogrammi solo su desktop potente e dedurre il resto.
- Tenere una direzione perché ci hai lavorato: il costo affondato non è
  un argomento.
