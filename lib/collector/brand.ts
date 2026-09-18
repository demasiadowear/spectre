import { SEGNALI_FORTI } from "@/types/dossier";
import type {
  BrandCandidate, BrandIdentity, BrandOverall, BrandRejection,
  FontiBrand, IdentitySignal, MotivoBlocco,
} from "@/types/dossier";

// ============================================================
// L'identita visiva originale dell'attivita: logo, insegna,
// monogramma, marchio testuale, favicon, colori.
//
// PERCHE SERVE UNA FASE APPOSTA. Un sito costruito senza il marchio
// del cliente non e il sito del cliente: e un modello con il suo nome
// sopra. E il modo piu rapido di sbagliare non e non trovare il logo —
// e trovarne uno che sembra giusto.
//
// I QUATTRO FALSI LOGO, in ordine di quanto sono convincenti:
//
//  1. L'OMONIMO. «Collateral Beauty» e un film del 2016. Una ricerca
//     sul nome restituisce la locandina, e la locandina e un'immagine
//     bellissima e completamente sbagliata. Lo abbiamo gia visto sui
//     social: quattro candidati su quattro erano il film e due canali
//     televisivi. Un nome che coincide non e un segnale, e una
//     coincidenza.
//  2. L'ICONA DI CATEGORIA. Places serve `iconMaskBaseUri`: un pin
//     generico per «centro estetico». E servito dal profilo
//     dell'attivita, quindi sembra suo. Non lo e: e di Google, ed e
//     uguale per tutti i centri estetici del mondo.
//  3. IL MARCHIO DI PIATTAFORMA. L'avatar di un profilo che non e
//     stato confermato, o peggio il logo di Facebook accanto a esso.
//  4. IL MARCHIO DI PRODOTTO. In un centro estetico c'e sempre un
//     marchio di cosmetici ben visibile. Non e l'insegna: e un
//     fornitore, e pubblicarlo come identita del cliente e un errore
//     che si paga con il cliente.
//
// E il quinto, che e nostro: il WORDMARK GENERATO. Se disegniamo il
// nome con una bella tipografia, quello non e il suo logo. Puo essere
// un ottimo trattamento editoriale, ma va chiamato con il suo nome.
// ============================================================

/** Un'entita che porta lo stesso nome ma non e l'attivita. Non e un
 *  elenco di titoli: sono le PAROLE che accompagnano un'opera quando
 *  si parla di essa, in italiano e in inglese. */
const SEGNI_DI_OPERA = new RegExp([
  "\\bfilm\\b", "\\bmovie\\b", "\\btrailer\\b", "\\bcast\\b", "\\bregia\\b",
  "\\bsoundtrack\\b", "\\bcolonna sonora\\b", "\\bromanzo\\b", "\\blibro\\b",
  "\\bbook\\b", "\\balbum\\b", "\\bcanzone\\b", "\\bsingolo\\b", "\\bepisodio\\b",
  "\\bserie\\b", "\\bimdb\\b", "\\brotten ?tomatoes\\b", "\\bmymovies\\b",
  "\\bstasera in tv\\b", "\\bin onda\\b", "\\bstreaming\\b", "\\bnetflix\\b",
  "\\bmediaset\\b", "\\bwill smith\\b", "\\blocandina\\b", "\\bposter\\b",
].join("|"), "i");

/** Host che non ospitano mai il logo di un centro estetico barese. */
const HOST_DI_OPERA = /(imdb|themoviedb|rottentomatoes|mymovies|comingsoon|filmtv|justwatch|wikipedia|wikimedia|mediaset|rai|netflix|primevideo|spotify|discogs)\./i;

/** Marchi di piattaforma: compaiono ovunque e non sono di nessuno. */
const MARCHI_PIATTAFORMA = /(facebook|instagram|tiktok|youtube|linkedin|whatsapp|google|maps\.gstatic|gstatic\.com\/images\/branding)/i;

/** L'icona di categoria di Places, servita dal profilo dell'attivita e
 *  quindi facilissima da scambiare per il suo logo. */
const ICONA_CATEGORIA = /(iconmaskbaseuri|maps\.gstatic\.com\/mapfiles|\/place_api\/icons\/)/i;

/** Marchi di cosmetici e attrezzature: in un centro estetico ce n'e
 *  sempre uno ben visibile, e non e l'insegna. */
