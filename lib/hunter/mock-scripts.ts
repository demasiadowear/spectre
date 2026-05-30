import type { ColdCallScript, ScoredLead } from "@/types/hunter";

// ============================================================
// Deterministic mock cold-call script — used when GEMINI_API_KEY
// is absent. Varies by category, business name, rating and website
// status so each script reads bespoke, not templated.
// ============================================================

interface CategoryProfile {
  match: string[];
  noun: string; // "il tuo salone", "la tua pizzeria"...
  pains: string[];
}

const PROFILES: CategoryProfile[] = [
  {
    match: ["parrucchiere", "barbiere", "hair", "acconciature"],
    noun: "il tuo salone",
    pains: [
      "I clienti ti cercano su Google la sera tardi e, senza sito, trovano solo l'orario — non possono prenotare.",
      "Le telefonate durante il taglio interrompono il lavoro: una receptionist AI su WhatsApp le gestisce al posto tuo.",
      "I concorrenti con un sito curato sembrano più professionali, anche quando tagliano peggio di te.",
    ],
  },
  {
    match: ["estetista", "beauty", "nails", "estetico"],
    noun: "il tuo centro",
    pains: [
      "Chi cerca 'estetista vicino a me' sceglie chi mostra foto e listino online: senza sito resti invisibile.",
      "Le prenotazioni via DM e telefono si perdono: un sistema di booking automatico le raccoglie 24 ore su 24.",
      "Senza una pagina recensioni curata, il tuo 4+ stelle su Google non lavora per te come potrebbe.",
    ],
  },
  {
    match: ["tattoo", "ink"],
    noun: "il tuo studio",
    pains: [
      "I clienti vogliono vedere il portfolio prima di scrivere: senza sito mandi tutto su Instagram e perdi controllo.",
      "Le richieste di preventivo arrivano a tutte le ore: un assistente AI raccoglie soggetto, zona e budget mentre tatui.",
      "Uno studio serio con un sito dedicato trasmette più fiducia di un semplice profilo social.",
    ],
  },
  {
    match: ["palestra", "fitness", "gym"],
    noun: "la tua palestra",
    pains: [
      "Chi cerca una palestra confronta orari, corsi e prezzi online: senza sito esci dal confronto.",
      "Le richieste di prova gratuita si gestiscono male via telefono: un form + WhatsApp AI le converte meglio.",
      "Senza una pagina con i corsi e gli istruttori, sembri meno strutturato dei centri concorrenti.",
    ],
  },
  {
    match: ["ristorante", "trattoria", "osteria", "pizzeria", "bar", "caffè", "caffe"],
    noun: "il tuo locale",
    pains: [
      "I clienti cercano menù e prenotazione online prima di uscire: senza sito vai sulle app altrui che ti tassano.",
      "Le telefonate nell'ora di punta restano senza risposta: un sistema AI su WhatsApp prende le prenotazioni.",
      "Senza un sito con foto e menù aggiornato, le recensioni ottime non si trasformano in coperti pieni.",
    ],
  },
];

const FALLBACK: CategoryProfile = {
  match: [],
  noun: "la tua attività",
  pains: [
    "I tuoi clienti ti cercano online e, senza un sito, trovano solo la scheda Google: poche info, zero controllo.",
    "Le richieste via telefono e messaggi si perdono: un assistente AI su WhatsApp le gestisce in automatico.",
    "Un sito professionale fa sembrare la tua attività più solida e affidabile rispetto ai concorrenti.",
  ],
};

function profileFor(category: string): CategoryProfile {
  const c = category.toLowerCase();
  return PROFILES.find((p) => p.match.some((m) => c.includes(m))) ?? FALLBACK;
}

export function generateMockScript(
  lead: ScoredLead,
  category: string,
): ColdCallScript {
  const profile = profileFor(category || lead.category);
  const praise =
    lead.rating >= 4.7
      ? `complimenti davvero per le ${lead.reviews} recensioni e quel ${lead.rating} su Google, numeri che parlano da soli`
      : lead.rating >= 4.3
        ? `ho visto le belle recensioni su Google, si vede che lavorate bene`
        : `ho visto che state crescendo su Google`;

  const opening = lead.has_website
    ? `Buongiorno, parlo con ${lead.name}? Sono di AYROMEX, ci occupiamo di siti e sistemi AI per attività locali. Ho dato un'occhiata alla vostra presenza online — ${praise}. La chiamo perché credo si possa spingere molto di più.`
    : `Buongiorno, parlo con ${lead.name}? Sono di AYROMEX. La chiamo perché ho cercato "${category || lead.category}" nella vostra zona e ${praise}, ma ho notato che non avete un sito: i clienti vi trovano solo su Google Maps. È un attimo che le spiego perché è un peccato.`;

  return {
    opening,
    rapport: `Tranquillo, sarò rapidissimo — so che ${profile.noun} non si gestisce da soli e che il tempo al telefono è prezioso. Le rubo due minuti netti.`,
    pain_points: profile.pains,
    solution: `Noi di AYROMEX in 48 ore mettiamo in piedi un sito professionale per ${profile.noun}, con una receptionist AI su WhatsApp che risponde ai clienti e prende le prenotazioni da sola, più l'ottimizzazione per farvi trovare su Google nella vostra zona. Lei continua a fare il suo lavoro, il resto lo gestiamo noi.`,
    social_proof: `Abbiamo seguito attività simili alla vostra qui in Italia: in media le prenotazioni online valgono il 20-30% di clienti in più nel primo trimestre, senza aumentare il lavoro al telefono.`,
    price_anchor: `Il bello è che parte da poco: siti professionali da 750 euro, pronti in 48 ore. Non è un investimento da migliaia di euro come pensano in tanti.`,
    closing: `Le propongo questo: fissiamo una demo di 10-15 minuti, le mostro esattamente come verrebbe ${profile.noun} online e come funziona l'assistente WhatsApp. Zero impegno. Le va meglio domani in mattinata o nel pomeriggio?`,
    objections: [
      {
        objection: "Non ho tempo / sono in negozio.",
        response: `La capisco, per questo le chiedo solo 10 minuti quando è più tranquillo. Anzi, l'assistente AI nasce proprio per togliere lavoro a lei, non per aggiungerne.`,
      },
      {
        objection: "Ho già la pagina Facebook/Instagram, mi basta.",
        response: `I social sono ottimi per farsi vedere, ma il cliente che vuole prenotare adesso cerca su Google e si aspetta un sito. Le due cose insieme moltiplicano i risultati.`,
      },
      {
        objection: "Costa troppo / non è il momento.",
        response: `Proprio per questo partiamo da 750 euro una tantum, non da migliaia. E con le prenotazioni in più si ripaga in fretta. Vediamoci 10 minuti, poi decide lei con i numeri in mano.`,
      },
      {
        objection: "Mandami qualcosa via email.",
        response: `Volentieri, glielo mando subito. Però in 10 minuti di demo le mostro la cosa fatta sulla vostra attività: è molto più concreto di un PDF. Quando la richiamo?`,
      },
    ],
  };
}
