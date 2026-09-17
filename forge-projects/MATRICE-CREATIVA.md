# Matrice creativa — test di diversità della Premium Website Factory

Scritta **prima** di qualunque riga di codice, come impone
`forge-creative-direction`: tre direzioni che si confrontano, non tre
varianti di una.

La Barberia Centrale è in tabella come **colonna di controllo**: è il
benchmark approvato, e serve a misurare la distanza. Se una colonna
nuova le somiglia, va riprogettata prima di costruire.

---

## Matrice

| Dimensione | **Barberia** (controllo) | **Ristorante** | **Dentista** | **Beauty/Hair** |
|---|---|---|---|---|
| **Pubblico** | uomini, quartiere, decisione rapida | chi sceglie stasera dove mangiare | adulto che rimanda per timore | donna che sceglie con l'occhio, da telefono |
| **Obiettivo** | far telefonare | far prenotare un tavolo | far chiedere la prima visita | far prenotare un trattamento |
| **Identità** | bottega, mestiere, mano ferma | terra, forno, ceramica | strumento di precisione, stanza chiara | rivista di moda, laboratorio del colore |
| **Direzione artistica** | smalto verde scuro, editoriale severo | **campo terracotta**, maiolica, alta saturazione | **porcellana fredda**, disegno tecnico, molto bianco | **cipria e lacca**, editoriale fashion, duotone |
| **Layout** | due colonne editoriali, filetti sottili | **mosaico di piastrelle quadrate**, moduli ruotati | **colonna misurata + margine di annotazioni**, percorso verticale | **spread di rivista**, blocchi a tutta pagina sfalsati, sovrapposizioni |
| **Geometria** | raggio 0, filetti 1px, ortogonale | raggio 0, bordi spessi, rotazioni di 0,4°—1,2° | raggio 2px, tacche di misura, croci di registro | raggi grandi e asimmetrici, archi, forme a goccia |
| **Tipografia** | Fraunces (serif display) + Instrument Sans | **Bricolage Grotesque** (sans display, asse `wdth` da 74 a 104) + **Newsreader** (serif testo, asse `wght`) — coppia **invertita** | **Instrument Serif** (display condensato, un peso) + **Schibsted Grotesk** (testo, asse `wght`) | **Bodoni Moda** (didone, asse `opsz` a quattro valori) + **Jost** (geometrico) |
| **Palette** | `#0D2E26` verde smalto, osso, ottone | `#A93D24` terracotta, `#F6EFE1` calce, `#4C5E2A` oliva, `#2A1C14` grano arso | `#ECEEF1` porcellana, `#101418` inchiostro, `#22346E` indaco, bianco puro | `#EEDCE6` cipria, **`--nuance`** variabile (sei valori), `#251C26` melanzana, `#B9AFBA` argento |
| **Densità** | media, righe fitte | **alta**: moduli pieni, poco vuoto | **bassa**: molto respiro, una cosa per volta | **media-alta a blocchi**, vuoti grandi fra blocchi pieni |
| **Visual anchor** | rasoio SVG che si apre | **muro di maioliche** disegnate a mano (SVG), con la rosa dei venti sull'insegna | **sezione del molare** in disegno tecnico, con quattro richiami numerati | **arco-specchio** col nome dentro, e le silhouette che prendono la nuance |
| **Movimento** | apertura del rasoio + tratto che si disegna | **imbandire**: le piastrelle si posano a scalare, rimbalzo corto | **scansione**: una riga indaco attraversa la sezione una volta sola, netta | **deriva**: forme che respirano lente, dissolvenze lunghe |
| **Easing / durata** | `power3.out`, 0,9—1,25 s | `back.out(1.4)`, 0,45—0,7 s, stagger fitto | `power1.inOut`, 0,5 s, lineare e corta | `sine.inOut` / `expo.out`, 1,4—2,2 s |
| **Interazione memorabile** | nessuna (solo scroll) | **apri la portata**: la piastrella gira e scopre i piatti | **apri la tappa del percorso**: cosa succede, quanto dura, cosa si sente | **scegli la nuance**: il colore scelto ridipinge la pagina |
| **Sistema di immagini** | nessuna immagine, solo tipografia e un oggetto | sei motivi di maiolica in SVG + grana di semola in canvas | tratto tecnico 1,6px e pianta in griglia CSS; nessuna foto, nessun volto | cinque silhouette piatte senza volto, il neutro non è un incarnato |
| **Ordine delle sezioni** | `apertura → lavoro → orari → dove` | `muro-sez → tavolo → carta → materia → sala` | `tavola-sez → percorso → trattamenti → studio → visita` | `specchio → look → colore → tempi → poltrona` |
| **CTA** | Chiama per l'appuntamento (tel) | **Prenota un tavolo** (pannello con data, coperti, orario) | **Richiedi una prima visita** (modulo breve: nome, quando) | **Prenota un trattamento** (scelta servizio + fascia) |
| **Tono del copy** | asciutto, di bottega | concreto, si parla di ingredienti e di fuoco | calmo, spiega, dà del lei, niente superlativi | breve, sicuro, presente indicativo, ritmo da didascalia |

---

## Verifica prima di costruire

`forge-creative-direction`: *"Se cambiando la palette le tre diventano la
stessa pagina, non hai fatto tre direzioni."* Controllo colonna contro
colonna, sulle dimensioni che non sono il colore:

