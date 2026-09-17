---
name: forge-creative-direction
description: Processo di direzione creativa per i siti premium della Factory di SPECTER. Usala ogni volta che devi decidere l'aspetto di un sito per un'attività locale (barbiere, ristorante, studio, officina, salone) prima di scrivere una riga di CSS, quando ti chiedono direzioni artistiche, concept, moodboard o "un sito che non sembri un template", e quando devi scegliere fra più proposte o ucciderne una. Copre le tre direzioni obbligatorie, i criteri di scelta e le ragioni per scartare.
---

# Direzione creativa per la Factory

Prima di questa skill leggi `frontend-design` (nella stessa cartella):
detta i principi generali e l'elenco dei tell che fanno sembrare una
pagina generata. Qui non si ripetono. Qui c'è il **processo** che la
Factory usa per arrivare a una direzione e per difenderla.

## Perché tre direzioni e non una

Una sola proposta si difende sempre: chi la scrive la giustifica a
posteriori. Tre proposte costruite davvero costringono a un confronto, e
il confronto è l'unico momento in cui si scopre che un'idea reggeva solo
a parole.

Non sono tre varianti dello stesso impianto con colori diversi. Se
cambiando la palette le tre diventano la stessa pagina, non hai fatto
tre direzioni: ne hai fatta una e l'hai ridipinta.

Ogni direzione dichiara, prima del codice:

- **concept** — in una frase, cosa è la pagina;
- **mood** — il registro, detto anche per negazione ("di quartiere, non
  americano, non nostalgico");
- **palette** — 4-6 valori con un nome, non "grigio scuro";
- **tipografia** — le famiglie e i ruoli;
- **composizione** — dove sta il peso, dove sono gli assi;
- **movimento** — che gesto racconta;
- **interazione** — cosa può fare chi guarda, se qualcosa;
- **tecnologia** — e il costo che porta;
- **vantaggi** e **rischi** — il rischio va scritto prima, non dopo la
  bocciatura, altrimenti è una scusa.

## Costruirle, non descriverle

Le tre direzioni si realizzano come **hero funzionanti** e si
fotografano su desktop e telefono. Una direzione descritta a parole vince
sempre contro una costruita, perché le parole non hanno difetti.

Il confronto usa gli screenshot, non i documenti.

## Come si sceglie

In ordine, e il primo criterio che separa decide:

1. **Regge lo scroll?** Una hero che riempie la prima videata e non ha
   dove svilupparsi è un manifesto, non un sito. Se l'idea sta tutta in
   un blocco da una schermata, il resto della pagina sarà un'altra cosa
   attaccata sotto.
2. **L'idea sta nel contenuto o in un effetto?** Un'idea che vive nella
   tipografia e nelle parole sopravvive a tutto. Un'idea che vive in un
   effetto muore quando l'effetto è lento, o su un telefono che non lo
   carica.
3. **Diventa struttura?** La cosa migliore che può fare un'idea grafica
   è trasformarsi in struttura informativa — un filo che tiene insieme
   le sezioni, un ordine che dice qualcosa. Se resta ornamento, vale meno.
4. **È di questo mestiere?** Una direzione che potresti consegnare a un
   altro cliente della stessa categoria non è una direzione, è un tema.

## Come si uccide una direzione

Servono **prove**, non preferenze. Le prove buone:

- una misura (fotogrammi al secondo, peso, tempo di risposta);
- uno screenshot che mostra che l'effetto non si legge come previsto;
- un ramo che non si carica su telefono, quindi metà del pubblico non
  vedrebbe mai l'idea.

Quando una direzione muore, scrivi **perché** nel documento delle
direzioni e tieni il suo screenshot. Serve la prossima volta che qualcuno
propone la stessa cosa.

## Prestiti fra direzioni

Prendere un elemento dalla direzione scartata e portarlo in quella scelta
è legittimo, ma va dichiarato e motivato, altrimenti è indecisione.
Motivo buono: la direzione scelta cadeva in un default riconosciuto
(vedi `frontend-design`) e l'elemento preso la lega al soggetto.

## Il fondo non è un dettaglio

Un nero neutro, un bianco puro o un crema caldo si leggono come
ereditati. Il colore di fondo è la prima decisione, non l'ultima: deve
venire da qualcosa del soggetto — un materiale, una vernice, una luce.
Attenzione però: `frontend-design` elenca fra i tell anche il
"near-black tinto" (#0B0B0B, #111) usato al posto del nero. Una deriva
cromatica va portata abbastanza lontano da leggersi come colore, non
come nero sporco.

## Criteri di accettazione

Una direzione è pronta quando:

- le tre alternative esistono come file, non come paragrafi;
- gli screenshot sono stati guardati, non solo prodotti;
- la scelta cita quale dei quattro criteri ha separato;
- la bocciata ha una prova accanto;
- il documento delle direzioni contiene la tabella dei cliché con la
  verifica voce per voce.

## Errori da evitare

- Scrivere le tre direzioni e costruirne una sola.
- Chiamare "rischio" un difetto che hai scoperto dopo.
- Scegliere la direzione più vistosa invece di quella che regge.
- Aggiungere una tecnologia perché è disponibile: vedi
  `threejs-webgl-direction`.
- Dichiarare originale un lavoro senza aver fatto la verifica dei tell.
