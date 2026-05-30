import type {
  LeadStatus,
  ObjectionType,
  OraclePrediction,
  ProposalContent,
  WhisperResponse,
} from "@/types";
import { clamp, formatCurrency } from "@/lib/utils";

// ============================================================
// Deterministic mock AI. Used when GEMINI_API_KEY is missing
// (or a live call fails). Output mirrors the JSON contracts the
// real Gemini prompts return, varying realistically with input.
// ============================================================

// ---------- HAND (proposals) ---------------------------------

export interface HandInput {
  lead_name: string;
  company: string;
  intent: string;
  tone: string;
  bundle_ayrohub: boolean;
  bundle_ayrodesk24: boolean;
  bundle_ayromedia: boolean;
}

const BUNDLE_BULLETS = {
  ayrohub:
    "AyroHub — voice + WhatsApp AI H24 per riattivazione e retention dei contatti dormienti",
  ayrodesk24:
    "AyroDesk24 — segretaria AI su WhatsApp che gestisce prenotazioni, richiami e no-show 24/7",
  ayromedia:
    "AyroMedia — content factory AI per social, campagne e follow-up visivi automatizzati",
} as const;

const TONE_OPENER: Record<string, string> = {
  Professionale: "Abbiamo analizzato il vostro flusso operativo",
  Aggressivo: "Ogni giorno senza automazione è margine che lasciate sul tavolo",
  Soft: "Crediamo ci sia un modo più sereno di gestire il vostro lavoro quotidiano",
  Tecnico: "Partendo dai vostri colli di bottiglia operativi",
};

export function mockHand(input: HandInput): ProposalContent {
  const bundles: string[] = [];
  if (input.bundle_ayrohub) bundles.push(BUNDLE_BULLETS.ayrohub);
  if (input.bundle_ayrodesk24) bundles.push(BUNDLE_BULLETS.ayrodesk24);
  if (input.bundle_ayromedia) bundles.push(BUNDLE_BULLETS.ayromedia);
  if (bundles.length === 0) {
    bundles.push(
      "Automazione su misura del processo descritto, con AI che lavora al posto vostro sul 90% dei task ripetitivi",
    );
  }

  const n = bundles.length;
  const opener = TONE_OPENER[input.tone] ?? TONE_OPENER.Professionale;
  const intent = input.intent.trim();

  const pricing = [
    {
      name: "STARTER",
      price: 1490 + n * 200,
      description:
        "Setup iniziale, 1 automazione core, onboarding e 30 giorni di supporto.",
    },
    {
      name: "PRO",
      price: 3490 + n * 400,
      description:
        "Tutto Starter + integrazioni multiple, dashboard dedicata e ottimizzazione continua.",
    },
    {
      name: "ENTERPRISE",
      price: 7490 + n * 800,
      description:
        "Soluzione completa multi-canale, SLA prioritario e account manager dedicato.",
    },
  ];

  return {
    title: `Proposta operativa AYROMEX per ${input.company}`,
    sections: [
      {
        heading: "Hook",
        body: `${opener}. ${input.company} ha un potenziale che oggi resta bloccato da attività manuali ripetitive: ${intent || "gestione contatti, richiami e operatività quotidiana"}. Noi lo sblocchiamo con l'AI.`,
      },
      {
        heading: "Diagnosi",
        body: [
          "• Tempo prezioso speso in task che un'AI può gestire al posto vostro.",
          "• Contatti e richieste che si perdono fuori orario o nei picchi di lavoro.",
          "• Nessun sistema che lavori in automatico mentre voi siete operativi.",
        ].join("\n"),
      },
      {
        heading: "Soluzione",
        body: `Implementiamo per ${input.company} un sistema AYROMEX che automatizza il flusso descritto:\n${bundles.map((b) => `• ${b}`).join("\n")}\nObiettivo: ridurre il lavoro umano al 10% e aumentare il margine.`,
      },
      {
        heading: "Proof",
        body: "Caso reale: una struttura ricettiva pugliese ha recuperato il 32% di richieste perse fuori orario nei primi 60 giorni, con un ritorno sull'investimento in meno di 3 mesi. La stessa logica si applica al vostro contesto.",
      },
      {
        heading: "Pricing",
        body: "Tre livelli di ingaggio, scegliete in base alla profondità dell'automazione. I dettagli sono nei piani qui sotto: Starter per partire, Pro per scalare, Enterprise per delegare tutto.",
      },
      {
        heading: "CTA",
        body: `Il prossimo passo è una call operativa di 20 minuti in cui vi mostriamo il sistema già configurato sul caso ${input.company}. Confermate uno slot e partiamo.`,
      },
    ],
    pricing,
    email_subject: `${input.company} — come automatizziamo il vostro flusso con l'AI`,
    email_body: `Ciao ${input.lead_name || "buongiorno"},\n\nho preparato una proposta concreta per ${input.company}. In sintesi: automatizziamo ${intent || "la vostra operatività quotidiana"} così da liberarvi tempo e non perdere più richieste.\n\nDentro trovi diagnosi, soluzione e tre livelli di pricing. Ti propongo una call di 20 minuti per mostrarti il sistema in azione.\n\nQuando sei disponibile questa settimana?\n\nA presto,\nAYROMEX`,
    followup_script: `Ciao ${input.lead_name || ""}, sono di AYROMEX — ti avevo inviato la proposta per ${input.company}. Ti rubo trenta secondi: l'unica domanda è se vuoi continuare a gestire ${intent || "tutto"} a mano o se preferisci che lo faccia un'AI al posto tuo. Ti va una call veloce domani?`,
  };
}

