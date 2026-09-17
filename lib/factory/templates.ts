import type { SectionKind, SitePalette } from "@/types/factory";

// ============================================================
// Template verticali, DETERMINISTICI.
//
// Serve a evitare l'effetto "template AI generico": una pizzeria e un
// dentista non possono avere la stessa pagina con parole diverse. Un
// template decide l'ORDINE delle sezioni, i titoli, la CTA giusta per
// la categoria e la palette. Nessun modello partecipa a questa scelta:
// stessa categoria, stesso layout, sempre.
//
// Non c'è HTML qui dentro: il template è una configurazione che il
// renderer legge. Il modello non genera mai markup.
// ============================================================

export type TemplateId =
  | "ristorazione"
  | "bellezza"
  | "salute"
  | "casa"
  | "auto"
  | "locale";

export interface TemplateSection {
  kind: SectionKind;
  /** Titolo predefinito: usato se non ce n'è uno migliore verificato. */
  title: string;
  /** true = la sezione si mostra solo se ha dati veri da mostrare. */
  requiresData?: boolean;
}

export interface VerticalTemplate {
  id: TemplateId;
  label: string;
  /** Ordine delle sezioni: è quello che distingue un verticale. */
  sections: TemplateSection[];
  palette: SitePalette;
  /** Come si chiama l'azione principale in questo settore. */
  ctaLabels: { call: string; whatsapp: string; maps: string; email: string };
  /** Parole dell'intestazione, senza promesse né superlativi. */
  heroLead: string;
  /** Titolo della sezione servizi, nel lessico del settore. */
  servicesTitle: string;
  /** Etichetta per il menu/listino pubblico, se esiste. */
  menuLabel: string;
  /** Accento tipografico: cambia la resa oltre al colore. */
  headingCase: "normal" | "upper";
}