- **Ristorante vs Dentista** — mosaico quadrato contro colonna con
  margine di annotazioni; densità alta contro densità bassa; sans
  display + serif testo contro serif display + sans testo; rimbalzo
  corto contro scansione lineare. Restano diversi anche in bianco e nero.
- **Ristorante vs Beauty** — entrambi hanno colore forte. Si separano
  sulla geometria (quadrati ruotati contro archi e raggi grandi) e sul
  tempo del movimento (0,5 s scattanti contro 2 s lenti). In scala di
  grigi il mosaico e lo spread restano riconoscibili.
- **Dentista vs Beauty** — precisione contro morbidezza: è l'opposizione
  più netta delle tre.
- **Ristorante vs Barberia** — il rischio vero era rifare la bottega con
  un'altra insegna. Separati dal fondo (campo saturo contro scuro), dal
  layout (mosaico contro due colonne) e dalla coppia tipografica
  invertita.

## Cliché da non toccare (elenco di `frontend-design`)

| Tell | Ristorante | Dentista | Beauty |
|---|---|---|---|
| fondo crema + serif + terracotta d'accento | il terracotta è il **campo**, non l'accento; il display è un grotesque | assente | assente |
| near-black + un acido | assente | assente | assente |
| broadsheet con filetti e zero raggio | no: bordi spessi e moduli | no: tacche di misura, non filetti | no: campiture piene |
| kit di card SaaS | le piastrelle hanno dimensioni diverse e nessuna ombra grigia | vietato per brief | i blocchi sono a tutta larghezza, non card |
| occhiello maiuscolo spaziato | mai | mai | mai |
| stringhe col punto mediano | mai | mai | mai |
| `PAROLA — frammento` | trattino lungo solo negli intervalli | idem | idem |
| near-black tinto al posto del nero | grano arso `#2A1C14` è un marrone dichiarato | inchiostro `#101418` | melanzana `#251C26` |
| monospazio per le etichette | no | no (tentazione forte: è uno studio "tecnico") | no |
| `→` in coda ai bottoni | mai | mai | mai |
| elenchi numerati 01/02/03 | no: le portate non sono una sequenza | **sì, ma legittimo**: il percorso di cura È una sequenza nel tempo | no |

## Three.js

Valutato per lo **studio dentistico**, l'unico dei tre dove avrebbe una
scusa (un dente in tre dimensioni). Esito e misure in
`showcase-studio-dentistico/DIREZIONE.md`, con gli screenshot in
`showcase-studio-dentistico/prove-shots/`.


---

## Esito, misurato

`tests/factory/creative-diversity.test.ts` confronta i quattro siti a
partire dai file sorgente. Quattordici controlli, tutti verdi:

| Controllo | Esito |
|---|---|
| Famiglie di caratteri in comune | nessuna, su tutte e sei le coppie |
| Colori di palette in comune | nessuno |
| Distanza fra i campi di fondo | la minore separa di 111° di tinta (porcellana contro cipria) |
| Sequenza delle sezioni | diversa, e al massimo un nome in comune per coppia |
| Vocabolario delle classi (Jaccard) | sotto il 20% su ogni coppia |
| Curve del movimento | `power3` / `back` / `power1` / `expo`+`sine`: nessuna coppia oltre il 50% |
| Famiglia dei raggi | 40px, 0px, 2px, 999px — rapporto ≥ 2 su ogni coppia |
| Oggetto identitario | `.rasoio`, `.muro`, `.sezione`, `.arco`, e nessuno riusa quello di un altro |
| CTA | quattro etichette diverse, nessuna generica |
| Densità di testo per sezione | scarto ≥ 1,5× fra il più fitto e il più arioso |
| Frasi da pagina generata | nessuna |
| Dati di contatto inventati nei tre showcase | nessuno: niente `tel:`, niente `<address>`, niente Maps, nessun prezzo |
| Pastiglia "Concept demo" e `noindex` | presenti su tutti e quattro |
| Contenuto parcheggiato allo scroll | nessun `gsap.from` legato a uno ScrollTrigger |

### Tre difetti che il test ha trovato, e cosa è stato corretto

Il test non è stato scritto per confermare il lavoro: la prima
esecuzione ne ha bocciati tre.

1. **Fondi troppo vicini.** Dentista `#ECEEF1` e beauty `#EFE4EA`
   distavano 13 su 255 in RGB: due neutri chiarissimi, cioè lo stesso
   tema ridipinto. Il campo del beauty è stato portato a `#EEDCE6`, un
   rosa che si legge come colore. In più la misura è stata rifatta in
   tinta-saturazione-chiarezza, perché la distanza RGB fra due colori
   chiari non dice niente.
2. **Sezioni riusate.** Ristorante e beauty avevano entrambi `apertura`
   e `prenota`. Rinominate secondo il linguaggio di ciascun sito:
   `muro-sez`/`tavolo` e `specchio`/`poltrona`. Le sezioni della
   barberia non sono state toccate.
3. **Stessa famiglia di raggi.** Tre siti su quattro davano 40px: era la
   pastiglia "Concept demo", che è chrome dello strumento ed è uguale su
   tutti per scelta. L'estrattore ora la esclude, e i raggi veri sono
   0 / 2 / 40 / 999.

### Confronto visivo

`confronto/quattro-siti.png`: le quattro prime videate a 1280×800
affiancate, e sotto le quattro pagine intere in scala.