// ---------- ORACLE (close prediction) ------------------------

export interface OracleInput {
  lead_id: string;
  lead_name: string;
  company: string;
  value: number;
  status: LeadStatus;
  proposed_price: number;
  days_to_followup: number;
  bundle_ayrohub: boolean;
  bundle_ayrodesk24: boolean;
  bundle_ayromedia: boolean;
}

const STATUS_BASE: Record<LeadStatus, number> = {
  todo: 18,
  step1_sent: 32,
  replied: 50,
  step2_sent: 60,
  preview_sent: 68,
  negotiating: 74,
  closed: 95,
  lost: 8,
};

function computeProbability(
  statusBase: number,
  valueAnchor: number,
  price: number,
  days: number,
  bundleCount: number,
): number {
  let p = statusBase;

  // Price vs perceived value: cheaper than anchor lifts probability.
  const anchor = valueAnchor > 0 ? valueAnchor : price || 1;
  const ratio = price / anchor;
  if (ratio <= 0.8) p += 9;
  else if (ratio <= 1) p += 4;
  else if (ratio <= 1.2) p -= 3;
  else p -= 11;

  // Follow-up timing: sooner is better.
  if (days <= 2) p += 6;
  else if (days <= 7) p += 1;
  else if (days <= 14) p -= 4;
  else p -= 9;

  // Bundles add value but with diminishing returns.
  p += Math.min(9, bundleCount * 3);

  return Math.round(clamp(p, 4, 96));
}

export function mockOracle(input: OracleInput): OraclePrediction {
  const base = STATUS_BASE[input.status] ?? 30;
  const bundleCount =
    Number(input.bundle_ayrohub) +
    Number(input.bundle_ayrodesk24) +
    Number(input.bundle_ayromedia);

  const main = computeProbability(
    base,
    input.value,
    input.proposed_price,
    input.days_to_followup,
    bundleCount,
  );

  const probDiscount = computeProbability(
    base,
    input.value,
    Math.round(input.proposed_price * 0.9),
    input.days_to_followup,
    bundleCount,
  );

  const probAllBundles = computeProbability(
    base,
    input.value,
    input.proposed_price,
    Math.min(input.days_to_followup, 2),
    3,
  );

  const scenarios = [
    { label: "Scenario attuale", probability: main, change: 0 },
    {
      label: "Prezzo −10%",
      probability: probDiscount,
      change: probDiscount - main,
    },
    {
      label: "Tutti i bundle + follow-up rapido",
      probability: probAllBundles,
      change: probAllBundles - main,
    },
  ];

  const urgency_level: OraclePrediction["urgency_level"] =
    main >= 60 && input.days_to_followup <= 7
      ? "high"
      : main < 35
        ? "low"
        : "medium";

  const bestAlt = scenarios
    .slice(1)
    .reduce((b, s) => (s.change > b.change ? s : b), scenarios[1]);

  const recommendation =
    input.days_to_followup > 7
      ? `Anticipa il follow-up: portarlo entro 48 ore alza la chiusura. ${input.lead_name} è ancora caldo.`
      : bestAlt.change >= 5
        ? `Gioca lo scenario "${bestAlt.label}": +${bestAlt.change} punti di probabilità sullo stesso deal.`
        : `Chiudi ora a ${formatCurrency(input.proposed_price)}: le condizioni sono già favorevoli, non diluire l'urgenza.`;

  return {
    probability_main: main,
    confidence: Number((0.6 + bundleCount * 0.05 + (base >= 60 ? 0.1 : 0)).toFixed(2)),
    scenarios,
    insight: `Con ${input.company} in stato "${input.status}" e un'offerta di ${formatCurrency(input.proposed_price)}, la chiusura stimata è ${main}%. La leva più sensibile è ${bestAlt.change >= 5 ? `"${bestAlt.label}"` : "la tempistica del follow-up"}: agire qui sposta l'ago più del prezzo assoluto.`,
    recommendation,
    urgency_level,
  };
}

