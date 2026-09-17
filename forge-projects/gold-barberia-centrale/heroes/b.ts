// Direzione B — la linea si disegna come una passata di rasoio: una
// sola, continua, senza tornare indietro. È il gesto del mestiere reso
// letterale, non un'animazione decorativa.
import gsap from "gsap";

const ridotto = matchMedia("(prefers-reduced-motion: reduce)").matches;
const path = document.querySelector<SVGPathElement>(".tratto path")!;
const len = path.getTotalLength();

gsap.set(path, { strokeDasharray: len, strokeDashoffset: ridotto ? 0 : len });

if (!ridotto) {
  // Offset iniziale via GSAP: vedi la nota in a.ts, un translateY(100%)
  // in CSS diventa pixel e GSAP non lo riconosce come percentuale.
  gsap.set(".titolo .lin > span", { yPercent: 100 });
  gsap
    .timeline({ defaults: { ease: "power2.out" } })
    // La linea parte per prima e il testo la segue: prima il gesto, poi la parola.
    .to(path, { strokeDashoffset: 0, duration: 1.6, ease: "power1.inOut" })
    .to(".titolo .lin > span", { yPercent: 0, duration: 0.95, stagger: 0.075 }, 0.35)
    .from(".nota, .voce, .azione", { opacity: 0, y: 14, duration: 0.6, stagger: 0.07 }, "-=0.5")
    .from(".testata span", { opacity: 0, duration: 0.5, stagger: 0.1 }, 0.1);
}
