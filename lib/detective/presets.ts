// ============================================================
// DETECTIVE — preset selezionabili per lo scout audit.
// File client-safe (zero import server): viene usato sia dal
// form in dashboard che da lib/detective/scout.ts come default.
// Default = comportamento v1 (saloni/estetica, Bari/provincia):
// un click senza modifiche al form replica la v1 esatta.
// ============================================================

/** Chips categoria proposte nel form (query Places in italiano). */
export const AUDIT_CATEGORY_PRESETS = [
  "parrucchiere",
  "centro estetico",
  "salone di bellezza",
  "ristorante",
  "lido balneare",
  "enoteca",
  "dentista",
  "tatuatore",
  "commercialista",
  "palestra",
] as const;

/** Località proposte nel form — le 10 di Bari/provincia (stesse dell'Autopilot). */
export const AUDIT_LOCATION_PRESETS = [
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

/** Default v1: verticale salone/estetica. */
export const DEFAULT_AUDIT_CATEGORIES: string[] = [
  "parrucchiere",
  "centro estetico",
  "salone di bellezza",
];

/** Default v1: le 6 località della prima run. */
export const DEFAULT_AUDIT_LOCATIONS: string[] = [
  "Bari",
  "Modugno",
  "Bitonto",
  "Molfetta",
  "Triggiano",
  "Giovinazzo",
];

/** Target inserimenti per run (tetto, non garanzia). */
export const DEFAULT_AUDIT_LIMIT = 15;

/** Clamp di sicurezza sul numero risultati richiesto. */
export const AUDIT_LIMIT_MIN = 1;
export const AUDIT_LIMIT_MAX = 50;