// ---------- WHISPER (objection handling) ---------------------

export interface WhisperInput {
  lead_name?: string;
  company?: string;
  messages: { speaker: string; text: string }[];
}

const OBJECTION_KEYWORDS: Record<ObjectionType, string[]> = {
  prezzo: ["prezz", "costa", "caro", "budget", "econom", "spend", "troppo", "permett"],
  tempistiche: ["tempo", "quando", "subito", "urgent", "scadenz", "lungo", "tempistic", "ci vuole"],
  concorrenza: ["concorren", "competitor", "altro fornitore", "altra agenzia", "già usiamo", "alternativ", "altri preventiv"],
  fiducia: ["sicur", "garanz", "fid", "funziona davvero", "referenz", "rischio", "prov"],
  autorita: ["devo chiedere", "decide", "socio", "moglie", "marito", "capo", "consiglio", "non sono io"],
  bisogno: ["non so se", "serve davvero", "ci pensiamo", "non sono sicuro", "forse", "vediamo"],
};

const PLAYBOOK: Record<
  ObjectionType,
  WhisperResponse["responses"]
> = {
  prezzo: [
    { type: "value", text: "Capisco. Mettiamola così: il sistema si ripaga col primo cliente che oggi perdi fuori orario. Non è un costo, è un recupero di margine.", rationale: "Sposta da costo a ROI concreto." },
    { type: "urgency", text: "Il prezzo di setup è bloccato a questa cifra solo fino a fine mese. Da giugno sale, quindi conviene partire ora.", rationale: "Crea scarsità temporale legittima." },
    { type: "social", text: "Un centro come il tuo a Bari ha recuperato il 32% di richieste perse in 60 giorni. Lo stesso numero copre l'investimento in tre mesi.", rationale: "Proof con numeri di un pari categoria." },
  ],
  tempistiche: [
    { type: "value", text: "Lo capisco. Proprio per questo l'AI lavora mentre tu sei operativo: non aggiunge lavoro, lo toglie da subito.", rationale: "Riformula il tempo come guadagnato, non speso." },
    { type: "urgency", text: "Il setup richiede 5 giorni lavorativi. Se partiamo oggi sei operativo prima del prossimo picco.", rationale: "Concretizza una timeline breve e un evento trigger." },
    { type: "social", text: "Gli ultimi tre clienti erano operativi entro una settimana, senza toccare nulla del loro flusso attuale.", rationale: "Riduce il rischio percepito di onboarding lungo." },
  ],
  concorrenza: [
    { type: "value", text: "Ottimo che tu stia già guardando soluzioni. La differenza è che noi non vendiamo un software: configuriamo il sistema sul tuo caso e lo gestiamo noi.", rationale: "Sposta da prodotto a servizio gestito." },
    { type: "urgency", text: "Posso bloccarti uno slot di onboarding questa settimana così confronti i due a sistema già attivo, non a parole.", rationale: "Trasforma il confronto in prova concreta immediata." },
    { type: "social", text: "Diversi clienti sono arrivati proprio dopo aver provato un gestionale generico: cercavano qualcuno che lo facesse funzionare per loro.", rationale: "Usa la migrazione altrui come proof." },
  ],
  fiducia: [
    { type: "value", text: "Domanda giusta. Partiamo con 30 giorni in cui vedi i risultati sui tuoi numeri reali, non su una demo.", rationale: "Riduce il rischio con periodo di prova misurabile." },
    { type: "urgency", text: "Ti attivo subito l'accesso a un caso live così vedi il sistema mentre risponde davvero a un cliente.", rationale: "Dimostrazione immediata batte la rassicurazione verbale." },
    { type: "social", text: "Ti lascio il contatto di un cliente nella tua zona: chiamalo, ti dice in due minuti com'è andata.", rationale: "Referenza diretta verificabile." },
  ],
  autorita: [
    { type: "value", text: "Perfetto, prepariamo insieme i tre numeri che servono a chi decide: costo, tempo risparmiato, richieste recuperate.", rationale: "Arma il contatto per la vendita interna." },
    { type: "urgency", text: "Organizziamo una call breve con chi decide questa settimana, così non perdiamo lo slot di onboarding.", rationale: "Porta il decisore nel processo subito." },
    { type: "social", text: "Mando una sintesi di una pagina con un caso simile: di solito è quello che sblocca il sì del socio.", rationale: "Fornisce materiale di chiusura interna." },
  ],
  bisogno: [
    { type: "value", text: "Facciamo una prova concreta: quante richieste hai perso la scorsa settimana fuori orario? Quello è il bisogno, in numeri.", rationale: "Fa emergere il pain con dati del cliente." },
    { type: "urgency", text: "Più aspetti, più richieste perdi ogni settimana. Partiamo con una sola automazione e misuriamo.", rationale: "Quantifica il costo dell'inazione." },
    { type: "social", text: "Anche gli altri all'inizio non erano sicuri: dopo due settimane di dati non tornerebbero indietro.", rationale: "Normalizza il dubbio e mostra l'esito." },
  ],
};

