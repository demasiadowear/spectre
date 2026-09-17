---
name: visual-qa
description: Ciclo di controllo visivo per i siti della Factory: costruisci, fotografa, GUARDA, correggi, rifotografa. Usala ogni volta che hai finito o modificato una pagina web, quando qualcuno chiede se un sito è pronto, quando vuoi sapere se sembra un template, e prima di consegnare qualsiasi cosa di visuale. Contiene cosa misurare a pagina viva, i falsi positivi dell'auditor automatico e i difetti che solo l'occhio trova.
---

# QA visivo

Regola prima di tutte: **le misure non bastano**. Nel gold standard
della Factory l'auditor automatico dava **zero problemi** mentre la
pagina ne aveva quattro, fra cui un banner di sviluppo interno stampato
in mezzo alla pagina mostrata al cliente. Nessun controllo automatico lo
avrebbe mai trovato.

Il ciclo è: costruisci → fotografa → **apri lo screenshot e guardalo** →
elenca i difetti → correggi → rifotografa. Almeno tre giri. Se dopo il
terzo giro non trovi più niente, è probabile che tu abbia smesso di
guardare.

## Cosa misurare a pagina viva

Con Chromium headless, su desktop 1440×900 e telefono 390×844:

| Misura | Come | Soglia |
|---|---|---|
| Scorrimento orizzontale | `scrollWidth > clientWidth` | mai |
| Elementi fuori viewport | `getBoundingClientRect()` su `body *`, saltando i `fixed` | nessuno |
| Testo tagliato | `el.scrollWidth > el.clientWidth + 2` | nessuno |
| Sezioni vuote | testo della sezione ≈ testo del suo titolo | nessuna |
| Testo invisibile a riposo | `opacity < 0.05` con altezza > 0 | nessuno |
| Contrasto | rapporto WCAG testo/fondo | ≥ 4.5 |
| Bersaglio di tocco | altezza della CTA su mobile | ≥ 44px |
| Fotogrammi | conteggio di `requestAnimationFrame` su 1s | ≥ 50 su desktop |
| Errori console e richieste fallite | listener su `console` e `requestfailed` | zero |
| Peso trasferito | somma dei `content-length` | dichiarato |

## I falsi positivi che rovinano il segnale

Un auditor rumoroso è peggio di nessun auditor: nasconde i difetti veri.
Tre filtri obbligatori sul contrasto:

1. **Elemento con sfondo proprio** (una CTA, uno skip link): va
   confrontato col **suo** sfondo, non con quello del `body`. Senza
   questo filtro una CTA perfettamente leggibile risulta a contrasto 1.
2. **Elemento senza testo**: un contenitore che contiene solo spazi non
   va misurato.
3. **Elemento fuori schermo**: lo skip link a `left: -9999px` non si
   misura.

## I difetti che solo l'occhio trova

Elenco costruito su difetti veri, trovati guardando dopo che le misure
avevano dato via libera:

- **Riferimenti interni sulla pagina del cliente.** Un banner di
  sviluppo, un'etichetta di debug, il nome dello strumento. Se il layout
  radice dell'applicazione ne monta uno, finisce anche sulle pagine
  pubbliche.
- **Testo di riempimento che nessuno ha guardato.** "È presente sul
  territorio, contattaci per informazioni" mentre i dati verificati
  contenevano una descrizione vera e migliore.
- **Convenzioni non tradotte.** `00:00 - 00:00` è il modo in cui i CMS
  scrivono *chiuso*: stamparlo come orario fa sembrare il locale aperto
  a mezzanotte.
- **Ripetizioni.** Il nome dell'attività stampato due volte di fila, come
  `h1` e come sottotitolo.
- **Vuoti enormi fra le sezioni.** La pagina è stirata, non composta.
- **La metà bassa che è una pila piatta**, tutta allineata allo stesso
  margine.
- **Elementi ridondanti.** Una linea animata dello stesso colore del
  bordo che già c'è: l'animazione non si vede e l'elemento è peso morto.
- **Segnaposto che sembrano errori.** Vedi `asset-art-direction`.
- **Piede troppo fioco per essere letto.**

## Gli stati da fotografare, non solo la pagina

Una pagina ha almeno quattro stati, e tre si dimenticano sempre:

1. desktop e telefono, a pagina intera;
2. **con `prefers-reduced-motion: reduce`** — deve essere completa e
   ferma, non mutilata;
3. **senza JavaScript** — deve essere completa e leggibile;
4. a metà scroll, se ci sono animazioni legate allo scorrimento: è lo
   stato in cui i difetti di "contenuto parcheggiato" si vedono.

## La domanda finale

Guarda la pagina e chiediti, in questo ordine:

1. Sembra **progettata** o **generata**?
2. Potrei consegnare questa stessa pagina a un altro cliente della
   stessa categoria cambiando solo i testi? Se sì, è un tema, non un
   sito.
3. Qual è la cosa che ricorderò fra un'ora? Se non c'è, manca il punto
   di forza.
4. Cosa toglierei? (Ce n'è sempre una.)

Se sembra un template, **rifallo**. Non annotare "da migliorare".

## Criteri di accettazione

- Tre cicli completi, con gli screenshot di ognuno conservati.
- Un elenco scritto dei difetti per ciclo, e cosa è stato fatto.
- I quattro stati fotografati.
- Zero problemi automatici **e** una critica scritta a mano.

## Errori da evitare

- Dichiarare "0 problemi" citando solo l'auditor.
- Produrre gli screenshot e non aprirli.
- Correggere un difetto e non rifotografare.
- Chiamare originale un lavoro senza la verifica dei tell di
  `frontend-design`.
- Inventare punteggi Lighthouse: se non è installato, si dice.
