// ============================================================
// Grecale — comportamento.
//
// Tre famiglie di movimento, non una di più, e ognuna fa un lavoro:
//
//  1. APERTURA — il velo si alza e il titolo sale, una volta sola al
//     caricamento. È il momento in cui la fotografia deve prendere.
//  2. PARALLASSE — le due fotografie grandi scorrono un po' più piano
//     della pagina. Solo `transform`, solo desktop, solo mentre sono in
//     vista: dà profondità e non costa layout.
//  3. RISPOSTA AL TOCCO — la scheda demo e l'esito del modulo. È
//     movimento che spiega un cambiamento, e quindi si può.
//
// Regola che non si viola: niente di quello che contiene parole parte a
// opacità zero. Gli offset li mette GSAP, mai il CSS, quindi senza
// JavaScript la pagina è intera e leggibile.
// ============================================================

import gsap from "gsap";

const ridotto = matchMedia("(prefers-reduced-motion: reduce)").matches;
const grande = matchMedia("(min-width: 900px)").matches;

// ----- 1. L'apertura ----------------------------------------------

if (!ridotto) {
  const dire = gsap.utils.toArray<HTMLElement>(
    ".apertura-dire > .insegna, .apertura-dire > h1, .apertura-dire > .claim, .apertura-dire > .apertura-azioni",
  );
  // Le curve sono quelle di Grecale e di nessun altro: `circ.out` per
  // le parole, che arrivano e si fermano contro una battuta, e
  // `power4.out` per la fotografia, che si posa lunga. La barberia usa
  // le `power2`/`power3`, Camelia le `expo`/`sine`, lo studio le
  // `power1`: nessuno prende il movimento dell'altro.
  const t = gsap.timeline({ defaults: { ease: "circ.out" } });

  // Il velo si alza: si anima l'opacità dello pseudo-elemento via
  // variabile, non il contenuto.
  const foto = document.querySelector<HTMLElement>(".apertura-foto .fondale");
  if (foto) t.from(foto, { opacity: 0, scale: 1.06, duration: 1.1, ease: "power4.out" }, 0);
  if (dire.length) t.from(dire, { opacity: 0, y: 18, duration: 0.7, stagger: 0.09 }, 0.35);
}

// ----- 2. La parallasse -------------------------------------------
// Solo `transform` su elementi che NON contengono parole: se una di
// queste immagini non si muovesse, non mancherebbe niente di leggibile.

// ScrollTrigger serve solo qui, e qui non ci si arriva mai su telefono:
// la parallasse e desktop. Importarlo in cima significava far scaricare
// e compilare a ogni telefono un plugin che non esegue una riga. Con
// l'import dinamico il telefono non lo vede proprio, e il desktop si
// comporta esattamente come prima.
if (!ridotto && grande) {
  void import("gsap/ScrollTrigger").then(({ ScrollTrigger }) => {
    gsap.registerPlugin(ScrollTrigger);

    for (const sel of [".cucina-forno img", ".sala-fascia img"]) {
      const img = document.querySelector<HTMLElement>(sel);
      if (!img) continue;
      gsap.fromTo(img,
        { yPercent: -4 },
        {
          yPercent: 4, ease: "none",
          scrollTrigger: { trigger: img.closest("figure"), start: "top bottom", end: "bottom top", scrub: 0.6 },
        });
    }
  });
}

// ----- 3. La scheda demo ------------------------------------------
// I comandi che finterebbero un contatto aprono questa e basta. Senza
// JavaScript sono ancore verso la nota nel piede, che dice la stessa
// cosa: non c'è nessun tel: e nessun wa.me da nessuna parte.

const scheda = document.querySelector<HTMLDialogElement>("#scheda-demo");

document.querySelectorAll<HTMLElement>("[data-demo-apri]").forEach((c) => {
  c.addEventListener("click", (e) => {
    if (!scheda || typeof scheda.showModal !== "function") return;   // niente JS utile: resta l'ancora
    e.preventDefault();
    scheda.showModal();
    if (!ridotto) {
      gsap.from(scheda, { opacity: 0, y: 12, duration: 0.3, ease: "circ.out" });
    }
  });
});

document.querySelector<HTMLButtonElement>("[data-demo-chiudi]")
  ?.addEventListener("click", () => scheda?.close());

// Il clic sullo sfondo chiude: e uno <dialog> modale senza via d'uscita
// visibile e una trappola.
scheda?.addEventListener("click", (e) => {
  if (e.target === scheda) scheda.close();
});

// ----- 4. La prenotazione -----------------------------------------
// Il modulo è un <form> vero: senza JavaScript resta leggibile e
// compilabile. Con JavaScript non parte nessuna richiesta, e lo dice.

const modulo = document.querySelector<HTMLFormElement>("#modulo-prenota");
const esito = document.querySelector<HTMLParagraphElement>("#esito-prenota");

/** Il giorno di oggi in formato input[type=date], ora locale. */
function oggi(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const campoData = document.querySelector<HTMLInputElement>("#p-data");
if (campoData) { campoData.min = oggi(); campoData.value = oggi(); }

modulo?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!esito) return;
  const dati = new FormData(modulo);
  const nome = String(dati.get("nome") ?? "").trim();
  const coperti = String(dati.get("coperti") ?? "");
  const ora = String(dati.get("ora") ?? "");

  if (!nome) {
    esito.textContent = "Manca il nome: serve per tenere il tavolo.";
    esito.hidden = false;
    document.querySelector<HTMLInputElement>("#p-nome")?.focus();
    return;
  }
  esito.textContent =
    `Richiesta pronta: ${coperti} coperti alle ${ora}, a nome ${nome}. ` +
    `Grecale è un concept dimostrativo, quindi la richiesta non parte e ` +
    `nessuno la riceve.`;
  esito.hidden = false;
  if (!ridotto) gsap.from(esito, { opacity: 0, y: -8, duration: 0.3, ease: "circ.out" });
});
