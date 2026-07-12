// ============================================================
// Validazione dati fiscali italiani — la rete di sicurezza sotto
// l'OCR: P.IVA e Codice Fiscale hanno cifre/caratteri di CONTROLLO,
// quindi una lettura sbagliata (un 8 letto come 3) si becca con la
// matematica, non con la fiducia. Niente si salva senza conferma
// umana: questi check decidono solo quali campi evidenziare.
// ============================================================

/** Partita IVA: 11 cifre + checksum (variante Luhn).
 *  Posizioni dispari sommate; pari raddoppiate (−9 se >9);
 *  l'11ª cifra chiude la somma a multiplo di 10. */
export function isValidPartitaIva(raw: string): boolean {
  const piva = raw.replace(/\s/g, "");
  if (!/^\d{11}$/.test(piva)) return false;
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const d = piva.charCodeAt(i) - 48;
    if (i % 2 === 0) {
      sum += d; // posizioni 1,3,5,7,9,11 (indice pari)
    } else {
      const t = d * 2;
      sum += t > 9 ? t - 9 : t;
    }
  }
  return sum % 10 === 0;
}

// Tabelle ufficiali per il carattere di controllo del CF.
const CF_ODD: Record<string, number> = {
  "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};
const CF_EVEN: Record<string, number> = {
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9, K: 10, L: 11, M: 12,
  N: 13, O: 14, P: 15, Q: 16, R: 17, S: 18, T: 19, U: 20, V: 21, W: 22, X: 23, Y: 24, Z: 25,
};

/** Codice fiscale persona fisica: 16 caratteri + carattere di
 *  controllo. Per i CF numerici (ditte individuali con sola P.IVA)
 *  vale il check P.IVA. */
export function isValidCodiceFiscale(raw: string): boolean {
  const cf = raw.replace(/\s/g, "").toUpperCase();
  if (/^\d{11}$/.test(cf)) return isValidPartitaIva(cf); // CF numerico = P.IVA
  if (!/^[A-Z0-9]{16}$/.test(cf)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = cf[i];
    // posizione 1-based: dispari usa CF_ODD, pari CF_EVEN
    sum += (i % 2 === 0 ? CF_ODD : CF_EVEN)[ch] ?? NaN;
  }
  if (Number.isNaN(sum)) return false;
  const expected = String.fromCharCode(65 + (sum % 26));
  return cf[15] === expected;
}

export function isValidSdi(raw: string): boolean {
  return /^[A-Z0-9]{7}$/i.test(raw.replace(/\s/g, ""));
}

export function isValidCap(raw: string): boolean {
  return /^\d{5}$/.test(raw.replace(/\s/g, ""));
}

export function isValidEmailish(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
}

export interface BillingFields {
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
}

export interface FieldWarning {
  field: keyof BillingFields;
  message: string;
}

/** Valida i campi estratti dall'OCR: torna gli avvisi da mostrare in
 *  rosso (campo presente ma sospetto). I campi vuoti non avvisano. */
export function validateBilling(f: Partial<BillingFields>): FieldWarning[] {
  const w: FieldWarning[] = [];
  if (f.fatt_piva && !isValidPartitaIva(f.fatt_piva)) {
    w.push({ field: "fatt_piva", message: "checksum P.IVA NON valido: ricontrolla le cifre" });
  }
  if (f.fatt_cf && !isValidCodiceFiscale(f.fatt_cf)) {
    w.push({ field: "fatt_cf", message: "carattere di controllo CF non valido: ricontrolla" });
  }
  if (f.fatt_sdi && !isValidSdi(f.fatt_sdi)) {
    w.push({ field: "fatt_sdi", message: "codice SDI: attesi 7 caratteri alfanumerici" });
  }
  if (f.fatt_cap && !isValidCap(f.fatt_cap)) {
    w.push({ field: "fatt_cap", message: "CAP: attese 5 cifre" });
  }
  if (f.fatt_email && !isValidEmailish(f.fatt_email)) {
    w.push({ field: "fatt_email", message: "email in formato sospetto" });
  }
  if (f.fatt_pec && !isValidEmailish(f.fatt_pec)) {
    w.push({ field: "fatt_pec", message: "PEC in formato sospetto" });
  }
  return w;
}
