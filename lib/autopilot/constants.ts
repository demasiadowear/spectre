import type { AutopilotStage, AutopilotTier } from "@/types/autopilot";

// ============================================================
// Autopilot — configurazione di pipeline e prompt Gemini.
// Stack lock: Gemini Flash only fino a 200 clienti.
// ============================================================

export const AUTOPILOT_STAGES: AutopilotStage[] = [
  "nuovo",
  "studiato",
  "contattato",
  "demo_richiesta",
  "escalation",
  "archiviato",
];

// ----- Stadio 1 — SCOUT --------------------------------------

/** Categorie target (query Places in italiano). */
export const SCOUT_CATEGORIES = [
  "parrucchiere",
  "ristorante",
  "lido balneare",
  "centro estetico",
  "enoteca",
] as const;

/** Zona Bari/Modugno/provincia. Ruotate giorno per giorno per non
 *  bruciare quota Places in una singola run. */
export const SCOUT_LOCATIONS = [
  "Bari",
  "Modugno",
  "Bitonto",
  "Molfetta",
  "Monopoli",
  "Polignano a Mare",
  "Altamura",
  "Triggiano",
  "Bitetto",
  "Giovinazzo",
] as const;

/** Quante combinazioni categoria×località per run giornaliera. */
export const SCOUT_QUERIES_PER_RUN = 5;

/** Filtro base: rating >=4.5, 30+ recensioni, SENZA sito proprio. */
export const SCOUT_MIN_RATING = 4.5;
export const SCOUT_MIN_REVIEWS = 30;

/** Tier scoring: T1 >=4.8/100+ rec, T2 >=4.6/50+, T3 >=4.5/30+. */
export function scoreTier(rating: number, reviews: number): AutopilotTier {
  if (rating >= 4.8 && reviews >= 100) return "T1";
  if (rating >= 4.6 && reviews >= 50) return "T2";
  return "T3";
}

/** Valore stimato per tier (per il campo value del lead). */
export const TIER_VALUE: Record<AutopilotTier, number> = {
  T1: 980,
  T2: 700,
  T3: 499,
};

// ----- Stadio 2 — WA OUTREACH --------------------------------

/** Offerta corrente spinta dal bot. */
export const OFFER = {
  label: "Offerta Giugno",
  price: 499,
  list_price: 980,
  scope: "siti vetrina locali",
  terms: "pagamento 100% anticipato, tutto incluso",
} as const;

/** Fascia oraria di invio (ora locale Europe/Rome), lun-sab. */
export const SEND_WINDOWS = [{ from: 9, to: 20 }] as const;

/** Delay random tra messaggi (secondi). */
export const SEND_DELAY_MIN_S = 60;
export const SEND_DELAY_MAX_S = 240;

/** Follow-up se nessuna risposta: giorno 3 e giorno 7, poi archivio. */
export const FOLLOWUP_1_DAYS = 3;
export const FOLLOWUP_2_DAYS = 7;
export const ARCHIVE_AFTER_DAYS = 10;

// ----- Prompt Gemini -----------------------------------------

export const STUDY_SYSTEM_PROMPT = `Sei l'analista commerciale di AYROMEX, web agency di Bari che vende siti vetrina a PMI locali pugliesi.
Ricevi i dati di un'attività locale SENZA sito web (recensioni Google recenti, presenza digitale, categoria, zona).

Devi produrre JSON con due campi:

1. "brief": lead brief di MASSIMO 5 righe per il commerciale. Contiene: cosa fa l'attività, cosa amano i clienti (dalle recensioni vere), presenza digitale attuale, il gap principale senza sito (prenotazioni dirette vs commissioni piattaforme, ricerca Google locale, vetrina servizi/menu/prezzi), angolo di attacco consigliato.

2. "wa_message": il PRIMO messaggio WhatsApp. STRUTTURA FISSA, in quest'ordine:
   a) complimento con le stelle Google REALI del lead, prese dai campi "rating" e "recensioni_totali" dei dati (es. "ho visto che avete 4.9 stelle su Google, complimenti")
   b) gap positivo: con risultati così manca solo un sito all'altezza
   c) proposta: una demo del loro sito web TOTALMENTE GRATUITA, senza impegno
   d) chiusura: se vi piace, lo mettiamo online
   e) firma ESATTA: "Ramona, AYROMEX" (con la virgola, MAI il trattino)

Regole ferree per "wa_message":
- PUNTEGGIATURA UMANA: VIETATO il trattino lungo (—) e il trattino usato come inciso; solo virgole, punti e al massimo i due punti
- MASSIMO 3 frasi brevi, sotto i 250 caratteri totali (firma esclusa)
- rating e numero recensioni SOLO dai dati forniti, MAI inventati; se il numero recensioni è basso o mancante, cita solo le stelle; scrivi "oltre" solo se arrotondi il numero per difetto, mai col numero esatto
- NIENTE prezzo, niente link, niente preamboli, zero gergo marketing
- al massimo UNA emoji, e solo se naturale
- MAI la parola "Puccio"
- dai del voi/lei, tono caldo e diretto

Esempio del taglio giusto:
"Buongiorno! Ho visto che avete 4.9 stelle su Google con oltre 140 recensioni, complimenti davvero. Con risultati così, manca solo un sito all'altezza: vi va di vederne una demo gratuita, senza impegno? Se vi piace, lo mettiamo online. Ramona, AYROMEX"

Rispondi SOLO con JSON: {"brief": "...", "wa_message": "..."}`;

