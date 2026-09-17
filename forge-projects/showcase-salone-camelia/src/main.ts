// ============================================================
// Camelia — comportamento.
//
// Il movimento qui e lento: expo e sine, fra 1,4 e 2,2 secondi. E il
// contrario del ritmo scattante degli altri due showcase, ed e voluto:
// un salone non ha fretta e la pagina nemmeno.
//
// Due gesti:
//  1. l'apertura — l'arco sale e si allarga, il nome emerge dopo;
//  2. la nuance — il colore scelto ridipinge arco, silhouette e
//     bottoni, con una dissolvenza lunga. E l'unica cosa che si puo
//     fare su questa pagina oltre a prenotare, e serve a decidere.
//
// Niente movimento legato allo scroll, niente reveal per sezione:
// senza JavaScript la pagina e intera e il colore di partenza c'e gia.
// ============================================================

import gsap from "gsap";

const ridotto = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ----- 1. L'apertura ----------------------------------------------

if (!ridotto) {
  const arco = document.querySelector<HTMLElement>(".arco");
  const nome = document.querySelector<HTMLElement>(".nome");
  const sotto = gsap.utils.toArray<HTMLElement>(".claim, .apertura .tasto");
  const dischi = gsap.utils.toArray<HTMLElement>(".disco");

  const t = gsap.timeline({ defaults: { ease: "expo.out" } });
  if (arco) t.from(arco, { scaleY: 0.72, opacity: 0, duration: 1.6, transformOrigin: "50% 100%" }, 0);
  if (nome) t.from(nome, { opacity: 0, y: 26, duration: 1.4 }, 0.5);
  if (sotto.length) t.from(sotto, { opacity: 0, y: 18, duration: 1.2, stagger: 0.14 }, 0.75);
  if (dischi.length) t.from(dischi, { opacity: 0, scale: 0.6, duration: 2.2, ease: "sine.out", stagger: 0.2 }, 0.2);
}

// ----- 2. La nuance ------------------------------------------------
// Il colore vive in una variabile CSS. Cambiarla ridipinge tutto quello
// che la usa: l'arco, i capelli delle silhouette, i bottoni, il filetto
// della nota. Le transizioni lunghe stanno nel CSS, non qui, cosi
// valgono anche se questo file non parte.

const radice = document.documentElement;

document.querySelectorAll<HTMLInputElement>('input[name="nuance"]').forEach((r) => {
  r.addEventListener("change", () => {
    if (!r.checked) return;
    radice.style.setProperty("--nuance", r.value);
  });
});

// ----- 3. Prenotare ------------------------------------------------

const modulo = document.querySelector<HTMLFormElement>("#modulo-prenota");
const esito = document.querySelector<HTMLParagraphElement>("#esito-prenota");

modulo?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!esito) return;
  const dati = new FormData(modulo);
  const nome = String(dati.get("nome") ?? "").trim();
  const servizio = String(dati.get("servizio") ?? "");
  const fascia = String(dati.get("fascia") ?? "");

  if (!nome) {
    esito.textContent = "Manca il nome: senza, non sappiamo per chi tenere la poltrona.";
    esito.hidden = false;
    document.querySelector<HTMLInputElement>("#c-nome")?.focus();
    return;
  }
  esito.textContent =
    `${servizio}, ${fascia}, a nome ${nome}. Questo sito è un concept ` +
    `dimostrativo: la richiesta non parte e nessuno la riceve.`;
  esito.hidden = false;
  if (!ridotto) gsap.from(esito, { opacity: 0, y: 10, duration: 0.9, ease: "expo.out" });
});
