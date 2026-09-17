# LCP mobile — breakdown, causa, interventi, limite

Condizioni, identiche in tutte le misure: 1638,4 Kbps, RTT 150 ms,
rallentamento CPU 4×, viewport 390×844 DPR 2. Sono i parametri che
Lighthouse usa per il profilo mobile.

## 1. Le quattro fasi

L'elemento LCP **non e la fotografia**: e
`main#contenuto > section.apertura-foto > div.apertura-dire > p.claim`,
un paragrafo di testo di 374×77 px.

| fase | valore |
|---|---|
| Time to first byte | 14 ms |
| Resource load delay | — |
| Resource load duration | — |
| Element render delay | 119 ms |

Le due fasi centrali non esistono, e non perche non siano state
misurate: un elemento di testo non ha una risorsa da scaricare, quindi
non ha ne un ritardo di partenza ne una durata di scaricamento. Questo
da solo esclude che il problema sia il peso delle immagini, la scelta
dello srcset, il formato o la priorita di caricamento della hero.

TTFB 14 ms esclude il server.

## 2. Perche l'elemento LCP e un paragrafo e non la hero

La fotografia di apertura e 390×844, undici volte piu grande del
paragrafo, ed e scaricata a 52 ms. Non diventa mai candidata LCP
perche l'animazione d'ingresso la dipinge la prima volta a opacita 0:
un elemento a opacita 0 non e un candidato, e le variazioni di opacita
successive sono animazioni di composizione che non generano un nuovo
candidato.

Misurato: durante l'intero caricamento si registra **un solo candidato
LCP**, `P.claim`. La hero non compare mai nell'elenco.

## 3. Causa reale

`LCP = TTI = 2,8 s`, e le due quantita restano uguale a ogni misura.
Il modello di Lighthouse (Lantern) non misura l'LCP di un elemento di
testo: lo stima a partire da quando il thread principale si libera. Il
thread principale e occupato dal bundle JavaScript, rallentato 4×.

La causa e **il costo di CPU del bundle**, non la rete e non le
immagini.

Prove, ognuna ottenuta cambiando una cosa sola:

| intervento | FCP | LCP | cosa dimostra |
|---|---|---|---|
| partenza | 1,7 s | 3,2 s | — |
| font sottoinsiemati (−36 KB) | 0,9 s | 3,0 s | il font sposta FCP, non LCP |
| `fetchpriority=low` sul bundle | 0,9 s | 3,0 s | non e contesa di banda |
| movimento ridotto forzato | 0,9 s | 3,0 s | **non e l'animazione** |
| ScrollTrigger fuori da mobile (−44 KB) | 0,9 s | 2,8 s | e il bundle |

La terza riga e la piu importante: disattivando del tutto l'animazione
d'apertura l'LCP non si muove. L'animazione decide *quale* elemento sia
l'LCP, non *quando* avvenga.

## 4. Misura reale, non simulata

Con strozzatura vera via CDP (stessi identici parametri) e l'ultimo
candidato letto da `PerformanceObserver`:

| | FCP | LCP |
|---|---|---|
| normale | 1108 ms | **1108 ms** |
| movimento ridotto | 1096 ms | 1096 ms |
| senza il bundle | 936 ms | 936 ms |

Il bundle costa 172 ms; l'animazione non costa niente. La distanza fra
2800 ms stimati e 1108 ms misurati e il margine del modello di
Lighthouse su un LCP di testo, non un comportamento del sito.

Questo non e un argomento sulle "connessioni vere": e la stessa
strozzatura, applicata davvero invece che modellata.

## 5. Interventi applicati

Tutti verificati a resa **identica al pixel** (0 byte di differenza
sugli screenshot hero desktop e prima videata mobile).

1. **Font sottoinsiemati ai 161 caratteri della pagina.** 133,0 → 97,0 KB.
   Le sorgenti sono bloccate per checksum: il primo tentativo aveva
   sottoinsiemato Bricolage dal file con asse di peso invece che da
   quello con asse di larghezza, stesso carattere ma metriche diverse,
   e il tasto della hero passava da 226 a 232 px. Il controllo di
   checksum esiste perche quell'errore non si ripeta.
2. **`fetchpriority=low` sul bundle.** Non cambia l'ordine di
   esecuzione, sposta il bundle dietro font e fotografia nella coda di
   rete. FCP 1,7 → 0,9 s.
3. **ScrollTrigger caricato solo su desktop.** La parallasse gira solo
   da 900 px in su: su telefono il plugin veniva scaricato e compilato
   senza eseguire una riga. Ora e un chunk separato che il telefono non
   richiede. Verificato: desktop parallasse attiva, mobile nessuna
   richiesta del chunk e nessuna parallasse, come prima.

Risultato: **perf mobile 92 → 96, LCP 3,2 → 2,8 s, peso iniziale
347,4 → 294,8 KB, peso totale 445 → 367 KiB.**

## 6. Perche mi fermo qui

2,8 s non e ≤ 2,5 s. Quello che resta e il core di GSAP, 74,7 KB, e
per abbassarlo servirebbe una di queste tre cose, tutte vietate dal
vincolo «non modificare estetica, contenuti o struttura»:

- **togliere l'animazione d'apertura da mobile** — cambia l'estetica;
- **spostare l'apertura da GSAP a CSS**, cosi che non aspetti il
  bundle — riscrittura di una delle tre famiglie di movimento, e la
  resa andrebbe ricostruita curva per curva;
- **far tornare la hero l'elemento LCP**, non dipingendola a opacita 0
  ma dissolvendo un velo sopra di essa — aggiunge un elemento e cambia
  il modo in cui l'apertura appare.

La terza e probabilmente la piu efficace — porterebbe l'LCP su una
risorsa gia presente a 52 ms — ed e quella da valutare se il numero di
Lighthouse deve scendere. Non la faccio senza che sia chiesto.
