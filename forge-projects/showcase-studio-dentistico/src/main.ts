// ============================================================
// Studio Cardine — comportamento.
//
// Due gesti, e il secondo e quello che conta:
//  1. la scansione — una riga indaco attraversa la tavola una volta
//     sola al caricamento, e i richiami numerati compaiono quando li
//     supera. Dura poco piu di un secondo e non si ripete.
//  2. aprire una tappa del percorso — la cosa che aiuta davvero a
//     capire, ed e l'unica animazione legata a un gesto.
//
// Niente movimento legato allo scroll: nessun testo parte a opacita
// zero, quindi senza JavaScript la pagina e intera. Il disegno sta
// nell'HTML, non iniettato: iniettarlo sposterebbe il contenuto dopo
// il primo paint.
//
// Three.js: valutato e respinto. La prova sta in prove/dente-3d.ts e
// l'esito in DIREZIONE.md. Nel bundle del sito `three` non entra.
// ============================================================

import gsap from "gsap";

const ridotto = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ----- 1. La scansione --------------------------------------------

const scansione = document.querySelector<SVGGElement>(".scansione");
const richiami = gsap.utils.toArray<SVGGElement>(".richiamo");

if (!ridotto && scansione && richiami.length) {
  // Gli stati iniziali li mette GSAP, mai il CSS: cosi senza JavaScript
  // i richiami sono gia al loro posto invece di restare invisibili per
  // sempre in attesa di qualcosa che non parte.
  gsap.set(scansione, { y: 0, opacity: 1 });
  gsap.set(richiami, { opacity: 0 });

  const t = gsap.timeline({ delay: 0.25 });
  t.to(scansione, { y: 520, duration: 1.15, ease: "power1.inOut" })
   .to(richiami, { opacity: 1, duration: 0.22, ease: "none", stagger: 0.22 }, 0.18)
   .to(scansione, { opacity: 0, duration: 0.3, ease: "power1.out" }, "-=0.22");
} else if (scansione) {
  // A riposo la riga non serve: il disegno si legge da solo.
  scansione.style.display = "none";
}

// ----- 2. Le tappe -------------------------------------------------
// Il <details> si apre da solo anche senza JavaScript. Qui si aggiunge
// solo l'apertura in altezza, che e movimento che spiega un cambiamento
// ed e quindi movimento legittimo.

document.querySelectorAll<HTMLDetailsElement>(".tappa > details").forEach((d) => {
  const corpo = d.querySelector<HTMLElement>(".tappa-corpo");
  d.addEventListener("toggle", () => {
    if (ridotto || !corpo || !d.open) return;
    gsap.fromTo(corpo,
      { height: 0, opacity: 0 },
      { height: "auto", opacity: 1, duration: 0.34, ease: "power1.out",
        clearProps: "height" });
  });
});

// ----- 3. La richiesta di visita -----------------------------------

const modulo = document.querySelector<HTMLFormElement>("#modulo-visita");
const esito = document.querySelector<HTMLParagraphElement>("#esito-visita");

modulo?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!esito) return;
  const dati = new FormData(modulo);
  const nome = String(dati.get("nome") ?? "").trim();
  const contatto = String(dati.get("contatto") ?? "").trim();
  const quando = String(dati.get("quando") ?? "");

  const manca = !nome ? "#v-nome" : !contatto ? "#v-contatto" : null;
  if (manca) {
    esito.textContent = !nome
      ? "Manca il nome."
      : "Manca un recapito: senza, non possiamo richiamarla.";
    esito.hidden = false;
    document.querySelector<HTMLInputElement>(manca)?.focus();
    return;
  }

  esito.textContent =
    `Richiesta pronta per ${nome}, preferenza ${quando.toLowerCase()}. ` +
    `Questo sito è un concept dimostrativo: la richiesta non parte e ` +
    `il recapito non viene salvato da nessuna parte.`;
  esito.hidden = false;
  if (!ridotto) gsap.from(esito, { opacity: 0, duration: 0.25, ease: "none" });
});
