// ============================================================
// Gruppi categoria della caccia Zone — modulo CLIENT-SAFE (nessun
// import server): usato sia dalla Nearby Search lato server sia
// dalle checkbox filtri lato client. Tipi Places API (New) Table A.
// ============================================================

export const ZONE_TYPE_GROUPS: { label: string; types: string[] }[] = [
  { label: "ristorazione", types: ["restaurant", "pizza_restaurant", "fast_food_restaurant"] },
  { label: "bar & caffè", types: ["bar", "cafe", "bakery", "ice_cream_shop"] },
  { label: "bellezza", types: ["hair_salon", "beauty_salon", "barber_shop", "nail_salon", "spa"] },
  { label: "salute", types: ["dentist", "physiotherapist", "veterinary_care"] },
  { label: "negozi", types: ["clothing_store", "shoe_store", "jewelry_store", "florist", "gift_shop"] },
  { label: "casa & tech", types: ["home_goods_store", "electronics_store", "hardware_store", "furniture_store"] },
  { label: "auto & moto", types: ["car_repair", "car_wash", "car_dealer"] },
  { label: "sport & animali", types: ["gym", "book_store", "pet_store"] },
  { label: "ospitalità", types: ["hotel", "bed_and_breakfast"] },
];

export const ZONE_CATEGORY_LABELS = ZONE_TYPE_GROUPS.map((g) => g.label);
