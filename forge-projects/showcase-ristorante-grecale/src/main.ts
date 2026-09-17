// ============================================================
// Grecale — comportamento.
//
// Tre cose, e nessuna di più (gsap-motion-design: due gesti orchestrati,
// non dieci effetti):
//  1. imbandire — le piastrelle si posano al caricamento;
//  2. girare la piastrella — quando si apre una portata;
//  3. la prenotazione, che è il lavoro della pagina.
//
// Piu la grana di semola, che è un asset disegnato, non un'animazione.
//
// Regola: nessun movimento legato allo scroll. Niente qui parte a
// opacita zero aspettando un observer, quindi senza JavaScript la
// pagina e completa e uno screenshot a pagina intera la ritrae intera.
// ============================================================

import gsap from "gsap";

const ridotto = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ----- 0. La grana ------------------------------------------------
// Rumore disegnato una volta in un canvas fuori dal documento e passato
// al CSS come data URI. 8 KB di codice invece di un PNG di sfondo.

function grana(lato = 140): string | null {
  const c = document.createElement("canvas");
  c.width = c.height = lato;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(lato, lato);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // Rumore caldo, non grigio: la semola sporca di giallo, non di nero.
    const n = 200 + Math.random() * 55;
    d[i] = n; d[i + 1] = n * 0.97; d[i + 2] = n * 0.9;
    d[i + 3] = Math.random() < 0.42 ? 26 : 0;
  }
  ctx.putImageData(img, 0, 0);
  return `url("${c.toDataURL("image/png")}")`;
}

const g = grana();
if (g) document.documentElement.style.setProperty("--grana", g);

// ----- 1. Imbandire -----------------------------------------------
// Le piastrelle si posano una dopo l'altra, dal centro verso i bordi,
// con un rimbalzo corto: è il gesto di chi apparecchia, non una
// dissolvenza verso l'alto.

if (!ridotto) {
  const tessere = gsap.utils.toArray<HTMLElement>(".muro .t");
  gsap.from(tessere, {
    opacity: 0,
    scale: 0.82,
    // Relativa, così la rotazione di base che il CSS da a ogni
    // piastrella non viene azzerata.
    rotation: "-=5",
    duration: 0.62,
    ease: "back.out(1.5)",
    stagger: { each: 0.045, from: "center", grid: "auto" },
  });
}

// ----- 2. Girare la piastrella ------------------------------------
// Aprire una portata gira il modulo su se stesso e lo rimette giu.
// Mezzo giro e ritorno: il contenuto resta nel flusso, quindi non ci
// sono due facce sovrapposte da tenere allineate e senza JavaScript il
// <details> continua ad aprirsi da solo.

document.querySelectorAll<HTMLDetailsElement>(".portata").forEach((portata) => {
  portata.addEventListener("toggle", () => {
    if (ridotto || !portata.open) return;
    gsap.fromTo(portata,
      { rotationY: 0 },
      {
        rotationY: 82, duration: 0.2, ease: "power2.in",
        onComplete: () => {
          gsap.fromTo(portata,
            { rotationY: -82 },
            { rotationY: 0, duration: 0.42, ease: "back.out(1.3)" });
        },
      });
  });
});

// ----- 3. Prenotare -----------------------------------------------
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
    `Questo sito è un concept dimostrativo, quindi la richiesta non parte e ` +
    `nessuno la riceve.`;
  esito.hidden = false;
  if (!ridotto) gsap.from(esito, { opacity: 0, y: -8, duration: 0.3, ease: "power2.out" });
});
