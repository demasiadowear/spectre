// ============================================================
// Barberia Centrale — comportamento, v3.
//
// Tre cose, e ognuna fa un lavoro:
//  1. lo stato "aperto adesso" dagli orari verificati — è il dato per
//     cui uno apre il sito di una bottega;
//  2. il rasoio che si apre: il gesto vero del mestiere, e l'unico
//     momento vistoso della pagina;
//  3. la passata che apre ogni sezione: lo stesso filo, ripetuto piano.
//
// Regola che non si viola (gsap-motion-design): il movimento legato
// allo scroll non sposta né nasconde il contenuto. Il rasoio è
// decorativo, quindi può partire chiuso; il testo no.
// ============================================================

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const ridotto = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ----- 1. Aperto adesso -------------------------------------------

interface Fascia { giorni: number[]; da: string; a: string; etichetta: string }
const ORARI: Fascia[] = [
  { giorni: [2, 3, 4], da: "09:00", a: "19:00", etichetta: "9 — 19" },
  { giorni: [5, 6], da: "08:30", a: "20:00", etichetta: "8.30 — 20" },
];

const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const minuti = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
/** "09:00" → "9", "08:30" → "8.30". Come si dice, non come si scrive
 *  su un cartello. */
const parlato = (hhmm: string): string =>
  hhmm.replace(/^0/, "").replace(":00", "").replace(":", ".");

export interface Stato {
  aperto: boolean;
  /** Frase per l'apertura. */
  testo: string;
  /** Orario di oggi, oppure "chiuso". */
  oreOggi: string;
  /** Riga sotto l'orario grande. */
  nota: string;
}

/** Stato a una data qualsiasi. Esportata perché è la sola logica della
 *  pagina che vale la pena provare fuori dal browser. */
export function statoApertura(ora: Date): Stato {
  const giorno = ora.getDay();
  const adesso = ora.getHours() * 60 + ora.getMinutes();
  const oggi = ORARI.find((f) => f.giorni.includes(giorno));

  if (oggi && adesso >= minuti(oggi.da) && adesso < minuti(oggi.a)) {
    return {
      aperto: true,
      testo: `Aperto adesso, fino alle ${parlato(oggi.a)}`,
      oreOggi: oggi.etichetta,
      nota: "Meglio telefonare prima: si lavora su appuntamento.",
    };
  }

  for (let salto = 0; salto < 8; salto++) {
    const g = (giorno + salto) % 7;
    const f = ORARI.find((x) => x.giorni.includes(g));
    if (!f) continue;
    if (salto === 0 && adesso >= minuti(f.da)) continue;
    const quando = salto === 0 ? "oggi" : salto === 1 ? "domani" : GIORNI[g];
    return {
      aperto: false,
      testo: `Chiuso adesso, riapre ${quando} alle ${parlato(f.da)}`,
      oreOggi: oggi ? oggi.etichetta : "chiuso",
      nota: `Riapre ${quando} alle ${parlato(f.da)}.`,
    };
  }
  return { aperto: false, testo: "Chiuso", oreOggi: "chiuso", nota: "" };
}

function mostraStato(): void {
  const s = statoApertura(new Date());
  const g = new Date().getDay();

  const testo = document.querySelector<HTMLElement>("[data-stato-testo]");
  if (testo) testo.textContent = s.testo;
  document.querySelector("[data-stato-pallino]")?.classList.toggle("aperto", s.aperto);

  const giorno = document.querySelector<HTMLElement>("[data-oggi-giorno]");
  if (giorno) giorno.textContent = `Oggi, ${GIORNI[g]}`;
  const ore = document.querySelector<HTMLElement>("[data-oggi-ore]");
  if (ore) ore.textContent = s.oreOggi;
  const nota = document.querySelector<HTMLElement>("[data-oggi-stato]");
  if (nota) nota.textContent = s.nota;

  // La riga di oggi nella settimana si accende: chi guarda cerca quella.
  document.querySelectorAll<HTMLElement>(".settimana > div").forEach((riga) => {
    const giorni = (riga.dataset.giorni ?? "").split(",").map(Number);
    riga.classList.toggle("oggi-riga", giorni.includes(g));
  });
}

mostraStato();
setInterval(mostraStato, 60_000);

// ----- 2. Il rasoio -----------------------------------------------
// Il markup sta nell'HTML, NON iniettato: iniettarlo dopo il primo
// paint spostava il contenuto (Lighthouse misurava CLS 0,054) e senza
// JavaScript lasciava un buco al posto dell'oggetto. Qui il JS si
// limita ad animare quello che c'è già.

const host = document.querySelector<HTMLElement>(".apertura-oggetto");

if (!ridotto) {
  // Gli offset stanno QUI e non nel CSS: getComputedStyle risolve un
  // translateY in percentuale in pixel, e GSAP lo leggerebbe come `y`
  // invece che come `yPercent`, lasciando il titolo fuori vista per
  // sempre. E così senza JS la pagina resta leggibile.
  gsap.set(".titolo .lin > span", { yPercent: 100 });

  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.to(".titolo .lin > span", { yPercent: 0, duration: 0.95, stagger: 0.09 }, 0.1)
    .from(".nota, .apertura-azioni > *", { opacity: 0, y: 14, duration: 0.6, stagger: 0.08 }, "-=0.45");

  // Il rasoio si apre: la lama ruota attorno al perno, come in mano.
  const lama = host?.querySelector<SVGGElement>(".rasoio-lama");
  if (lama) {
    gsap.set(lama, { rotation: -167, transformOrigin: "249px 72.5px" });
    tl.to(lama, { rotation: 0, duration: 1.15, ease: "power3.out" }, 0.25);
    // Il riflesso corre sull'acciaio appena la lama è aperta: è il
    // dettaglio che fa leggere il metallo come metallo.
    const brillio = host?.querySelector(".rasoio-brillio");
    if (brillio) {
      gsap.set(brillio, { x: -90 });
      tl.to(brillio, { x: 250, duration: 0.95, ease: "power2.inOut" }, "-=0.35");
    }
  }

  // La passata si disegna quando la sezione entra. È decorativa: può
  // partire da zero perché non nasconde nessuna parola.
  gsap.utils.toArray<SVGPathElement>(".passata path").forEach((p) => {
    const len = p.getTotalLength();
    // `immediateRender: false` è la differenza fra un motivo che c'è e
    // uno che sparisce: senza, GSAP applica subito lo stato iniziale e
    // la passata resta invisibile finché lo scroll non arriva — quindi
    // manca in uno screenshot a pagina intera, in un'anteprima di link
    // e per chi atterra a metà pagina. Con questo, a riposo è disegnata
    // e l'animazione parte solo quando la sezione entra davvero.
    gsap.set(p, { strokeDasharray: len });
    gsap.fromTo(
      p,
      { strokeDashoffset: len },
      {
        strokeDashoffset: 0,
        duration: 0.9,
        ease: "power2.out",
        immediateRender: false,
        scrollTrigger: { trigger: p.closest(".sez-testa"), start: "top 86%" },
      },
    );
  });
}

// ----- 3. Chiamata fissa su telefono -------------------------------
// Compare solo dopo l'apertura: prima coprirebbe la CTA che c'è già lì.

const chiama = document.querySelector<HTMLElement>("[data-chiama-fisso]");
const apertura = document.querySelector<HTMLElement>(".apertura");
if (chiama && apertura && "IntersectionObserver" in window) {
  new IntersectionObserver(
    ([voce]) => chiama.classList.toggle("visibile", !voce.isIntersecting),
    { rootMargin: "-60px 0px 0px 0px" },
  ).observe(apertura);
}
