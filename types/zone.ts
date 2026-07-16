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
  /** Incasso totale della riga (€). */
  price: number;
  sold_at: string;
  notes: string;
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
}

/** Analisi dai dati salvati. */
export interface ZoneStats {
  clients_total: number;
  by_status: Record<ZoneClientStatus, number>;
  revenue_total: number;
  sales_count: number;
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
}
