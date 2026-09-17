---
name: asset-art-direction
description: Direzione degli asset visivi quando non esistono fotografie utilizzabili, che è il caso normale nella Factory. Usala quando un sito ha bisogno di immagini, quando valuti se usare una foto trovata online, quando pensi a stock o a immagini generate, e quando devi progettare un segnaposto. Copre la regola sulla licenza, gli host da bloccare e come reggere una pagina senza una sola foto.
---

# Asset visivi senza fotografie

Il caso normale nella Factory non è "quali foto uso": è **non ne ho
nessuna**. Nessuno strumento di generazione immagini utilizzabile, host
di stock irraggiungibili, e le foto del cliente non ce le ha dato
nessuno. Questa skill parte da lì.

Non è un ripiego mascherato. È il vincolo che fa la direzione: una
pagina che deve reggere senza foto è costretta a reggere sulla
tipografia, sul colore e sulla composizione, ed evita per costruzione lo
stock generico che fa sembrare un sito comprato a pacchetto.

## Due problemi diversi, spesso confusi

**Sicurezza.** Un URL immagine finisce in un attributo `src`. Schemi
come `javascript:`, `data:`, `vbscript:`, `file:` non passano mai. Il
controllo si fa sulla **stringa grezza prima di qualsiasi parsing**,
perché `new URL()` accetta `javascript:` senza battere ciglio. Niente
SVG da terzi: può contenere script, e un SVG ostile su un nostro dominio
è una falla.

**Licenza.** Un'immagine non è utilizzabile perché è raggiungibile.
- Le foto caricate dagli utenti nelle recensioni **non sono
  dell'attività**: vanno bloccate per host
  (`lh3..lh6.googleusercontent.com`, `streetviewpixels-pa.googleapis.com`,
  `maps.gstatic.com`, i CDN degli aggregatori tipo TripAdvisor e
  Deliveroo).
- Le foto del **sito ufficiale** del cliente si usano in una demo
  privata come riferimento, conservando la fonte.
- Tutto il resto no.

Filtro pratico: si accettano solo immagini il cui host è il dominio
ufficiale o un suo sottodominio. Un'immagine trovata altrove non ha una
licenza che possiamo vantare, e una demo con la foto sbagliata è peggio
di una con un segnaposto.

## Il segnaposto non deve sembrare un errore

Un riquadro vuoto con l'icona "immagine mancante" fa sembrare la pagina
rotta, che è peggio che non avere la foto. Il segnaposto deve leggersi
come un **elemento progettato**:

- un pannello con il monogramma dell'attività (iniziali) a corpo grande,
  in un gradiente costruito dalla palette della direzione;
- l'etichetta della categoria in basso, piccola;
- proporzioni decise, non un quadrato a caso;
- `role="img"` e `aria-label` col nome dell'attività, perché per un
  lettore di schermo è un'immagine a tutti gli effetti.

Non finge di essere una fotografia. Non deve.

## Cosa mettere al posto delle immagini

In ordine di resa rispetto al costo:

1. **Tipografia a scala grande.** Quasi sempre la cosa più memorabile
   della pagina. Vedi `typography-editorial`.
2. **Colore come materia.** Una vernice, uno smalto, una luce: un fondo
   che viene da qualcosa del mestiere.
3. **Texture disegnata in canvas.** Grana, rumore, imperfezione:
   `createImageData` con rumore costa ~8 KB di codice contro 300 KB di
   PNG, e non richiede rete.
4. **Forme SVG che siano struttura**, non ornamento. Vedi
   `gsap-motion-design`.
5. **Generativo con p5.js** — esiste una skill `algorithmic-art` che lo
   copre bene. Valutala solo se l'arte generativa **è** la direzione:
   p5 pesa circa 900 KB, e pagare quel peso per decorare è il contrario
   di quello che serve su un telefono.

## Se un giorno ci sarà generazione immagini

Le regole restano:
- coerenza con la direzione artistica, non "una bella immagine";
- **nessun volto**, nessun prodotto falso, nessun interno inventato che
  possa essere scambiato per una foto del locale: il cliente ne
  risponde, non noi;
- prompt e provenienza salvati accanto all'asset;
- versioni responsive e formati moderni;
- dichiarare che è un'immagine generata.

## Criteri di accettazione

- Ogni immagine pubblicata ha una fonte scritta.
- Nessun host di contenuti caricati dagli utenti.
- Nessuno schema pericoloso può arrivare a un `src`.
- L'assenza di immagini non ha bloccato la generazione.
- Il segnaposto è stato guardato in uno screenshot e non sembra un
  errore di caricamento.

## Errori da evitare

- Prendere una foto da Google Immagini "tanto è una demo".
- Usare le foto delle recensioni: sono dei recensori.
- Stock generico di persone sorridenti: è un tell da pagina comprata.
- Riempire il vuoto con un'immagine qualsiasi invece di comporre.
- Un `<img>` senza `alt`, o con `alt` uguale al nome del file.
