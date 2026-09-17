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

// ----- 3. Prenotare in tre passaggi -----------------------------
// Un passaggio alla volta, con il riepilogo che si aggiorna mentre si
// sceglie. Senza JavaScript la classe `con-js` non arriva mai, i tre
// gruppi restano tutti visibili e il modulo si compila di seguito: e
// per questo che la logica dei passaggi vive qui e non nel CSS.

document.documentElement.classList.add("con-js");

const modulo = document.querySelector<HTMLFormElement>("#modulo-prenota");
const esito = document.querySelector<HTMLParagraphElement>("#esito-prenota");

if (modulo) {
  const passi = Array.from(modulo.querySelectorAll<HTMLFieldSetElement>(".passo"));
  const tappe = Array.from(modulo.querySelectorAll<HTMLLIElement>(".avanzamento li"));
  const indietro = modulo.querySelector<HTMLButtonElement>("[data-indietro]");
  const avanti = modulo.querySelector<HTMLButtonElement>("[data-avanti]");
  const invia = modulo.querySelector<HTMLButtonElement>(".tasto-invia");
  let corrente = 0;

  /** Mostra un passaggio e aggiorna comandi e avanzamento. */
  function vai(n: number): void {
    corrente = Math.max(0, Math.min(passi.length - 1, n));
    passi.forEach((p, i) => p.classList.toggle("attivo", i === corrente));
    tappe.forEach((t, i) => {
      t.classList.toggle("qui", i === corrente);
      t.classList.toggle("fatto", i < corrente);
    });
    if (indietro) indietro.hidden = corrente === 0;
    if (avanti) avanti.hidden = corrente === passi.length - 1;
    if (invia) invia.hidden = corrente !== passi.length - 1;
    if (!ridotto) {
      gsap.fromTo(passi[corrente], { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.5, ease: "expo.out" });
    }
  }

  indietro?.addEventListener("click", () => vai(corrente - 1));
  avanti?.addEventListener("click", () => {
    vai(corrente + 1);
    passi[corrente].querySelector<HTMLElement>("legend")
      ?.scrollIntoView({ block: "nearest", behavior: ridotto ? "auto" : "smooth" });
  });

  // Il riepilogo: sta sempre in vista e dice cosa si e scelto finora.
  const scrivi = (chiave: string, testo: string) =>
    document.querySelectorAll<HTMLElement>(`[data-r-${chiave}]`)
      .forEach((e) => { e.textContent = testo; });

  function aggiorna(): void {
    const dati = new FormData(modulo!);
    const servizio = String(dati.get("servizio") ?? "");
    const scelto = modulo!.querySelector<HTMLInputElement>('input[name="servizio"]:checked');
    scrivi("servizio", servizio);
    scrivi("durata", scelto?.dataset.durata ?? "");
    scrivi("chi", String(dati.get("chi") ?? ""));
    scrivi("quando", String(dati.get("quando") ?? ""));
  }
  modulo.addEventListener("change", aggiorna);
  aggiorna();
  vai(0);

  modulo.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!esito) return;
    const dati = new FormData(modulo);
    const nome = String(dati.get("nome") ?? "").trim();
    const recapito = String(dati.get("recapito") ?? "").trim();
    const manca = !nome ? "#c-nome" : !recapito ? "#c-recapito" : null;
    if (manca) {
      esito.textContent = !nome
        ? "Manca il nome: senza, non sappiamo per chi tenere la poltrona."
        : "Manca un recapito: serve per confermare l'orario.";
      esito.hidden = false;
      document.querySelector<HTMLInputElement>(manca)?.focus();
      return;
    }
    esito.textContent =
      `${dati.get("servizio")}, ${String(dati.get("quando")).toLowerCase()}, ` +
      `a nome ${nome}. Questo sito è un concept dimostrativo: la richiesta ` +
      `non parte e il recapito non viene salvato da nessuna parte.`;
    esito.hidden = false;
    if (!ridotto) gsap.from(esito, { opacity: 0, y: 10, duration: 0.9, ease: "expo.out" });
  });
}
