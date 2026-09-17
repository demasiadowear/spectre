# Camelia — direzione artistica

> Concept dimostrativo. Il salone non esiste: nessun indirizzo, nessun
> telefono, nessuna recensione, nessun premio, nessun prezzo, nessuna
> fotografia e nessun volto. La pagina lo dichiara con la pastiglia
> "Concept demo", fuori dalla composizione.

## Concept

**Uno specchio ad arco, e il colore che si sceglie.** Il nome sta dentro
l'arco, non accanto. E la palette non ha un accento fisso: ha una
variabile, `--nuance`, che chi guarda decide e che ridipinge arco,
capelli delle silhouette, bottoni e filetti.

## Mood, detto anche per negazione

Rivista di moda e laboratorio del colore. **Non** è la barberia in rosa:
non c'è verde smalto, non ci sono filetti d'ottone, non c'è un elenco
numerato, non c'è tipografia severa. Qui la geometria è fatta di archi e
raggi grandi, il ritmo è lento, e il pubblico guarda dal telefono.

Niente pastelli da centro estetico e niente oro.

## Palette

| Nome | Valore | Ruolo |
|---|---|---|
| cipria | `#EFE4EA` | il fondo |
| cipria cupa | `#E4D5DE` | la sezione dei look, le pastiglie a riposo |
| melanzana | `#251C26` | l'inchiostro, la sezione dei tempi, i bottoni |
| argento | `#B9AFBA` | il disco che si sovrappone all'arco |
| **nuance** | `#C1275B` di partenza | **variabile**: la sceglie chi guarda |

Le sei nuance sono ciliegia, rame, nocciola, biondo cenere, castano
freddo, nero seta.

## Tipografia

**Bodoni Moda Variable** in display, con l'asse `opsz` usato davvero:
`96` sul nome nell'arco, `72` sui titoli di sezione, `30` sui nomi dei
look, `24` sul marchio. È un didone — il carattere della moda — e non
somiglia né a Fraunces né a Bricolage né a Instrument Serif.

**Jost Variable** nel testo: geometrico, aperto, con l'asse `wght` da
400 a 500.

## Composizione e geometria

Spread di rivista: **asimmetrico**, arco a sinistra e testo a destra,
allineati sul centro. Un disco d'argento in `mix-blend-mode: multiply`
appoggiato sul bordo dell'arco — una sovrapposizione da stampa, che si
vede che è voluta.

Raggi grandi e asimmetrici ovunque: l'arco (`50% 50% 14px 14px / 62% 62%
8px 8px`), le pastiglie e i chip a 999px, il riquadro dell'esito con un
angolo vivo.

I cinque look sono **sfalsati** su tre altezze diverse: allineati sulla
stessa riga erano cinque card uguali, e una vetrina non è un listino.

Su telefono la vetrina diventa uno **scorrimento orizzontale con
aggancio**: è il gesto con cui si guardano le immagini sul telefono, e
cinque schede in colonna sarebbero una pila lunga il doppio della
pagina.

## Movimento

Lento, all'opposto degli altri due showcase: `expo.out` e `sine`, fra
1,2 e 2,2 secondi.

1. **L'apertura** — l'arco sale dal basso e si allarga (1,6 s), il nome
   emerge dopo (1,4 s), claim e CTA a scalare, il disco entra in 2,2 s.
2. **La nuance** — il colore scelto ridipinge la pagina con una
   dissolvenza di 0,9 s. Le transizioni stanno nel CSS, non nel
   JavaScript, così valgono anche se il modulo non parte.

Nessun movimento legato allo scroll, nessun elemento che fluttua da
solo.

## Immagini

Nessuna fotografia. Cinque silhouette piatte disegnate in SVG: spalle,
collo, testa, capelli. **Nessun volto** — niente occhi, niente bocca — e
il neutro della testa non è un incarnato ma un colore della palette
(`#DCCBD4`), perché una silhouette non deve assegnare una carnagione a
nessuno. I capelli prendono la nuance scelta.

## Conversione

Una CTA sola, ripetuta uguale: **Prenota un trattamento**. Il modulo non
è un elenco di campi: sono **chip** da toccare — che cosa, quando — più
il nome. Su telefono ogni chip è alto 48px.

Al posto dei prezzi, che sono vietati, c'è **quanto tempo serve**: è
l'informazione che serve davvero per organizzare la giornata, ed è vera
anche senza un listino.

