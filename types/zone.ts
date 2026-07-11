// ============================================================
// AYRO SPECTRE — Zone hunt types (caccia porta-a-porta card NFC)
// ============================================================

/** Quanto l'attività è "attenta alle recensioni" (proxy da dati
 *  Places: volume recensioni + voto — le risposte del titolare non
 *  sono esposte dall'API). */
export type CareTier = "molto_attento" | "attento" | "tiepido";

export interface ZoneLead {
  id: string;
  name: string;
  /** Etichetta italiana del gruppo categoria (ristorazione, bellezza…). */
  category: string;
  address: string;
  phone: string;
  rating: number;
  reviews: number;
  /** Indice attenzione recensioni 0-100 (ordinamento discendente). */
  care_score: number;
  care_tier: CareTier;
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
