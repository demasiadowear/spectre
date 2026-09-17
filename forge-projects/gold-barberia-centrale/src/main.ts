// ============================================================
// Barberia Centrale — comportamento.
//
// Due cose sole, ed entrambe servono a qualcosa:
//  1. lo stato "aperto adesso", calcolato dagli orari VERIFICATI. Per
//     una bottega senza prenotazione online è l'informazione che la
//     gente cerca davvero, ed è l'unica interazione che vale la pena
//     ricordare. Non è un effetto: è un dato.
//  2. il gesto: la linea che si disegna scorrendo e le righe che
//     entrano. Guida la lettura, non fa scena.
//
// Nessun dato inventato: gli orari qui sotto sono gli stessi del brief
// e della scheda Google.
// ============================================================

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const ridotto = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ----- 1. Aperto adesso -------------------------------------------

/** Orari verificati. Indici JS: 0 = domenica. */
interface Fascia { giorni: number[]; da: string; a: string }
const ORARI: Fascia[] = [
  { giorni: [2, 3, 4], da: "09:00", a: "19:00" },
  { giorni: [5, 6], da: "08:30", a: "20:00" },
];

const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

const minuti = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export interface Stato {
  aperto: boolean;
  /** Frase pronta da mostrare. */
  testo: string;
}

/** Stato di apertura a una data qualsiasi. Esportata: è testabile. */
export function statoApertura(ora: Date): Stato {
  const giorno = ora.getDay();
  const adesso = ora.getHours() * 60 + ora.getMinutes();

  const oggi = ORARI.find((f) => f.giorni.includes(giorno));
  if (oggi && adesso >= minuti(oggi.da) && adesso < minuti(oggi.a)) {
    return { aperto: true, testo: `Aperto adesso, fino alle ${oggi.a}` };
  }
  // Non aperto: si cerca la prima apertura utile nei sette giorni dopo.
  for (let salto = 0; salto < 8; salto++) {
    const g = (giorno + salto) % 7;
    const f = ORARI.find((x) => x.giorni.includes(g));
    if (!f) continue;
    // Oggi conta solo se l'apertura deve ancora arrivare.
    if (salto === 0 && adesso >= minuti(f.da)) continue;
    const quando = salto === 0 ? "oggi" : salto === 1 ? "domani" : GIORNI[g];
    return { aperto: false, testo: `Chiuso ora — riapre ${quando} alle ${f.da}` };
  }
  return { aperto: false, testo: "Chiuso" };
}

function mostraStato(): void {
  const stato = statoApertura(new Date());
  const testo = document.querySelector<HTMLElement>("[data-stato-testo]");
  const pallino = document.querySelector<HTMLElement>("[data-stato-pallino]");
  if (testo) testo.textContent = stato.testo;
  if (pallino) pallino.classList.toggle("aperto", stato.aperto);

  const prossima = document.querySelector<HTMLElement>("[data-prossima]");
  if (prossima) {
    prossima.textContent = stato.aperto
      ? `${stato.testo}. Meglio telefonare prima: si lavora su appuntamento.`
      : `${stato.testo}. Per l'appuntamento si può chiamare negli orari di apertura.`;
  }

  // La riga di oggi si evidenzia da sola: chi apre il sito guarda quella.
  const oggi = new Date().getDay();
  document.querySelectorAll<HTMLElement>(".tabella tr").forEach((tr) => {
    const giorni = (tr.dataset.giorni ?? "").split(",").map(Number);
    tr.classList.toggle("oggi", giorni.includes(oggi));
  });
}

mostraStato();
// L'ora cambia mentre la pagina è aperta: si aggiorna al minuto.
setInterval(mostraStato, 60_000);

// ----- 2. Il gesto -------------------------------------------------

const spina = document.querySelector<SVGPathElement>(".spina path");

if (!ridotto) {
  // Offset iniziali impostati QUI e non in CSS: getComputedStyle
  // risolve un translateY in percentuale in pixel, e GSAP lo
  // leggerebbe come `y` invece che come `yPercent`, lasciando il testo
  // fuori vista per sempre. In più così lo stato a riposo senza JS è
  // leggibile, che è la cosa che conta di più.
  gsap.set(".titolo .lin > span", { yPercent: 100 });

  const apertura = gsap.timeline({ defaults: { ease: "power3.out" } });
  apertura
    .to(".titolo .lin > span", { yPercent: 0, duration: 1, stagger: 0.08 }, 0.1)
    .from(".occhiello", { opacity: 0, duration: 0.6 }, 0.15)
    .from(".nota, .apertura-azioni > *", { opacity: 0, y: 14, duration: 0.65, stagger: 0.08 }, "-=0.55");

  // La spina si disegna col rotolo: il gesto segue la mano di chi legge.
  if (spina) {
    const len = spina.getTotalLength();
    gsap.set(spina, { strokeDasharray: len, strokeDashoffset: len });
    gsap.to(spina, {
      strokeDashoffset: 0,
      ease: "none",
      scrollTrigger: { trigger: document.body, start: "top top", end: "bottom bottom", scrub: 0.6 },
    });
  }

  // REGOLA, imparata guardando gli screenshot: il movimento legato allo
  // scroll non deve MAI spostare né nascondere il contenuto.
  //
  // La prima versione faceva sfumare le sezioni e far entrare le voci
  // da sinistra. Risultato: tutto ciò che stava sotto la piega restava
  // parcheggiato — invisibile o disallineato — finché l'observer non
  // scattava. In uno screenshot a pagina intera l'elenco dei servizi
  // usciva a scalini, e chi arriva su un'ancora vede la stessa cosa.
  //
  // Quindi resta solo il movimento che non tocca il testo: la timeline
  // di apertura, che parte subito, e la spina che si disegna col
  // rotolo. Due gesti, non dieci. Un'animazione in più non rende un
  // sito più curato: lo fa sembrare generato.
}