## Skill usate

| Skill | Dove si vede |
|---|---|
| `frontend-design` | l'audacia spesa in un posto solo (l'arco); nessun occhiello, nessun punto mediano, nessuna freccia; il disco tolto da due a uno |
| `forge-creative-direction` | il fondo deciso per primo; la prima versione centrata bocciata guardando lo screenshot |
| `typography-editorial` | l'asse `opsz` impostato a quattro valori diversi secondo il corpo, scala in `clamp()` |
| `asset-art-direction` | nessuna foto, nessun volto, silhouette come sistema coerente |
| `gsap-motion-design` | due gesti, tempi lunghi, niente reveal allo scroll, transizioni nel CSS perché sopravvivano al JS |
| `threejs-webgl-direction` | non usato: nessuno dei quattro test lo giustificava per delle campiture piatte |
| `responsive-mobile-first` | vetrina a scorrimento con aggancio, chip da 48px, arco ridimensionato |
| `visual-qa` | tre cicli, screenshot guardati, difetti elencati qui sotto |
| `performance-accessibility` | contrasto minimo misurato, `:has(input:checked)` con focus visibile, stati senza JS e con movimento ridotto fotografati |
| `conversion-copy` | niente prezzi, niente superlativi, e una frase che dice apertamente che il colore sullo schermo non è il colore sui capelli |

## Difetti trovati guardando, e cosa è stato fatto

| Ciclo | Difetto | Correzione |
|---|---|---|
| 1 | Le silhouette non leggevano come capelli: senza spalle e senza collo erano forme astratte, e due sembravano lettere dell'alfabeto | Ridisegnate con spalle, collo, testa e capelli sopra |
| 1 | L'apertura era tutta centrata — arco, claim e CTA sullo stesso asse | Composizione asimmetrica: arco a sinistra, testo a destra |
| 1 | Cinque look identici in fila: kit di card | Sfalsati su tre altezze |
| 2 | Gli archi delle schede sparivano: `#E9DCE2` su `#E4D5DE` | Alzati a `#F7EFF3` |
| 2 | Lo chignon del raccolto era spezzato in due dal collo | Spostato di lato, disegnato dopo il collo |
| 2 | Nella frangia restava una riga chiara fra ciocca e testa | Ciocca estesa verso l'alto |
| 2 | Due dischi sospesi nel vuoto a destra: il tell della sfera che fluttua | Uno solo, appoggiato sul bordo dell'arco in `multiply` |
| 3 | Bob e frangia finivano con un bordo dritto sospeso sopra le spalle | Bordo inferiore arrotondato ed esteso fino alle spalle |

## Misure

Vedi `MISURE.md` nella radice di `forge-projects/`.

---

## Evoluzione: le silhouette e la prenotazione

Palette e cambio nuance erano approvati. Prenotazione e silhouette no.

| Cosa | Prima | Adesso |
|---|---|---|
| **Silhouette** | campiture piatte: leggevano come forme astratte | ogni taglio ha le sue **ciocche** in una tinta derivata dalla nuance (`color-mix`), la scriminatura e il disegno delle punte: caschetto a taglio netto, onde che seguono il profilo, frangia con le ciocche verticali, chignon con la spirale, lungo scalato con le punte a V |
| **Prenotazione** | un modulo lungo: due file di pastiglie più un campo bianco | **tre passaggi, uno alla volta** — trattamento, con chi, quando e contatto — con l'avanzamento a tre segmenti e i comandi Indietro/Avanti |
| **Selezione** | pastiglie e chip si somigliavano | una sola forma di scelta, e quella presa ha fondo pieno e segno di spunta |
| **Campi bianchi** | pastiglie bianche | campi con la sola riga sotto |
| **Seconda metà** | una colonna di campi | il **riepilogo ad arco** accanto ai passaggi: stessa forma dell'apertura, e dice sempre cosa si sta prenotando |
| **Testi secondari** | `#5A4C5B`, e opacità sul testo del riepilogo | `#4A3C4B`, e nessuna opacità: l'opacità era un modo caro di abbassare il contrasto senza accorgersene (Lighthouse accessibilità 96 → 100) |

Senza JavaScript i tre gruppi restano tutti visibili e il modulo si
compila di seguito: la logica dei passaggi vive nel JS, non nel CSS.
