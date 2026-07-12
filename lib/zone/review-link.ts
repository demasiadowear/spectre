// ============================================================
// Link recensioni per il chip NFC — formato UFFICIALE Google:
//   https://search.google.com/local/writereview?placeid=<PLACE_ID>
// Un tap: si apre il form recensione (stelle + testo). Le stelle le
// sceglie il cliente: NESSUN formato le preseleziona — il vecchio
// trucco g.page/…/review,5 oggi dà 404 (verificato sul campo e nei
// thread ufficiali Google sui tag NFC rotti), e comunque un voto
// preimpostato violerebbe le policy recensioni (rischio flag sul
// profilo del cliente). Il place_id ce l'ha ogni risultato di scan,
// quindi il link è SEMPRE costruibile.
// ============================================================

export const WRITEREVIEW_BASE =
  "https://search.google.com/local/writereview?placeid=";

export function nfcReviewUrl(placeId: string): string {
  return `${WRITEREVIEW_BASE}${encodeURIComponent(placeId)}`;
}
