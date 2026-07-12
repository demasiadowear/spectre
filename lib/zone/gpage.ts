// ============================================================
// Link recensioni g.page per NFC — formato testato sul campo:
//   https://g.page/r/<ID>/review,5   (5 stelle preselezionate)
//
// L'<ID> non è il place_id: è il CID del profilo Google Business
// impacchettato in un protobuf e codificato base64url:
//   0x09 (campo 1, fixed64) + CID little-endian (8 byte) + 0x10 0x13
// Verificato con roundtrip sul link reale di Bonega:
//   CID 15134720485242106183 <-> CUfxrhkYVAnSEBM
// Il CID arriva gratis dallo scan: googleMapsUri della Places API
// (New) è nella forma https://maps.google.com/?cid=<CID>.
// ============================================================

/** Estrae il CID da googleMapsUri (null se il formato non è ?cid=). */
export function cidFromGoogleMapsUri(uri: string): bigint | null {
  const m = /[?&]cid=(\d{5,25})(?:&|$)/.exec(uri);
  if (!m) return null;
  try {
    const cid = BigInt(m[1]);
    // fixed64: fuori range = URI malformato, meglio nessun link.
    const max = BigInt("18446744073709551615"); // 2^64 - 1
    return cid > BigInt(0) && cid <= max ? cid : null;
  } catch {
    return null;
  }
}

/** Codifica il CID nell'ID g.page (base64url del protobuf). */
export function gpageIdFromCid(cid: bigint): string {
  const buf = Buffer.alloc(11);
  buf[0] = 0x09;
  buf.writeBigUInt64LE(cid, 1);
  buf[9] = 0x10;
  buf[10] = 0x13;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Link recensioni pronto per il chip NFC (o null se CID non
 *  ricavabile — mai un link costruito male su un pezzo fisico). */
export function nfcReviewUrl(googleMapsUri: string, stars = 5): string | null {
  const cid = cidFromGoogleMapsUri(googleMapsUri);
  if (cid === null) return null;
  return `https://g.page/r/${gpageIdFromCid(cid)}/review,${stars}`;
}
