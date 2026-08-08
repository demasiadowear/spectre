// ============================================================
// AYRO SPECTRE — Zone hunt types (caccia porta-a-porta card NFC)
// ============================================================

/** Fascia di vendibilità della card NFC recensioni: "caldo" = ha
 *  fame di recensioni ed è un profilo reale (vendita facile),
 *  "gia_a_posto" = saturo di recensioni o servizio scadente. */
export type OpportunityTier = "caldo" | "tiepido" | "gia_a_posto";

export interface ZoneLead {
  id: string;
  name: string;
  /** Etichetta italiana del gruppo categoria (ristorazione, bellezza…). */
  category: string;
  address: string;
  phone: string;
  rating: number;
  reviews: number;
  /** Indice opportunità 0-100: in cima chi ha più BISOGNO di
   *  recensioni (compratore facile della card), in fondo i saturi. */
  score: number;
  tier: OpportunityTier;
  lat: number | null;
  lng: number | null;
  /** Scheda Google Maps (per aprire la pagina recensioni sul posto). */
  maps_url: string;
  /** Link g.page/…/review,5 pronto per il chip NFC (null = CID non
   *  ricavabile: mai un link costruito male su un pezzo fisico). */
  nfc_review_url: string | null;
  /** Stato nel registro clienti se già salvato (overlay caccia). */
  saved_status: ZoneClientStatus | null;
}

export interface ZoneHuntParams {
  lat: number;
  lng: number;
  /** Raggio in metri (clampato server-side). */
  radius: number;
}

export interface ZoneHuntResult {
  leads: ZoneLead[];
  count: number;
  /** Gruppi categoria la cui richiesta è fallita (parziale ≠ vuoto). */
  groups_failed: string[];
}

/** Filtri di una ricerca zona (serializzati nella cache). */
export interface ZoneSearchFilters {
  categories: string[];
  reviews_min?: number;
  reviews_max?: number;
  rating_min?: number;
  rating_max?: number;
}

/** Ricerca zona salvata (cache anti-spesa API). Metadati per l'elenco:
 *  i risultati completi si leggono con getZoneSearch(id). */
export interface ZoneSavedSearch {
  id: string;
  /** Etichetta (via/CAP digitato o CAP prevalente dei risultati). */
  label: string;
  lat: number;
  lng: number;
  radius: number;
  filters: ZoneSearchFilters;
  /** Numero di attività trovate (dalla cache). */
  count: number;
  created_at: string;
  updated_at: string;
}

/** Ricerca salvata coi risultati completi (per "Riapri" senza API). */
export interface ZoneSavedSearchFull extends ZoneSavedSearch {
  result: ZoneHuntResult;
}

// ============================================================
// Zone CRM — registro clienti del giro (persistito su Turso).
// ============================================================

export type ZoneClientStatus =
  | "da_visitare"
  | "visitato"
  | "venduto"
  | "non_interessato"
  | "da_richiamare";

export interface ZoneClient {
  id: string; // place_id Google
  name: string;
  category: string;
  address: string;
  /** CAP estratto dall'indirizzo (analisi per zona). */
  cap: string;
  phone: string;
  /** Numero WhatsApp del cliente per il report recensioni ('' = non
   *  impostato; in UI si precompila dal telefono Maps se presente). */
  whatsapp: string;
  lat: number | null;
  lng: number | null;
  maps_url: string;
  /** Link g.page/…/review,5 pronto per il chip ('' = non ricavabile). */
  nfc_review_url: string;
  rating: number;
  reviews: number;
  /** Etichetta giro manuale, es. "Poggiofranco". */
  zone_label: string;
  status: ZoneClientStatus;
  callback_at: string | null;
  referent: string;
  notes: string;
  // ----- Dati fatturazione (raccolti via OCR o a mano, sempre
  // confermati dall'utente prima del salvataggio) -----
  fatt_ragione_sociale: string;
  fatt_piva: string;
  fatt_cf: string;
  fatt_indirizzo: string;
  fatt_cap: string;
  fatt_citta: string;
  fatt_email: string;
  fatt_pec: string;
  fatt_sdi: string;
  fatt_telefono: string;
  /** '' = nessuna · 'richiesta' = fattura DA FARE (badge acceso) ·
   *  'fatturata' = emessa e inviata. */
  invoice_status: "" | "richiesta" | "fatturata";
  /** Recensioni al momento della PRIMA vendita (baseline delta upsell,
   *  null = mai venduto). Le vendite successive non la toccano. */
  reviews_at_sale: number | null;
  /** Ultimo aggiornamento del conteggio recensioni (scan o refresh). */
  reviews_updated_at: string | null;
  /** Conteggio recensioni PRIMA dell'ultimo aggiornamento (null = mai
   *  aggiornato due volte). reviews − reviews_prev = variazione. */
  reviews_prev: number | null;
  /** Crescita recensioni osservata tra gli snapshot (max−min).
   *  Valorizzata solo nel filtro "Alto flusso"; 0 altrove. */
  flow_growth?: number;
  // ----- Comodato (asse parallelo, come invoice_status) -----
  /** nessuno | attivo | ritirato | convertito */
  loan_status: ZoneLoanStatus;
  loan_started_at: string | null;
  /** Scadenza rivisita: partenza + 15 giorni. */
  loan_due_at: string | null;
  /** Recensioni al posizionamento del comodato (mai sovrascritta). */
  reviews_at_loan: number | null;
  created_at: string;
  updated_at: string;
}

export type ZoneLoanStatus = "nessuno" | "attivo" | "ritirato" | "convertito";

