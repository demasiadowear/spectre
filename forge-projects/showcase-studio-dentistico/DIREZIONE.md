# Studio Cardine — direzione artistica

> Concept dimostrativo. Lo studio non esiste: nessun indirizzo, nessun
> telefono, nessun medico, nessuna certificazione, nessun premio, nessun
> prezzo, nessuna fotografia di pazienti e nessun prima-e-dopo. La
> pagina lo dichiara con la pastiglia "Concept demo", fuori dalla
> composizione.

## Concept

**Un disegno tecnico.** Tavola squadrata, croci di registro, riga
graduata, richiami numerati, e in basso il **cartiglio** — che in un
disegno vero porta titolo e scala, e qui porta il titolo della pagina e
la richiesta di visita.

La precisione non si dichiara a parole: la fa il tratto.

## Mood, detto anche per negazione

Calmo, chiaro, misurato. **Non** è l'azzurro sanitario del template
medico, e **non** è il sito SaaS fatto di card tutte uguali: le due cose
che il brief vieta esplicitamente. Non c'è niente di rassicurante messo
lì per rassicurare — c'è una spiegazione di cosa succede, che è la cosa
che toglie davvero la paura.

## Palette

| Nome | Valore | Ruolo |
|---|---|---|
| porcellana | `#ECEEF1` | il fondo, freddo e chiaro |
| porcellana cupa | `#E1E5EA` | la sezione del percorso |
| bianco | `#FFFFFF` | la tavola e i riquadri |
| inchiostro | `#101418` | il tratto e il testo |
| grigio | `#505A66` | il testo secondario |
| indaco | `#22346E` | **l'unico colore**: compare dove serve capire qualcosa |

Un colore solo, e portante. Niente ciano medicale.

## Tipografia

**Instrument Serif** in display — condensato, ad alto contrasto, un peso
solo: elegante senza essere clinico. **Schibsted Grotesk Variable** nel
testo, con l'asse `wght` usato da 400 a 700.

È l'inverso della coppia del ristorante (lì sans in display e serif nel
testo) ed è un'altra famiglia rispetto alla barberia.

## Composizione e geometria

Densità **bassa**: molto respiro, una cosa per volta. Raggio 2px, tacche
di misura, croci di registro agli angoli della tavola. Nessun bordo
arrotondato morbido, nessuna ombra.

Il **percorso** è una linea verticale con cinque nodi numerati nel
margine: la sequenza si vede prima di leggerla. I numeri qui sono
legittimi perché il contenuto **è** una sequenza nel tempo — è la
condizione che `frontend-design` pone prima di usarli.

I trattamenti sono una **tabella**, non delle card. Su telefono la
tabella diventa un elenco, perché a 390px tre colonne si spezzano.

La pianta dello studio è una **griglia CSS di stanze**, non un disegno
con dentro il testo: dentro un SVG le etichette rimpiccioliscono col
disegno e a 390px diventavano illeggibili.

## Movimento

1. **La scansione** — al caricamento una riga indaco attraversa la
   tavola una volta sola, e i quattro richiami compaiono quando li
   supera. `power1.inOut`, 1,15 s, lineare e netta. Non si ripete.
2. **Aprire una tappa** — l'unica animazione legata a un gesto, e quella
   che aiuta davvero: mostra cosa succede, quanto dura e cosa si sente.

Gli stati iniziali li mette GSAP, mai il CSS: senza JavaScript i
richiami sono già al loro posto.

## Three.js: valutato e respinto

La prova sta in `prove/dente-3d.ts`, lo screenshot in
`prove-shots/dente-3d-desktop.png`.