const DEFAULT_RESPONSES: WhisperResponse["responses"] = [
  { type: "value", text: "Bene. Riassumo il valore in una frase: liberi tempo e non perdi più richieste. Procediamo sul setup?", rationale: "Chiude sul valore quando non c'è obiezione esplicita." },
  { type: "urgency", text: "Ti propongo di partire subito: ti blocco lo slot di onboarding di questa settimana.", rationale: "Spinge verso il prossimo passo concreto." },
  { type: "social", text: "È lo stesso percorso che hanno fatto gli ultimi clienti soddisfatti: parti, misuri, scali.", rationale: "Rassicura con la traiettoria altrui." },
];

function detectObjection(text: string): ObjectionType | null {
  const lower = text.toLowerCase();
  const order: ObjectionType[] = [
    "prezzo",
    "concorrenza",
    "tempistiche",
    "fiducia",
    "autorita",
    "bisogno",
  ];
  for (const obj of order) {
    if (OBJECTION_KEYWORDS[obj].some((k) => lower.includes(k))) return obj;
  }
  return null;
}

type Tone = NonNullable<WhisperResponse["client_tone"]>;

const TONE_NOTE: Record<Tone, string> = {
  freddo: "Cliente distaccato: scalda con una domanda sul suo problema concreto.",
  scettico: "Dubita per esperienze passate: rassicura con prova sui suoi numeri reali.",
  interessato: "C'è apertura: porta verso il next step senza fretta.",
  irritato: "È sulla difensiva: abbassa la pressione, ascolta e riformula il valore.",
  esitante: "Non è sicuro: quantifica il costo dell'inazione, riduci il rischio percepito.",
  entusiasta: "È caldo: spingi alla chiusura e blocca uno slot ora.",
  neutro: "Tono neutro: mantieni il ritmo e guida verso il prossimo passo.",
};

function detectTone(text: string, objection: ObjectionType | null): Tone {
  const l = text.toLowerCase();
  if (/(irrita|infastid|basta|perde(re)? tempo|non ho voglia|seccat|scocci)/.test(l))
    return "irritato";
  if (/(non sono sicuro|non saprei|ci penso|forse|vediamo|magari|devo pensar)/.test(l))
    return "esitante";
  if (/(funziona davvero|sicur|già provato|non mi fido|rischio|garanz)/.test(l))
    return "scettico";
  if (/(perfetto|ottim|interessant|mi piace|volentieri|partiamo|ci sto|bene)/.test(l))
    return objection ? "interessato" : "entusiasta";
  if (/(va bene|ok|non saprei|telefono squilla)/.test(l)) return "neutro";
  return objection ? "scettico" : "neutro";
}

export function mockWhisper(input: WhisperInput): WhisperResponse {
  const tail = input.messages.slice(-6).map((m) => m.text).join(" ");
  const objection = detectObjection(tail);
  const tone = detectTone(tail, objection);
  const base = {
    client_tone: tone,
    tone_note: TONE_NOTE[tone],
  };
  if (!objection) {
    return {
      detected_objection: null,
      confidence: 0.45,
      ...base,
      responses: DEFAULT_RESPONSES,
    };
  }
  return {
    detected_objection: objection,
    confidence: 0.78,
    ...base,
    responses: PLAYBOOK[objection],
  };
}
