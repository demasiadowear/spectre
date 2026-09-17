---
name: responsive-mobile-first
description: Responsive e qualità sul telefono per i siti della Factory. Usala quando imposti i breakpoint, quando una pagina va controllata a 390px, quando decidi cosa togliere dal telefono, e quando compaiono scorrimento orizzontale, testo tagliato o bersagli di tocco troppo piccoli. Contiene le misure minime dei tocchi e le regole su cosa nascondere e cosa non nascondere mai.
---

# Telefono

Per un'attività locale il telefono **è** il pubblico: chi cerca un
barbiere lo cerca dal cellulare, in strada. Il desktop è dove lo guardi
tu mentre lo costruisci. Non confondere i due.

## Bersagli di tocco

Qualsiasi cosa si tocchi: **almeno 44px di altezza**, anche se il testo
è piccolo.

Il caso che sfugge sempre è il numero di telefono nella testata: è
un'etichetta da 11px che però è un link, e a 18px di altezza è
inutilizzabile con un pollice.

```css
@media (max-width: 760px) {
  .tel-testata {
    display: inline-flex; align-items: center;
    min-height: 44px; padding-left: 8px;
  }
}
```

La CTA principale su telefono va a `width: 100%` e `min-height: 48px`.

## Cosa togliere

- **La navigazione**, se la pagina è corta. Quattro voci in una pagina
  da quattro sezioni sono ingombro: si scorre più in fretta di quanto si
  legga un menu.
- **Gli elementi decorativi che richiedono spazio orizzontale** (linee
  di riempimento fra due testi, colonne affiancate).
- **Il WebGL**, quasi sempre: vedi `threejs-webgl-direction`.
- **I titoli appiccicati** (`position: sticky`): rubano altezza utile.

## Cosa non togliere mai

- Un contatto.
- Una riga della tabella degli orari.
- Il testo di una sezione.

Se una cosa non serve sul telefono, quasi sempre non serve nemmeno sul
desktop: toglila da entrambi invece di nasconderla con una media query.

## Le tre cause dello scorrimento orizzontale

1. Un `min-width` più largo dello schermo.
2. Una colonna di griglia senza minimo a zero: usa `minmax(0, 7fr)`, non
   `7fr`, altrimenti una tabella o una parola lunga allarga tutto.
3. Un elemento posizionato che esce dal viewport senza essere `fixed`.

Si trova misurando a pagina viva, non leggendo il CSS:

```js
document.documentElement.scrollWidth > document.documentElement.clientWidth
```

E si elencano i colpevoli con `getBoundingClientRect()` su `body *`,
saltando i `position: fixed`.

## Breakpoint

Due bastano quasi sempre: uno per la griglia editoriale (~860px) e uno
per il telefono (~760px). Fra i due, `clamp()` fa il resto senza
breakpoint. Un sito di quattro sezioni non ha bisogno di cinque soglie.

Usa `100svh` e non `100vh`: su iOS la barra dell'indirizzo mangia
`100vh` e la prima videata esce tagliata.

## Misure di controllo

Il viewport di riferimento è **390×844** con `deviceScaleFactor: 2`
(iPhone recenti). Su quello si giudica.

Cosa guardare nello screenshot a pagina intera, non nei numeri:
- le voci di un elenco sono allineate fra loro?
- il piede è leggibile o è troppo fioco?
- la CTA si vede senza scorrere oltre la prima schermata?
- il titolo va a capo in un punto sensato?

## Criteri di accettazione

- Nessuno scorrimento orizzontale a 390px.
- Nessun testo tagliato (`scrollWidth > clientWidth` su nessun elemento).
- Ogni bersaglio di tocco ≥ 44px.
- Screenshot mobile a pagina intera guardato, non solo prodotto.
- Nulla di informativo nascosto da una media query.

## Errori da evitare

- Progettare a 1440px e controllare il telefono alla fine.
- Nascondere contenuto con `display: none` invece di ripensarlo.
- `100vh` su iOS.
- Fidarsi di un controllo automatico che non vede il disallineamento:
  un elemento spostato di 14px non è "nascosto", ma nello screenshot
  l'elenco esce a scalini.
