---
name: typography-editorial
description: Tipografia editoriale per i siti italiani della Factory: scelta e accoppiamento dei caratteri, assi delle variabili, scala, impaginazione asimmetrica. Usala quando imposti il tipo di una pagina, scegli i font, decidi le dimensioni dei titoli, imposti la griglia o quando una pagina "sembra una pila di blocchi". Copre gli assi di Fraunces (SOFT, WONK, opsz), i font auto-ospitati da npm e le trappole del testo italiano.
---

# Tipografia editoriale

`frontend-design` copre i principi: una o due famiglie, scala dichiarata,
riga sotto gli 80 caratteri, e i tell da evitare (accentare una parola
sola nel titolo, etichette tutte maiuscole, occhielli inutili). Qui c'è
quello che serve in più per l'italiano, per i font variabili e per far
respirare una pagina.

## Font auto-ospitati, mai da CDN

Si installano da npm e viaggiano col bundle:

```
@fontsource-variable/fraunces
@fontsource-variable/instrument-sans
@fontsource/archivo-black
```

Tre ragioni, in ordine di importanza:
1. Chromium headless non usa il proxy dell'ambiente: un font da CDN
   **sparisce proprio negli screenshot del QA**, e tu giudichi una
   pagina che non è quella che vedrà il cliente.
2. Un sito che non chiama Google a ogni visita è più veloce e non
   espone i visitatori a terzi.
3. Negli ambienti chiusi il CDN semplicemente non risponde.

Il peso reale: due famiglie variabili latine stanno in ~66 KB woff2.
Includi solo i sottoinsiemi che usi — `latin` e `latin-ext` bastano per
l'italiano; `vietnamese` e `cyrillic` no.

## Assi delle variabili: usali, non lasciarli a zero

Un font variabile con gli assi ai valori di default è un font statico
che pesa di più. Fraunces ne ha tre che cambiano davvero il carattere:

| Asse | Cosa fa | Uso |
|---|---|---|
| `opsz` (9-144) | dimensione ottica: a valori alti le grazie si assottigliano e il contrasto sale | `144` nei titoli grandi, `72` nei titoli di sezione |
| `SOFT` (0-100) | arrotonda i terminali | `0` per severo, `30-70` per caldo |
| `WONK` (0-1) | attiva le forme "storte", la g e la a alternative | `1` dà personalità, e distingue il titolo dal corpo |

```css
.titolo {
  font-family: "Fraunces Variable", Georgia, serif;
  font-variation-settings: "SOFT" 0, "WONK" 1, "opsz" 144;
  font-weight: 300;   /* un peso leggero a corpo grande è più elegante */
}
```

A corpo molto grande scendi di peso, non salire: un titolo a 9rem in
weight 300 è più raffinato dello stesso in 700.

## Scala

Una scala dichiarata, e ci si resta. Con `clamp()` si fa una scala
fluida senza breakpoint:

```css
font-size: clamp(2.6rem, 10.5vw, 9.5rem);   /* titolo */
font-size: clamp(1.8rem, 3.4vw,  2.8rem);   /* sezione */
font-size: clamp(1.3rem, 3.4vw,  2.2rem);   /* voce di elenco */
font-size: clamp(15px,   1.05vw, 17px);     /* corpo */
```

Il valore centrale in `vw` è quello che comanda: sceglilo perché il
titolo occupi la larghezza voluta alla misura tipica, non a caso.

Sempre: `text-wrap: balance` sui titoli, `letter-spacing` negativo
(-0.02em / -0.035em) sui corpi grandi, mai positivo sotto i 2rem.
`font-variant-numeric: tabular-nums` dove le cifre si incolonnano
(orari, prezzi, tabelle).

## Italiano: tre trappole

1. **Le accentate finali** (città, perché, lunedì, martedì) hanno bisogno
   di `latin-ext` in alcune famiglie. Verifica sullo screenshot che non
   ci sia un fallback silenzioso: un carattere che cambia solo sulle
   accentate è il segnale.
2. **Le parole italiane sono più lunghe** dell'inglese: "Prenota un
   appuntamento" contro "Book". Una CTA che sta in un bottone in inglese
   può traboccare in italiano. Misura, non tradurre e spera.
3. **Il trattino lungo**. `frontend-design` elenca fra i tell le
   etichette costruite come `PAROLA — frammento` con l'em dash spaziato.
   In italiano il trattino lungo è legittimo negli intervalli
   (`Martedì — Sabato`, `09:00 — 19:00`), ma se lo usi anche negli
   occhielli e nei titoli diventa un tic. Tienilo agli intervalli.

## Impaginazione: togliere la pila

Il difetto più comune di una pagina generata non è il font: è che tutte
le sezioni sono allineate allo stesso margine, una sotto l'altra, con
molto vuoto in mezzo. Una griglia editoriale lo risolve:

```css
.griglia {
  display: grid;
  grid-template-columns: minmax(180px, 3fr) minmax(0, 7fr);
  gap: clamp(20px, 4vw, 64px);
  align-items: start;
}
.rail-sez { position: sticky; top: clamp(20px, 6vh, 72px); }
```

Il titolo di sezione vive in una colonna stretta e resta appiccicato
mentre il contenuto scorre. Dà ritmo e riempie il vuoto.

Sotto gli 860px la griglia collassa a una colonna e lo sticky va tolto:
su telefono un titolo appiccicato ruba altezza utile.

`minmax(0, 7fr)` e non `7fr`: senza il minimo a zero, un contenuto largo
(una tabella, una parola lunga) allarga la colonna e la pagina scorre in
orizzontale.

## Criteri di accettazione

- Due famiglie al massimo, con ruoli distinti a colpo d'occhio.
- Gli assi delle variabili impostati, non lasciati ai default.
- Nessun fallback silenzioso: verificato sullo screenshot, accentate
  comprese.
- Nessuno scorrimento orizzontale a 390px.
- La riga di testo corrente sotto i 70 caratteri (`max-width: 34ch`).

## Errori da evitare

- Accentare una parola del titolo in corsivo o in un altro colore: è il
  primo tell dell'elenco di `frontend-design`.
- Occhielli tutti maiuscoli e spaziati sopra ogni titolo.
- Stringhe di metadati unite dal punto mediano (`A · B · C`).
- Una famiglia monospaziata per le etichette piccole "perché tecnico".
- Caricare pesi che non usi.