const MARCHI_PRODOTTO = /\b(l'?oreal|loreal|schwarzkopf|wella|kerastase|dermalogica|comfort ?zone|bioline|thalgo|guinot|matis|collistar|estetic ?house|maletti|lemi|nilo)\b/i;

export interface ContestoBrand {
  /** Il nome esatto dell'attivita. */
  nome: string;
  citta: string;
  indirizzo: string;
  /** Il nome della titolare, quando il nome dell'insegna lo contiene:
   *  «di Rosita Buonsante» e un ancoraggio fortissimo, perche un film
   *  omonimo non lo porta mai. */
  titolare: string;
  official_host: string;
}

const normalizza = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Il testo che accompagna un candidato contiene un ancoraggio a
 *  QUESTA attivita, e non solo il nome? */
export function haAncoraggio(testo: string, ctx: ContestoBrand): boolean {
  const t = normalizza(testo);
  if (!t) return false;
  const ancore = [ctx.citta, ctx.titolare]
    .concat((ctx.indirizzo || "").split(",")[0] ?? "")
    .map(normalizza)
    .filter((x) => x.length >= 4);
  return ancore.some((a) => t.indexOf(a) !== -1);
}

/**
 * Il candidato e un'entita omonima?
 *
 * La regola generalizza oltre questo caso: qualunque nome che coincide
 * con un'opera o con un marchio esistente produce candidati che
 * superano ogni controllo basato sul nome. L'unica difesa e pretendere
 * un ancoraggio al LUOGO o alla PERSONA, che un'opera non ha.
 */
export function eOmonimo(c: {
  source_url?: string; detected_text?: string; contesto_testo?: string;
}, ctx: ContestoBrand): boolean {
  const insieme = `${c.source_url ?? ""} ${c.detected_text ?? ""} ${c.contesto_testo ?? ""}`;
  if (HOST_DI_OPERA.test(c.source_url ?? "")) return true;
  if (!SEGNI_DI_OPERA.test(insieme)) return false;
  // Segni d'opera piu un ancoraggio vero: puo essere un articolo che
  // parla dell'attivita citando il film da cui prende il nome.
  return !haAncoraggio(insieme, ctx);
}

/** Perche questo candidato va respinto, se va respinto. */
export function motivoRifiuto(
  c: Partial<BrandCandidate> & { contesto_testo?: string },
  ctx: ContestoBrand,
): BrandRejection {
  const url = c.source_url ?? "";
  if (ICONA_CATEGORIA.test(url)) return "category_icon";
  if (MARCHI_PIATTAFORMA.test(url) && !c.provider_reference) return "platform_asset";
  if (eOmonimo({ source_url: url, detected_text: c.detected_text, contesto_testo: c.contesto_testo }, ctx)) {
    return "homonym_entity";
  }
  if (MARCHI_PRODOTTO.test(`${c.detected_text ?? ""} ${c.contesto_testo ?? ""}`)) {
    return "product_brand";
  }
  if (c.rights_status === "unknown" || c.rights_status === "forbidden") return "no_rights";
  return "";
}

const forti = (s: readonly IdentitySignal[]) =>
  s.filter((x) => SEGNALI_FORTI.indexOf(x) !== -1).length;

/**
 * Lo stato di un candidato.
 *
 * `confirmed` richiede una PROVENIENZA forte, non un punteggio alto:
 *
 *  - servito dal sito ufficiale verificato, oppure
 *  - avatar di un profilo social gia `confirmed`, oppure
 *  - due segnali forti indipendenti, oppure
 *  - fotografia del proprietario su Places con insegna leggibile che
 *    riporta il nome E un ancoraggio al luogo o alla persona.
 *
 * Nome simile, OCR parziale o «l'ha trovato la ricerca» non arrivano
 * mai a `confirmed`. E la stessa soglia dei profili social, e non si
 * abbassa perche qui l'oggetto e un'immagine.
 */
export function valutaCandidato(
  c: Partial<BrandCandidate> & { contesto_testo?: string; da_social_confermato?: boolean },
  ctx: ContestoBrand,
): { status: BrandCandidate["status"]; rejection_reason: BrandRejection; confidence: number } {
  const rifiuto = motivoRifiuto(c, ctx);
  if (rifiuto) return { status: "rejected", rejection_reason: rifiuto, confidence: 0 };

  const segnali = c.identity_signals ?? [];
  const nForti = forti(segnali);

  // 1. Dal sito ufficiale verificato.
  const daSito = c.source_type === "official_site" || c.source_type === "site_structured"
    || c.source_type === "site_meta";
  if (daSito && ctx.official_host) {
    return { status: "confirmed", rejection_reason: "", confidence: 95 };
  }
  // 2. Avatar di un social confermato.
  if (c.da_social_confermato && c.source_type === "social_profile") {
    return { status: "confirmed", rejection_reason: "", confidence: 92 };
  }
  // 3. Due segnali forti indipendenti.
  if (nForti >= 2) return { status: "confirmed", rejection_reason: "", confidence: 88 };

  // 4. Insegna in una fotografia del proprietario, con ancoraggio.
  const insegna = c.kind === "signage" && c.source_type === "google_places";
  const testoAncorato = haAncoraggio(`${c.detected_text ?? ""} ${c.contesto_testo ?? ""}`, ctx);
  const nomeLetto = normalizza(c.detected_text ?? "").indexOf(normalizza(ctx.nome).split(" ")[0]) !== -1;
  if (insegna && nomeLetto && testoAncorato) {
    return { status: "confirmed", rejection_reason: "", confidence: 85 };
  }
  if (insegna && nomeLetto) {
    // Il nome si legge ma niente lo lega a QUESTO luogo: e proprio il
    // caso dell'omonimo che ha un'insegna da qualche altra parte.
    return { status: "needs_review", rejection_reason: "", confidence: 55 };
  }

  // Un segnale forte solo: probabile, non provato.
  if (nForti === 1) return { status: "probable", rejection_reason: "", confidence: 65 };
  // Avatar di un profilo NON confermato: non si pubblica senza che
  // qualcuno guardi. Non e rifiutato — potrebbe benissimo essere suo.
  if (c.source_type === "social_profile") {
    return { status: "needs_review", rejection_reason: "", confidence: 45 };
  }
  return { status: "rejected", rejection_reason: "too_weak", confidence: 20 };
}

/** Fonti applicabili che nessuno ha ancora interrogato. Una fonte che
 *  NON ESISTE — un sito che non c'e, zero social confermati — non e in
 *  questo elenco: non c'e niente da chiedere, e tenerla aperta
 *  bloccherebbe il progetto per sempre. */
export function fontiAperte(f: FontiBrand): (keyof FontiBrand)[] {
  return (Object.keys(f) as (keyof FontiBrand)[]).filter((k) => f[k] === "pending");
}

/** Fonti che hanno fallito in modo ritentabile. */
export function fontiDaRiprovare(f: FontiBrand): (keyof FontiBrand)[] {
  return (Object.keys(f) as (keyof FontiBrand)[]).filter((k) => f[k] === "transient_error");
}

/** Fonti bloccate: non si riprovano da sole, perche riprovare non
 *  cambierebbe niente finche qualcuno non tocca la configurazione. */
export function fontiBloccate(f: FontiBrand): (keyof FontiBrand)[] {
  return (Object.keys(f) as (keyof FontiBrand)[]).filter((k) => f[k] === "permanent_error");
}

/**
 * Il rimedio operativo di un blocco, in una riga leggibile.
 *
 * Dice COSA FARE, non cosa manca: «la chiave Gemini non e configurata»
 * nomina una variabile, e i nomi delle variabili sono meta di un
 * segreto. Il codice resta nell'insieme chiuso, il testo resta senza
 * valori.
 */
export function rimedioBlocco(m: MotivoBlocco): string {
  switch (m) {
    case "configuration_missing":
      return "Una credenziale necessaria non e configurata nell'ambiente. Va aggiunta dal pannello Vercel del progetto.";
    case "provider_unsupported":
      return "Il modello richiesto non e disponibile per questo progetto. Va scelto un modello supportato.";
    case "policy_restricted":
      return "La richiesta e stata rifiutata dalla policy del fornitore. Non si riprova: va cambiata la richiesta.";
    case "quota_exhausted":
      return "Credito o quota esauriti. Riprovare non serve finche non vengono ripristinati.";
    default:
      return "";
  }
}

/**
 * L'identita visiva complessiva.
 *
 * La distinzione che questa funzione esiste per fare e fra tre «non
 * lo so» che si somigliano e hanno conseguenze opposte:
 *
 *   PENDING       ci sono fonti che nessuno ha ancora guardato.
 *                 Bloccare e giusto: guardare e ancora possibile.
 *   INCONCLUSIVE  abbiamo guardato e qualcosa c'e, ma e ambiguo.
 *                 Decide una persona.
 *   NOT_FOUND     abbiamo guardato tutto il guardabile e non c'e.
 *                 NON blocca: si compone il nome tipograficamente.
 *
 * Trattare il terzo come il primo e il difetto che trasforma «questa
 * attivita non ha un logo» in «questo sito non si pubblica mai».
 */
export function componiIdentita(
  candidati: readonly BrandCandidate[],
  fonti: FontiBrand,
): BrandIdentity {
  const vivi = candidati.filter((c) => c.status !== "rejected");
  const per = (k: BrandCandidate["kind"], st: BrandCandidate["status"]) =>
    vivi.find((c) => c.kind === k && c.status === st) ?? null;

  const logoConfermato = per("logo", "confirmed") ?? per("monogram", "confirmed")
    ?? per("wordmark", "confirmed");
  const logoProbabile = per("logo", "probable") ?? per("logo", "needs_review")
    ?? per("monogram", "probable") ?? per("monogram", "needs_review");
  const insegna = vivi.find((c) => c.kind === "signage") ?? null;

  const aperte = fontiAperte(fonti);
  const daRiprovare = fontiDaRiprovare(fonti);
  const bloccate = fontiBloccate(fonti);

  // L'ordine conta. Un'identita TROVATA vale comunque: se il logo e
  // confermato dal sito ufficiale, che la ricerca grounded sia andata
  // in timeout non toglie niente. Si guarda cosa manca solo quando non
  // si e trovato.
  let brand_status: BrandOverall;
  if (logoConfermato) brand_status = "ORIGINAL_CONFIRMED";
  else if (logoProbabile) brand_status = "ORIGINAL_PROBABLE";
  else if (insegna) brand_status = "SIGNAGE_ONLY";
  else if (aperte.length > 0) brand_status = "PENDING";
  // Un timeout non e un «non c'e». Prima si riprova, poi si conclude.
  else if (daRiprovare.length > 0) brand_status = "RETRY_REQUIRED";
  // Un blocco non si riprova: riprovare non cambia una configurazione.
  else if (bloccate.length > 0) brand_status = "BLOCKED";
  else if (vivi.length > 0) brand_status = "INCONCLUSIVE";
  else brand_status = "NOT_FOUND";

  const colori: string[] = [];
  for (const c of vivi) {
    for (const col of c.candidate_colors ?? []) {
      if (colori.indexOf(col) === -1) colori.push(col);
    }
  }

  return {
    primary_logo: logoConfermato ?? logoProbabile ?? null,
    alternate_logo: logoConfermato && logoProbabile ? logoProbabile : null,
    favicon: per("favicon", "confirmed") ?? per("favicon", "probable"),
    signage_reference: insegna,
    palette_candidates: colori.slice(0, 6),
    brand_status,
    // Tutto cio che non e confermato passa da una persona prima di
    // finire su una pagina che porta il nome del cliente.
    // Serve una persona solo dove c'e qualcosa da guardare. Ne
    // `NOT_FOUND` ne `PENDING` lo richiedono: il primo perche non c'e
    // niente, il secondo perche prima va eseguita l'analisi.
    // `RETRY_REQUIRED` e `PENDING` non chiedono una persona: chiedono
    // una nuova esecuzione automatica.
    requires_operator_approval:
      brand_status === "ORIGINAL_PROBABLE" || brand_status === "SIGNAGE_ONLY"
      || brand_status === "INCONCLUSIVE",
    candidates: candidati.slice(),
  };
}

/**
 * Che cosa puo usare il generatore, dato lo stato del marchio.
 *
 * `NOT_FOUND` NON autorizza a chiamare «logo» il nome disegnato bene.
 * Un trattamento tipografico e legittimo e spesso e la scelta giusta,
 * ma resta una cosa nostra: dichiararlo identita del cliente sarebbe
 * inventare un fatto, con la differenza che questo si vede.
 */
export function usoConsentito(b: BrandIdentity): {
  usa: "logo_originale" | "logo_da_approvare" | "riferimento_insegna" | "tipografia";
  puo_pubblicare: boolean;
  nota: string;
} {
  switch (b.brand_status) {
    case "PENDING":
      return { usa: "tipografia", puo_pubblicare: false,
        nota: "Identita visiva non ancora cercata: l'analisi non e stata eseguita." };
    case "BLOCKED":
      // Non entra nella revisione umana e non si ritenta all'infinito:
      // serve un intervento sulla configurazione, e finche non arriva
      // ogni tentativo e denaro e tempo buttati.
      return { usa: "tipografia", puo_pubblicare: false,
        nota: "Una capacita necessaria non e disponibile: serve un intervento sulla configurazione." };
    case "RETRY_REQUIRED":
      // NON entra nella revisione umana: non c'e niente da decidere,
      // c'e da rieseguire. Mandare qui una persona vuol dire darle una
      // coda di cose su cui non puo fare nulla.
      return { usa: "tipografia", puo_pubblicare: false,
        nota: "Una fonte non ha risposto: serve una nuova esecuzione, non una decisione." };
    case "INCONCLUSIVE":
      return { usa: "tipografia", puo_pubblicare: false,
        nota: "Candidati ambigui: decide una persona prima di pubblicare." };
    case "ORIGINAL_CONFIRMED":
      return { usa: "logo_originale", puo_pubblicare: true,
        nota: "Logo originale verificato: si usa com'e." };
    case "ORIGINAL_PROBABLE":
      return { usa: "logo_da_approvare", puo_pubblicare: false,
        nota: "Logo probabile: non si pubblica finche una persona non lo approva." };
    case "SIGNAGE_ONLY":
      return { usa: "riferimento_insegna", puo_pubblicare: false,
        nota: "Si vede l'insegna ma un logo non si estrae: serve come riferimento, non come marchio." };
    default:
      return { usa: "tipografia", puo_pubblicare: true,
        nota: "Nessun marchio originale trovato: il nome si compone tipograficamente, e non si chiama logo." };
  }
}
