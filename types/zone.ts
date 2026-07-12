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