| Test di `threejs-webgl-direction` | Esito |
|---|---|
| 1. Simula un materiale vero del soggetto? | **Sì.** Lo smalto è traslucido, e `MeshPhysicalMaterial` con `transmission` lo rende. È l'unica scusa seria per il 3D qui. |
| 2. Regge a 60 fps su desktop? | **No.** Misurato **1 fps** su desktop e 2 su telefono. La misura è su rasterizzatore software (SwiftShader in headless), quindi non è il numero che vedrebbe un utente; ma nella stessa condizione la prova 3D della barberia dava 33 fps, e questa scena — `transmission` più `clearcoat`, che costano un passaggio di render in più — è un ordine di grandezza più pesante. |
| 3. Si legge come previsto? | **No, e questo da solo basta.** Nello screenshot non si riconosce un dente: si vede un oggetto bianco di plastica con due bozze sopra un cono. Su un sito dentistico è peggio di niente. |
| 4. Chi non lo vede? | Su telefono andrebbe escluso, e il telefono è il pubblico. |

Respinto. Il disegno SVG passa dove il 3D fallisce: si riconosce in un
secondo, porta i richiami numerati — che sono il vero lavoro, spiegare —
pesa nulla e c'è anche senza JavaScript. `three` resta nelle dipendenze
solo per la prova e **non entra nel bundle del sito**.

## Immagini

Nessuna fotografia, nessun volto, nessun paziente, nessun prima-e-dopo.
Due disegni: la sezione del molare e la pianta delle stanze.

## Conversione

Una CTA sola, ripetuta uguale: **Richiedi una prima visita**. Sta nel
cartiglio della tavola (quindi nella prima videata, su desktop e su
telefono), nella testata, e come sezione finale su fondo indaco.

Il modulo chiede il minimo: nome, un recapito a scelta, quando le è
comodo, il motivo. Senza JavaScript resta leggibile e compilabile; con
JavaScript non parte nessuna richiesta, e lo dice.

## Skill usate

| Skill | Dove si vede |
|---|---|
| `frontend-design` | il numero usato solo dove c'è una sequenza vera; nessun occhiello, nessun monospazio "perché tecnico" — che qui era la tentazione più forte |
| `forge-creative-direction` | fondo deciso per primo; la direzione 3D uccisa con una misura e uno screenshot, non con una preferenza |
| `typography-editorial` | due famiglie con ruoli distinti, `tabular-nums` su durate e orari, riga sotto i 70 caratteri |
| `asset-art-direction` | nessuna foto; il disegno tecnico come sistema di immagini |
| `gsap-motion-design` | due gesti, offset da GSAP, nessun reveal allo scroll |
| `threejs-webgl-direction` | i quattro test eseguiti e scritti, con la misura allegata |
| `responsive-mobile-first` | tabella che diventa elenco, linea del percorso tolta sotto i 760px, skip link nascosto senza allargare il documento |
| `visual-qa` | tre cicli, screenshot guardati, difetti elencati qui sotto |
| `performance-accessibility` | contrasto minimo misurato, `<table>` con `<caption>` e `scope`, stati senza JS e con movimento ridotto fotografati |
| `conversion-copy` | niente superlativi, niente garanzie, lei per tutta la pagina |

## Difetti trovati guardando, e cosa è stato fatto

| Ciclo | Difetto | Correzione |
|---|---|---|
| 1 | Nella legenda il numero, la parola in neretto e il testo finivano in tre celle diverse: "Smalto." era buttato a destra | Il testo raccolto in un solo elemento, riga a due colonne vere |
| 1 | Scorrimento orizzontale di 27px su telefono | Skip link e intestazione di tabella nascosti con la tecnica giusta, non con `left:-9999px` |
| 1 | Le sotto-etichette della pianta si scontravano | La pianta rifatta in griglia CSS, con testo vero |
| 1 | Grigio del testo secondario a 4,63 di contrasto: sopra soglia ma tirato | Scurito a `#505A66`, contrasto minimo 5,54 |
| 2 | Il disegno prendeva tutta la prima videata e titolo e CTA finivano sotto la piega | Altezza massima del disegno a 44vh |
| 2 | Il dente non leggeva come molare: corona più alta che larga, leggeva come un arco | Corona allargata con le cuspidi, radici allungate, camera pulpare e canali ridisegnati |
| 3 | I richiami puntavano in punti sbagliati (il 3 alla gengiva, il 2 nel vuoto) | Linee di richiamo rifatte sulle parti giuste |

## Misure

Vedi `MISURE.md` nella radice di `forge-projects/`.
