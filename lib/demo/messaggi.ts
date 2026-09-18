import type { CuratelaProgetto, EsitoValidazione } from "./curatela";

// ============================================================
// Che cosa legge l'operatore quando una proposta non vale piu.
//
// Stanno in un modulo perche sono la parte del sistema che decide se
// una persona capisce cosa e successo o preme «riprova» a caso. Un
// «proposta non valida» generico costa un'analisi rifatta per un
// motivo che nessuno ha guardato.
//
// Ogni messaggio dice DUE cose: cos'e successo, e cosa fare adesso.
// Nessuno dice «errore».
// ============================================================

export interface Messaggio {
  testo: string;
  /** true = si puo ancora approvare. Le fotografie nuove non bloccano:
   *  segnalano. */
  bloccante: boolean;
}

/**
 * Il messaggio per un esito di validazione.
 *
 * `apertura` cambia la frase, non la sostanza: la fotografia in
 * apertura e la prima cosa che il prospect vede, e dirle «una
 * fotografia» quando e QUELLA fa cercare nel posto sbagliato.
 */
export function messaggioValidazione(
  v: EsitoValidazione,
  c: CuratelaProgetto | null,
): Messaggio {
  if (v.stato === "assente") {
    return {
      testo: "Non c'è ancora una proposta: esegui l'analisi delle fotografie.",
      bloccante: true,
    };
  }
  if (v.stato === "valida") {
    if (!v.outdated) return { testo: "", bloccante: false };
    return {
      testo: v.nuove === 1
        ? "C'è una fotografia nuova che nessuno ha ancora guardato. Puoi approvare comunque."
        : `Ci sono ${v.nuove} fotografie nuove che nessuno ha ancora guardato. Puoi approvare comunque.`,
      bloccante: false,
    };
  }

  const apertura = eApertura(c, v.candidate_id);
  switch (v.motivo) {
    case "foto_scomparsa":
      return {
        testo: apertura
          ? "La fotografia in apertura non è più disponibile. Riesegui l'analisi."
          : "Una fotografia scelta non è più disponibile. Riesegui l'analisi.",
        bloccante: true,
      };
    case "non_piu_mostrabile":
      return {
        testo: apertura
          ? "La fotografia in apertura non è più utilizzabile nella demo. Riesegui l'analisi."
          : "Questa fotografia non è più utilizzabile nella demo. Riesegui l'analisi.",
        bloccante: true,
      };
    case "attribuzione_cambiata":
      return {
        // L'attribuzione e la riga stampata sotto l'immagine: se cambia
        // e nessuno se ne accorge, resta stampato il nome sbagliato.
        testo: "L'attribuzione della fotografia è cambiata: riesegui l'analisi.",
        bloccante: true,
      };
    case "regime_diritti_cambiato":
      return {
        testo: "Il regime dei diritti di una fotografia è cambiato: riesegui l'analisi.",
        bloccante: true,
      };
    default:
      return { testo: "La proposta non è più valida: riesegui l'analisi.", bloccante: true };
  }
}

function eApertura(c: CuratelaProgetto | null, candidate_id: string): boolean {
  if (!c || !candidate_id) return false;
  return c.scelte.some((s) => s.candidate_id === candidate_id && s.layout_role === "hero");
}

/** Cosa manca perche la pubblicazione possa avvenire. Vuoto = niente. */
export function messaggioPubblicazione(mancanti: number, aperturaMancante: boolean): string {
  if (aperturaMancante) {
    return "La fotografia in apertura approvata non è più disponibile: la pagina è online senza apertura fotografica. Non ne è stata messa un'altra al suo posto.";
  }
  if (mancanti === 1) return "Una fotografia approvata non è più disponibile: la pagina la salta.";
  if (mancanti > 1) return `${mancanti} fotografie approvate non sono più disponibili: la pagina le salta.`;
  return "";
}
