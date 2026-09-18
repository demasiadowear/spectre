import { ENV_GOOGLE } from "@/lib/collector/capability";

// ============================================================
// Il punteggio Google, recuperato adesso.
//
// Non e un fatto del dossier e non va congelato nel codice: un 4,8 con
// 93 recensioni e vero il giorno in cui lo si legge. Scritto in una
// pagina, fra sei mesi e un numero che afferma qualcosa di falso sotto
// il nome del cliente — e nessuno se ne accorge, perche un numero non
// sembra mai scaduto.
//
// Quindi si chiede al provider a ogni richiesta, con una FieldMask di
// due campi soli. Se non risponde, o risponde senza punteggio, la
// funzione restituisce `null` e il blocco sparisce dalla pagina: una
// riga in meno e meglio di una riga che mente.
// ============================================================

export interface Recensioni {
  punteggio: number;
  totale: number;
}

/** Due campi: e tutto quello che serve, e una FieldMask stretta e
 *  anche quello che tiene bassa la spesa. */
const MASK = "rating,userRatingCount";

export async function recensioniLive(
  placeId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Recensioni | null> {
  const chiave = (env[ENV_GOOGLE] ?? "").trim();
  if (!chiave || !placeId) return null;

  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          "X-Goog-Api-Key": chiave,
          "X-Goog-FieldMask": MASK,
          "Accept-Language": "it",
        },
        // Il valore non si congela, ma nemmeno si ripaga a ogni
        // ricaricamento: cinque minuti sono abbastanza perche resti
        // vero e abbastanza poco perche non diventi un dato nostro.
        next: { revalidate: 300 },
      },
    );
    if (!res.ok) return null;

    const j = (await res.json()) as { rating?: unknown; userRatingCount?: unknown };
    const punteggio = typeof j.rating === "number" ? j.rating : NaN;
    const totale = typeof j.userRatingCount === "number" ? j.userRatingCount : NaN;

    // Un punteggio senza conteggio non e prova sociale: «4,8» da solo
    // non dice se lo dicono novantatre persone o una.
    if (!Number.isFinite(punteggio) || !Number.isFinite(totale) || totale <= 0) return null;
    return { punteggio, totale };
  } catch {
    // Niente dettagli: il messaggio del provider puo contenere l'URL
    // con la chiave in query.
    return null;
  }
}
