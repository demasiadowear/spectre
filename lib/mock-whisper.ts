// ============================================================
// Simulated sales-call transcript for WHISPER Shadow Mode.
// A realistic AYROMEX discovery call where the prospect raises
// several objections (price, competitor, authority, timing,
// trust) — so the WHISPER engine has rich material to react to.
// The console streams these lines one by one and asks the AI
// for suggestions whenever the client speaks.
// ============================================================

export interface TranscriptLine {
  speaker: "cliente" | "tu";
  text: string;
}

export const MOCK_TRANSCRIPT: TranscriptLine[] = [
  { speaker: "tu", text: "Grazie per il tempo. Le rubo dieci minuti per mostrarle come automatizziamo la gestione dei vostri contatti." },
  { speaker: "cliente", text: "Va bene, però le dico subito che riceviamo tantissime chiamate e prenotazioni e facciamo fatica a stare dietro a tutto." },
  { speaker: "tu", text: "È esattamente il problema che risolviamo. Quante richieste stima di perdere fuori orario, in una settimana tipo?" },
  { speaker: "cliente", text: "Non saprei dirle un numero preciso… parecchie. La sera e la domenica il telefono squilla a vuoto." },
  { speaker: "tu", text: "Ecco, lì interviene l'AI: risponde su WhatsApp 24 ore su 24, prende la prenotazione e la sincronizza in agenda." },
  { speaker: "cliente", text: "Sembra interessante, ma quanto costa una cosa del genere? Ho paura che sia troppo caro per la mia attività." },
  { speaker: "tu", text: "Capisco la preoccupazione sul budget. Mi lasci prima capire bene il flusso, così le faccio un numero sensato." },
  { speaker: "cliente", text: "Guardi, in realtà noi già usiamo un gestionale con un altro fornitore per gli appuntamenti." },
  { speaker: "tu", text: "Perfetto, vuol dire che siete già organizzati. Noi non sostituiamo il gestionale, ci integriamo e gestiamo la conversazione col cliente." },
  { speaker: "cliente", text: "Mmh. E siete sicuri che funzioni davvero? Ho già provato altri strumenti e mi hanno fatto perdere tempo." },
  { speaker: "tu", text: "Domanda giustissima. Per questo partiamo con un periodo in cui misura i risultati sui suoi numeri reali, non su una demo." },
  { speaker: "cliente", text: "Ok, e in quanto tempo si attiva? Perché non ho settimane da dedicare a configurazioni complicate." },
  { speaker: "tu", text: "Il setup lo facciamo noi: cinque giorni lavorativi e lei è operativo, senza toccare nulla del flusso attuale." },
  { speaker: "cliente", text: "Diciamo che mi sta incuriosendo. Però una decisione così non la prendo da solo, devo sentire il mio socio." },
  { speaker: "tu", text: "Normalissimo. Le preparo una sintesi di una pagina con i tre numeri chiave da portare al suo socio: costo, tempo risparmiato, richieste recuperate." },
  { speaker: "cliente", text: "Questo mi aiuterebbe. Lui guarda sempre il prezzo per primo, quindi su quello dovremo essere chiari." },
  { speaker: "tu", text: "Saremo trasparentissimi. Le mostro anche un caso di una struttura simile alla vostra, qui in Puglia." },
  { speaker: "cliente", text: "Sì, mandami pure il caso. Mi piacerebbe capire i risultati concreti che hanno ottenuto." },
  { speaker: "tu", text: "Hanno recuperato il 32% delle richieste perse fuori orario nei primi due mesi. L'investimento è rientrato in meno di tre." },
  { speaker: "cliente", text: "Numeri interessanti. Ci penso, ne parlo col socio e ci sentiamo la settimana prossima, va bene?" },
  { speaker: "tu", text: "Volentieri. Le blocco già uno slot di onboarding per la prossima settimana: se confermate, partiamo subito; altrimenti lo libero." },
  { speaker: "cliente", text: "Ottima idea, così non perdiamo tempo. La ringrazio, è stata una chiacchierata utile." },
];