const TEMPLATES: Record<TemplateId, VerticalTemplate> = {
  ristorazione: {
    id: "ristorazione",
    label: "Ristorazione",
    // In ristorazione si guarda il posto, poi cosa si mangia, poi si prenota.
    sections: [
      { kind: "about", title: "Il locale" },
      { kind: "services", title: "La proposta", requiresData: true },
      { kind: "hours", title: "Quando siamo aperti", requiresData: true },
      { kind: "reviews", title: "Recensioni Google", requiresData: true },
      { kind: "contact", title: "Prenotazioni e contatti" },
      { kind: "map", title: "Dove siamo", requiresData: true },
    ],
    palette: { primary: "#E8743B", accent: "#F5C26B", bg: "#14100E", fg: "#F6F1EC" },
    ctaLabels: { call: "Prenota al telefono", whatsapp: "Scrivi su WhatsApp", maps: "Come arrivare", email: "Scrivi una mail" },
    heroLead: "Cucina e accoglienza",
    servicesTitle: "La proposta",
    menuLabel: "Guarda il menu",
    headingCase: "normal",
  },
  bellezza: {
    id: "bellezza",
    label: "Bellezza e benessere",
    // Nella bellezza il servizio viene prima: si cerca "il trattamento".
    sections: [
      { kind: "services", title: "Trattamenti", requiresData: true },
      { kind: "about", title: "Il salone" },
      { kind: "hours", title: "Orari", requiresData: true },
      { kind: "reviews", title: "Recensioni Google", requiresData: true },
      { kind: "contact", title: "Prenota un appuntamento" },
      { kind: "map", title: "Dove siamo", requiresData: true },
    ],
    palette: { primary: "#D8709B", accent: "#F0C4D8", bg: "#161014", fg: "#F8F2F5" },
    ctaLabels: { call: "Prenota un appuntamento", whatsapp: "Prenota su WhatsApp", maps: "Come arrivare", email: "Scrivi una mail" },
    heroLead: "Cura e attenzione",
    servicesTitle: "Trattamenti",
    menuLabel: "Guarda il listino",
    headingCase: "normal",
  },
  salute: {
    id: "salute",
    label: "Salute",
    // Nella salute contano prestazioni e reperibilità, non l'atmosfera.
    sections: [
      { kind: "services", title: "Prestazioni", requiresData: true },
      { kind: "about", title: "Lo studio" },
      { kind: "hours", title: "Orari di apertura", requiresData: true },
      { kind: "contact", title: "Prenotazioni" },
      { kind: "map", title: "Come raggiungerci", requiresData: true },
      { kind: "reviews", title: "Recensioni Google", requiresData: true },
    ],
    palette: { primary: "#3FA7A0", accent: "#8FD6D1", bg: "#0E1616", fg: "#EEF7F6" },
    ctaLabels: { call: "Chiama lo studio", whatsapp: "Scrivi su WhatsApp", maps: "Come raggiungerci", email: "Scrivi una mail" },
    heroLead: "Professionalità e ascolto",
    servicesTitle: "Prestazioni",
    menuLabel: "Guarda le prestazioni",
    headingCase: "normal",
  },
  casa: {
    id: "casa",
    label: "Casa e impianti",
    // Per un artigiano contano cosa fa e dove lo fa. Il resto è rumore.
    sections: [
      { kind: "services", title: "Interventi", requiresData: true },
      { kind: "about", title: "Chi siamo" },
      { kind: "contact", title: "Richiedi un preventivo" },
      { kind: "hours", title: "Reperibilità", requiresData: true },
      { kind: "map", title: "Zona di lavoro", requiresData: true },
      { kind: "reviews", title: "Recensioni Google", requiresData: true },
    ],
    palette: { primary: "#4C7CC4", accent: "#9BBCE8", bg: "#0E1218", fg: "#EEF2F8" },
    ctaLabels: { call: "Chiama per un preventivo", whatsapp: "Scrivi su WhatsApp", maps: "Zona di lavoro", email: "Richiedi un preventivo" },
    heroLead: "Lavori fatti a regola",
    servicesTitle: "Interventi",
    menuLabel: "Guarda i servizi",
    headingCase: "upper",
  },
  auto: {
    id: "auto",
    label: "Auto e officine",
    sections: [
      { kind: "services", title: "Servizi in officina", requiresData: true },
      { kind: "about", title: "L'officina" },
      { kind: "hours", title: "Orari", requiresData: true },
      { kind: "contact", title: "Prenota un intervento" },
      { kind: "map", title: "Dove siamo", requiresData: true },
      { kind: "reviews", title: "Recensioni Google", requiresData: true },
    ],
    palette: { primary: "#C4453F", accent: "#E89A96", bg: "#161111", fg: "#F7F0EF" },
    ctaLabels: { call: "Chiama l'officina", whatsapp: "Scrivi su WhatsApp", maps: "Come arrivare", email: "Scrivi una mail" },
    heroLead: "Assistenza e ricambi",
    servicesTitle: "Servizi in officina",
    menuLabel: "Guarda i servizi",
    headingCase: "upper",
  },
  locale: {
    id: "locale",
    label: "Attività locale",
    sections: [
      { kind: "about", title: "Chi siamo" },
      { kind: "services", title: "Servizi", requiresData: true },
      { kind: "hours", title: "Orari", requiresData: true },
      { kind: "contact", title: "Contatti" },
      { kind: "map", title: "Dove siamo", requiresData: true },
      { kind: "reviews", title: "Recensioni Google", requiresData: true },
    ],
    palette: { primary: "#2FB4C9", accent: "#7FD9E6", bg: "#0D1316", fg: "#EDF6F8" },
    ctaLabels: { call: "Chiama", whatsapp: "Scrivi su WhatsApp", maps: "Come arrivare", email: "Scrivi una mail" },
    heroLead: "Al servizio del quartiere",
    servicesTitle: "Servizi",
    menuLabel: "Guarda il listino",
    headingCase: "normal",
  },
};

/** Categoria → template. Deterministico e testato: mai il modello. */
export function templateFor(category: string): VerticalTemplate {
  const c = (category || "").toLowerCase();
  if (/ristor|pizz|trattor|osteria|bar\b|caff|pub|birr|gelat|pasticc|forn|panific|rosticc|sushi|food|bakery|cafe|restaurant/.test(c)) {
    return TEMPLATES.ristorazione;
  }
  if (/parrucch|estet|barb|beauty|nail|unghie|benessere|spa\b|massag|solar|tatua|tattoo|hair|salon/.test(c)) {
    return TEMPLATES.bellezza;
  }
  if (/dentist|medic|fisioterap|odontoiatr|psicolog|nutrizion|farmac|ottic|veterinar|podolog|logoped|clinic|poliambulator|physician|health/.test(c)) {
    return TEMPLATES.salute;
  }
  if (/idraul|elettric|edil|muratore|serrament|infissi|imbianch|giardin|falegn|fabbr|clima|caldai|ristruttur|antincend|plumber|contractor/.test(c)) {
    return TEMPLATES.casa;
  }
  if (/autoffic|carrozzer|gommist|autolav|concessionar|autoricambi|revision|meccanic|automotive/.test(c)) {
    return TEMPLATES.auto;
  }
  return TEMPLATES.locale;
}

export function templateById(id: string): VerticalTemplate {
  return TEMPLATES[id as TemplateId] ?? TEMPLATES.locale;
}

export const ALL_TEMPLATES: VerticalTemplate[] = Object.keys(TEMPLATES).map(
  (k) => TEMPLATES[k as TemplateId],
);
