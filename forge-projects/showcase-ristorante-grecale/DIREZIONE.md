# Grecale — direzione artistica

> Concept dimostrativo. L'attività non esiste: nessun indirizzo, nessun
> telefono, nessuna recensione, nessun premio, nessun prezzo. La pagina
> lo dichiara con la pastiglia "Concept demo", fuori dalla composizione.

## Concept

**La pagina è un muro di maioliche posate sull'argilla.** Ogni contenuto
sta dentro una piastrella, e la composizione nasce dai moduli quadrati,
non da sezioni impilate a tutta larghezza.

## Mood, detto anche per negazione

Terra, forno, ceramica. Di paese, non da guida. Non è nostalgia — non ci
sono corsivi, non c'è "la tradizione di una volta". È una cucina che
parte dalla materia e la dice per nome.

## Palette

| Nome | Valore | Ruolo |
|---|---|---|
| terra | `#A93D24` | il campo: l'argilla su cui sono posate le piastrelle |
| terra cupa | `#8F2F1B` | la sezione della prenotazione |
| calce | `#F6EFE1` | lo smalto delle piastrelle, e il testo sul campo |
| oliva | `#4C5E2A` | i motivi dipinti e le piastrelle piene |
| grano arso | `#2A1C14` | l'inchiostro, la CTA, la sezione della materia |

Il terracotta è il **campo**, non l'accento. È la differenza fra questa
pagina e il cliché "fondo crema con un tocco di terracotta" che
`frontend-design` elenca per primo fra i tell.

## Tipografia

**Bricolage Grotesque Variable** in display (assi `wdth` e `wght`) e
**Newsreader Variable** nel testo. È la coppia **invertita** rispetto
alla barberia: lì serif in display e sans nel testo, qui il contrario.

L'asse `wdth` lavora davvero: `74` sul nome dell'insegna (stretto, alto,
dipinto), `104` sulle etichette piccole (largo, leggibile).

## Composizione e geometria

Griglia di sei moduli quadrati su desktop, tre su telefono. Le
piastrelle hanno rotazioni fra 0,4 e 1,2 gradi — posate a mano, non
stampate. Bordi spessi di smalto, raggio zero, nessuna ombra grigia
uguale sotto ogni blocco.

Il nome sta dentro una piastrella-insegna con la **rosa dei venti**
dipinta sopra: il grecale è un vento di nord-est, e il disegno dice il
nome invece di riempire un vuoto.

## Movimento

1. **Imbandire** — al caricamento le piastrelle si posano a scalare dal
   centro verso i bordi, `back.out(1.5)`, 0,62 s, stagger 45 ms. È il
   gesto di chi apparecchia.
2. **Girare la piastrella** — aprire una portata gira il modulo su se
   stesso e lo rimette giù. Mezzo giro e ritorno, quindi il contenuto
   resta nel flusso: senza JavaScript il `<details>` continua ad aprirsi
   da solo.

Nessun movimento legato allo scroll. Niente parte a opacità zero in
attesa di un observer.

## Immagini

