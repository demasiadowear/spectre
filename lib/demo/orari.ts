// ============================================================
// «Aperto ora» calcolato dagli orari verificati, non dichiarato.
//
// Due trappole, e sono entrambe di fuso orario.
//
// La prima: il server sta a Washington (iad1). `new Date().getDay()`
// li dice «domenica» mentre a Bari e gia lunedi mattina, e il sito
// direbbe «chiuso» a un'attivita aperta. Si legge l'ora in
// Europe/Rome con Intl, non con l'ora locale del processo.
//
// La seconda: l'ora legale. Bari e UTC+1 d'inverno e UTC+2 d'estate.
// Un offset fisso funziona per meta anno e poi sbaglia di un'ora
// esatta — l'errore piu difficile da notare, perche la pagina non
// sembra rotta: sembra solo che l'attivita apra alle 10 invece che
// alle 9. `Intl.DateTimeFormat` conosce le regole; una costante no.
// ============================================================

export const FUSO = "Europe/Rome";

/** I giorni come li scrive Places, in italiano e minuscolo. */
export const GIORNI = [
  "domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato",
] as const;

export interface RigaOrario {
  giorno: string;
  /** Righe come "09:00–19:00". Vuoto = chiuso. */
  intervalli: { apre: number; chiude: number }[];
  chiuso: boolean;
  /** Il testo originale del dossier, per mostrarlo tale e quale. */
  testo: string;
}

export type StatoApertura =
  | { stato: "aperto"; fino: string }
  | { stato: "chiuso"; riapre: string }
  | { stato: "sconosciuto" };

/** "lunedì: 11:00–19:00" -> struttura. Accetta il trattino lungo che
 *  Places usa davvero (–), non solo quello da tastiera. */
export function leggiRiga(testo: string): RigaOrario | null {
  const m = /^\s*([^:]+):\s*(.+)$/.exec(testo);
  if (!m) return null;
  const giorno = m[1].trim().toLowerCase();
  const resto = m[2].trim();

  if (/^chiuso$/i.test(resto)) {
    return { giorno, intervalli: [], chiuso: true, testo };
  }

  const intervalli: { apre: number; chiude: number }[] = [];
  const re = /(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/g;
  for (let x = re.exec(resto); x; x = re.exec(resto)) {
    intervalli.push({
      apre: Number(x[1]) * 60 + Number(x[2]),
      chiude: Number(x[3]) * 60 + Number(x[4]),
    });
  }
  if (intervalli.length === 0) return null;
  return { giorno, intervalli, chiuso: false, testo };
}

export function leggiOrari(righe: readonly string[]): RigaOrario[] {
  const out: RigaOrario[] = [];
  for (const r of righe) {
    const x = leggiRiga(r);
    if (x) out.push(x);
  }
  return out;
}

/** Giorno della settimana e minuti dall'inizio, a Bari. */
export function adessoARoma(adesso: Date = new Date()): { giorno: number; minuti: number } {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: FUSO, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = f.formatToParts(adesso);
  const val = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const g = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(val("weekday"));
  // `hour` puo essere "24" a mezzanotte con hour12:false su alcune
  // implementazioni: si riporta a 0 invece di produrre 1440.
  const ore = Number(val("hour")) % 24;
  return { giorno: g < 0 ? 0 : g, minuti: ore * 60 + Number(val("minute")) };
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * Aperto adesso? E se no, quando riapre?
 *
 * Restituisce `sconosciuto` quando gli orari non si leggono, invece di
 * ripiegare su «chiuso»: dire a un cliente che un'attivita e chiusa
 * quando e aperta e peggio che non dirgli niente.
 */
export function statoApertura(
  righe: readonly string[],
  adesso: Date = new Date(),
): StatoApertura {
  const orari = leggiOrari(righe);
  if (orari.length === 0) return { stato: "sconosciuto" };

  const { giorno, minuti } = adessoARoma(adesso);
  const perGiorno = (i: number) =>
    orari.find((o) => o.giorno === GIORNI[((i % 7) + 7) % 7]);

  const oggi = perGiorno(giorno);
  if (oggi && !oggi.chiuso) {
    const dentro = oggi.intervalli.find((x) => minuti >= x.apre && minuti < x.chiude);
    if (dentro) return { stato: "aperto", fino: hhmm(dentro.chiude) };
    const dopo = oggi.intervalli.filter((x) => x.apre > minuti).sort((a, b) => a.apre - b.apre)[0];
    if (dopo) return { stato: "chiuso", riapre: `oggi alle ${hhmm(dopo.apre)}` };
  }

  // Il primo giorno successivo con un'apertura. Si guardano sette
  // giorni e non uno: un'attivita chiusa sabato E domenica riapre
  // lunedi, e «riapre domani» sarebbe falso.
  for (let d = 1; d <= 7; d++) {
    const r = perGiorno(giorno + d);
    if (!r || r.chiuso || r.intervalli.length === 0) continue;
    const apre = r.intervalli.slice().sort((a, b) => a.apre - b.apre)[0];
    const quando = d === 1 ? "domani" : r.giorno;
    return { stato: "chiuso", riapre: `${quando} alle ${hhmm(apre.apre)}` };
  }
  return { stato: "sconosciuto" };
}