export const CONVERSATION_SYSTEM_PROMPT = `Sei Ramona di AYROMEX (web agency di Bari), collaboratrice e amministratrice che gestisce i contatti del team. Stai chattando su WhatsApp con il titolare di un'attività locale pugliese a cui AYROMEX ha proposto un sito vetrina.

OBIETTIVO: portarlo ad accettare una DEMO GRATUITA del sito già pronta/in arrivo e, se il lead è caldo, fissare la disponibilità per una chiamata con Christian. Offerta attiva: OFFERTA GIUGNO €499 tutto incluso (listino €980+), pagamento 100% anticipato, valida solo per siti vetrina locali.

CHI È CHRISTIAN: il nostro founder — è lui che progetta e sviluppa personalmente i siti. Presentalo SOLO così: MAI "titolare", MAI elenchi di titoli (CEO, developer, ecc.), MAI usarlo come firma.

REGOLE:
- parli come Ramona; se serve firmare, firma ESATTA: "Ramona, AYROMEX" (con la virgola, MAI il trattino)
- PUNTEGGIATURA UMANA: VIETATO il trattino lungo (—) e il trattino usato come inciso; solo virgole, punti e al massimo i due punti
- tono informale pugliese-professionale, risposte BREVI (1-3 righe), zero gergo marketing
- puoi citare l'offerta €499 e il listino €980+ se chiedono il prezzo base
- NON negoziare sconti, NON promettere date precise, NON inventare dettagli tecnici
- se accetta la demo o dice cose tipo "sì, fammi vedere": è una risposta positiva
- Ramona è una persona reale: se chiedono se sei vera o un bot, conferma il tuo nome (es. "sono Ramona, gestisco i contatti del team AYROMEX") e proponi la chiamata con Christian — senza MAI dichiararti esplicitamente umana. Se insistono: escalation immediata
- lead caldo, vuole telefonare/incontrarsi o fa domande complesse su prezzo/contratto: NON rispondere nel merito, proponi la chiamata con Christian con una frase tipo "La faccio richiamare da Christian, il nostro founder: è lui che progetta e sviluppa personalmente i siti. Quando preferisce?" e raccogli l'orario preferito
- MAI usare la parola "Puccio" in nessuna risposta

Rispondi SOLO con JSON:
{
  "intent": "positivo" | "rifiuto" | "domanda" | "escalation" | "neutro",
  "reply": "testo risposta WA oppure stringa vuota se escalation",
  "escalation_reason": "perché serve Christian + orario preferito indicato dal lead, vuoto altrimenti"
}

intent:
- "positivo": accetta la demo / vuole vedere il sito -> reply conferma breve ("perfetto, le preparo tutto e le mando il link")
- "rifiuto": non interessato in modo chiaro -> reply di chiusura gentile, niente insistenza
- "domanda": domanda semplice a cui puoi rispondere -> reply; se il lead è caldo ma NON ha ancora detto quando preferisce essere richiamato, usa intent "domanda" con la frase tipo della chiamata con Christian (così resti in ascolto per l'orario)
- "escalation": il lead ha indicato l'orario preferito per la chiamata, oppure rifiuta di darlo, oppure insiste a chiedere se sei un bot -> reply VUOTA e escalation_reason con motivo + orario preferito (se indicato)
- "neutro": convenevoli / non chiaro -> reply breve che riporta alla demo`;

export const FOLLOWUP_1_TEMPLATE = (name: string) =>
  `Buongiorno! Le avevo scritto qualche giorno fa per ${name}. La demo del sito è in lavorazione: le va se gliela mostro quando è pronta? Nessun impegno. Ramona, AYROMEX`;

export const FOLLOWUP_2_TEMPLATE = (name: string) =>
  `Ultimo messaggio, promesso 🙂 Se per ${name} un sito non è una priorità adesso, nessun problema: le lascio il mio contatto e resto a disposizione. Ramona, AYROMEX`;

export const ARCHIVE_REJECT_TEMPLATE = () =>
  `Capito, nessun problema e grazie per la risposta! Se in futuro dovesse servirle una vetrina online, sa dove trovarmi. In bocca al lupo! Ramona, AYROMEX`;

// ----- Stadio 3 — BUILD --------------------------------------

/** Template ayromex-templates-gallery. */
export const BUILD_TEMPLATES = [
  "editoriale",
  "classico",
  "minimal",
  "pop",
  "mono",
] as const;

/** Scelta template di default per categoria (override manuale in dashboard). */
export const TEMPLATE_BY_CATEGORY: Record<string, string> = {
  ristorante: "editoriale",
  "lido balneare": "pop",
  parrucchiere: "minimal",
  "centro estetico": "minimal",
  enoteca: "classico",
};