Nessuna fotografia. Sei motivi di maiolica disegnati a mano in SVG
(stella, onda, fiore, reticolo, cerchi, foglia d'ulivo), riusati per
riferimento nelle piastrelle, più una grana di semola generata in canvas
e passata al CSS come data URI: 8 KB di codice invece di un PNG di
sfondo, e se il JavaScript non parte la pagina resta identica meno la
grana.

## Conversione

Una CTA sola, ripetuta uguale: **Prenota un tavolo**. La sezione della
prenotazione sta subito sotto l'apertura, prima della carta, perché
prenotare è il lavoro della pagina. Il modulo è un `<form>` vero e senza
JavaScript resta leggibile e compilabile; con JavaScript non parte
nessuna richiesta, e lo dice.

## Skill usate

| Skill | Dove si vede |
|---|---|
| `frontend-design` | verifica dei tell: nessun occhiello maiuscolo, nessun punto mediano, nessuna freccia nei bottoni, nessuna card uguale con la stessa ombra |
| `forge-creative-direction` | il fondo deciso per primo (il terracotta come campo), la direzione difesa con una prova e non con una preferenza |
| `typography-editorial` | assi variabili impostati, scala in `clamp()`, `minmax(0,1fr)` ovunque, accentate verificate sullo screenshot |
| `asset-art-direction` | nessuna foto: motivi SVG e grana in canvas |
| `gsap-motion-design` | due gesti e basta, offset messi da GSAP e non dal CSS, niente reveal allo scroll |
| `threejs-webgl-direction` | non usato: nessuno dei quattro test lo giustificava per un muro di piastrelle |
| `responsive-mobile-first` | a tre colonne quattro piastrelle escono per non lasciare righe smontate; CTA a tutta larghezza |
| `visual-qa` | tre cicli, screenshot guardati, difetti elencati qui sotto |
| `performance-accessibility` | peso dichiarato, contrasto minimo misurato, stati senza JS e con movimento ridotto fotografati |
| `conversion-copy` | nessun prezzo, nessun superlativo, nessuna frase da elenco dei tradimenti |

## Difetti trovati guardando, e cosa è stato fatto

| Ciclo | Difetto | Correzione |
|---|---|---|
| 1 | La piastrella del nome era un rettangolo scuro con la parola al centro: leggeva come un segnaposto | Insegna in calce con la parola a sinistra e la rosa dei venti dipinta sopra |
| 1 | La CTA in terracotta cupo su campo terracotta non si staccava | Portata a grano arso |
| 1 | Aprendo una portata la colonna accanto restava corta e lasciava un buco di argilla | La portata aperta si distende su tutta la larghezza |
| 1 | La didascalia degli orari era oliva su terracotta: illeggibile | Portata dentro il pannello chiaro |
| 1 | "La materia" erano quattro riquadri identici in fila, cioè il kit di card | Moduli di larghezza diversa, 4-2-2-4 su sei colonne |
| 2 | Su telefono il muro aveva righe da una piastrella sola: sembrava smontato | Quattro piastrelle escono sotto i 720px |
| 2 | Il nome su telefono era la cosa più piccola della prima videata | Altezza minima sulla piastrella e corpo alzato a 20vw |
| 2 | Il campo sopra la parola restava vuoto anche su desktop | La rosa dei venti lo riempie e dice da dove viene il nome |

## Misure

Vedi `MISURE.md` nella radice di `forge-projects/`.

---

## Revisione: da "menu digitale" a pagina composta

La prima consegna era stata giudicata quasi approvata, ma «troppo
composta da rettangoli, sembra un menu digitale». Sei correzioni.

| Cosa | Prima | Adesso |
|---|---|---|
| **Ordine** | prenotazione subito sotto l'apertura | apertura → carta → materia → sala → prenotazione. Prima si fa venire voglia, poi si chiede |
| **Box e bordi** | ogni cosa dentro una piastrella con doppio bordo di smalto | la piastrella resta **solo** nel muro dell'apertura. Carta, materia, sala e modulo vivono sul campo d'argilla, separati da filetti |
| **Wordmark** | la parola in grassetto condensato dentro un riquadro | targa di maiolica: bordo smerlato disegnato a mano, lettere in rilievo d'oliva, filetto doppio tirato a mano, rosa dei venti come sigillo nell'angolo |
| **Sezione dominante** | non c'era | **la sala disegnata**: tre volte, le lampade accese, la tavolata apparecchiata con i piatti di maiolica. Su telefono si ritaglia invece di rimpicciolirsi, così si vede da vicino |
| **La materia** | quattro riquadri identici in fila | quattro composizioni: nome in display grande, testo in colonna stretta, il motivo come filigrana, voci alternate da un lato all'altro |
| **Testo su telefono** | corpo 17px, interlinea 1,58 | corpo 18px, interlinea 1,66, descrizioni 17,5px |

Il modulo di prenotazione ha perso il pannello chiaro: campi con la sola
riga sotto, sul campo d'argilla.
