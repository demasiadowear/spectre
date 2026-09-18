# Richiesta di chiarimento — Google Maps Platform, Place Photos

**Stato: DA INVIARE. Non è stata inviata e non è stata autorizzata.**

Finché non arriva una risposta scritta, la modalità descritta qui sotto
**non va definita «conforme»** in nessun documento, commento, commit o
conversazione. È una lettura nostra, e le letture nostre non sono
autorizzazioni.

---

## Perché esiste questa richiesta

Il sistema vorrebbe sottoporre le fotografie di un Place a un modello
multimodale per decidere **quali mostrare, in che ordine e con quale
ritaglio** — cioè per non far classificare a mano dieci fotografie per
ogni attività.

Leggendo i Google Maps Platform Terms of Service, §3.2.3(c):

> **No Creating Content From Google Maps Content.** Customer will not
> create content based on Google Maps Content. For example, Customer
> will not: […] (v) construct an index of tree locations within a city
> from Street View imagery; […] or (vii) use Google Maps Content to
> improve machine learning and artificial intelligence models,
> including to train, test, validate or fine-tune the models.

L'esempio (v) è strutturalmente la stessa operazione di «costruire un
indice di soggetti e marchi rilevati a partire dalle fotografie di un
Place». Per questo il sistema **non conserva** nulla di semantico
derivato da quelle immagini.

La clausola (vii) non sembra applicabile: riguarda addestrare, testare,
validare o affinare un modello, e qui si tratta di sola inferenza.

I *Maps Service Specific Terms*, che contengono le eccezioni per le
Place Photos, non sono stati consultati: la pagina non è raggiungibile
dall'ambiente in cui il sistema è stato sviluppato. Nessuna eccezione è
stata assunta, in nessuna direzione.

---

## Testo da inviare

> Does Google Maps Platform permit a Customer Application to submit
> individual Place Photos, retrieved on demand and never cached or
> stored, to a multimodal model solely to select display order,
> responsive crop and layout for that same place inside the Customer
> Application?
>
> No image bytes, OCR, descriptions, embeddings, classifications or
> other semantic metadata would be retained. The application would
> retain only the Place Photo reference already needed for display, its
> position in the layout and the required Google Maps/author
> attribution.
>
> Would this use violate Section 3.2.3(c), "No Creating Content From
> Google Maps Content"? If permitted, may the layout decision be
> retained for the lifetime of the Place Photo reference?

---

## Cosa fa il sistema nel frattempo

Due regimi distinti, non un unico manifest trattato allo stesso modo.

### A — `provider_rendered` (Google Places)

L'analisi, se avviene, sta **in memoria** e dura una generazione.
Sopravvive soltanto la decisione di impaginazione:

| Si conserva | Non si conserva |
|---|---|
| indice della fotografia nel manifest | descrizioni prodotte dal modello |
| ordine in pagina | OCR |
| ruolo di layout | soggetti rilevati |
| `object-position` per il ritaglio | marchi rilevati |
| autore e attribuzione | palette |
| riferimento del provider (serve a mostrarla) | punteggi visivi |
| | motivazioni derivate dall'immagine |
| | embedding o hash visivi |

Il **perché** di una scelta non si salva. Sembra una perdita, ed è la
riga che tiene separata una decisione di impaginazione da un indice di
contenuti.

### B — `customer_owned` (materiale autorizzato dal cliente)

Non è Google Maps Content: analisi, OCR, logo, palette, punteggi,
ritagli, deduplicazione, persistenza e riuso sono tutti abilitati.

---

## Identità visiva

Un logo **non diventa persistibile** perché è stato letto in una
fotografia di Places. Un'insegna vista lì può servire in memoria come
*segnale* per cercare lo stesso marchio altrove, e l'OCR si butta
subito.

Diventa persistibile solo se ritrovato e verificato su: sito ufficiale,
social `confirmed`, fonte pubblica indipendente con diritti compatibili,
o materiale fornito dal cliente. Altrimenti `brand_status:
INCONCLUSIVE`, e il nome si compone tipograficamente — senza chiamarlo
logo.