export interface ZoneProduct {
  id: string;
  name: string;
  default_price: number;
  active: boolean;
  /** Giacenza pezzi (movimentata da vendite/comodati/carichi). */
  stock_qty: number;
  /** Soglia sotto cui scatta l'alert scorte. */
  stock_soglia: number;
  fornitore: string;
  /** Costo unitario di acquisto (€). Editabile in anagrafica: cambia
   *  se cambiano i fornitori. Sui bundle è derivato dai componenti. */
  unit_cost: number;
}

export interface ZoneStockMove {
  id: number;
  product_id: string;
  /** Negativo = uscita, positivo = carico/rientro. */
  delta: number;
  motivo: "vendita" | "comodato" | "rientro" | "carico" | "rettifica";
  ref_id: string;
  ts: string;
  notes: string;
}

export interface ZoneReviewSnapshot {
  id: number;
  client_id: string;
  reviews: number;
  rating: number;
  taken_at: string;
  source: "scan" | "refresh";
}

export interface ZoneSale {
  id: string;
  client_id: string;
  product_id: string;
  product_name: string;
  qty: number;
  /** Incasso della riga (€). Omaggio => 0. */
  price: number;
  /** Costo unitario STORICIZZATO al salvataggio (€): il costo di
   *  allora resta fisso anche se domani cambia il costo in anagrafica.
   *  Costo totale riga = unit_cost × qty (anche per gli omaggi). */
  unit_cost: number;
  /** Agente/segnalatore della vendita ('' = vendita diretta). */
  agent_id: string;
  /** % provvigione STORICIZZATA al salvataggio (dall'agente di allora). */
  commission_pct: number;
  /** Provvigione della riga (€) = price × commission_pct / 100,
   *  arrotondata a 2 decimali. Sempre 0 sugli omaggi. */
  commission_amount: number;
  /** True = omaggio: prezzo 0 ma pezzo scaricato dalla giacenza. */
  omaggio: boolean;
  /** Raggruppa le righe di UNA stessa vendita. */
  group_id: string;
  sold_at: string;
  notes: string;
}

// ============================================================
// Agenti / segnalatori (tracking provvigioni). Single-user: sono
// solo un'anagrafica di riferimento, nessun ruolo/login.
// ============================================================

export interface ZoneAgent {
  id: string;
  nome: string;
  telefono: string;
  /** % provvigione applicata alle NUOVE vendite (default 25, editabile
   *  per singolo agente). Le vendite già fatte tengono lo snapshot. */
  commission_pct: number;
  attivo: boolean;
  note: string;
  created_at: string;
  updated_at: string;
}

/** Riga vendita nel dettaglio provvigioni di un agente. */
export interface CommissionSaleRow {
  sold_at: string;
  client_name: string;
  product_name: string;
  qty: number;
  price: number;
  commission_pct: number;
  commission_amount: number;
  omaggio: boolean;
}

/** Aggregato provvigioni per agente in un periodo. */
export interface CommissionAgentRow {
  id: string;
  nome: string;
  telefono: string;
  attivo: boolean;
  n_vendite: number;
  pezzi: number;
  omaggi: number;
  totale_venduto: number;
  provvigione: number;
  media_per_vendita: number;
  pagata: boolean;
  sales: CommissionSaleRow[];
}

export interface CommissionReport {
  periodo_start: string;
  periodo_end: string;
  agents: CommissionAgentRow[];
}

export type ZoneCardStatus = "attiva" | "in_comodato" | "sostituita" | "dismessa";

export interface ZoneCard {
  code: string;
  client_id: string;
  sale_id: string;
  status: ZoneCardStatus;
  assigned_at: string;
  notes: string;
}

/** Scheda cliente completa (registro). */
export interface ZoneClientDetail extends ZoneClient {
  sales: ZoneSale[];
  cards: ZoneCard[];
  /** Ultimi snapshot recensioni (storico delta), più recenti prima. */
  snapshots: ZoneReviewSnapshot[];
  /** Rating al momento della prima vendita (dal primo snapshot 'scan' o
   *  dal primo snapshot <= data prima vendita). null se non ricavabile. */
  rating_at_sale: number | null;
}

/** Analisi dai dati salvati. */
export interface ZoneStats {
  clients_total: number;
  by_status: Record<ZoneClientStatus, number>;
  revenue_total: number;
  /** Somma dei costi di tutto il venduto (omaggi inclusi). */
  cost_total: number;
  /** Utile reale = fatturato − costi. */
  profit_total: number;
  /** Margine % sul fatturato (0 se fatturato 0). */
  margin_pct: number;
  sales_count: number;
  /** Card fisiche consegnate ai clienti (ricavate dalle vendite,
   *  omaggi inclusi) — non dai codici card registrati a mano. */
  cards_active: number;
  /** Conversione visitati->venduti: venduto / (visitato+venduto+non_interessato). */
  conversion_pct: number;
  /** Aggregato per zona (CAP o etichetta giro). */
  by_zone: {
    zone: string;
    clients: number;
    sold: number;
    revenue: number;
    conversion_pct: number;
  }[];
  /** Da richiamare, scaduti prima. */
  callbacks: Pick<ZoneClient, "id" | "name" | "phone" | "callback_at" | "notes">[];
  /** Classifica recensioni/giorno (AyroStar): clienti venduti ordinati
   *  per media giornaliera di recensioni guadagnate dalla vendita. */
  daily_reviews: {
    id: string;
    name: string;
    category: string;
    zone: string;
    delta: number;
    days: number;
    per_day: number;
  }[];
}
