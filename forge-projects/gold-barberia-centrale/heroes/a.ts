// Direzione A — la vernice che "prende" sulla targa.
// Il movimento cita un gesto reale del soggetto (la lettera dipinta che
// compare), non è una comparsa generica.
import gsap from "gsap";

const ridotto = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Grana dello smalto: rumore disegnato una volta su canvas, non una
// texture scaricata (nessun host di asset è raggiungibile, e comunque
// 8 KB di canvas battono 300 KB di PNG).
const c = document.querySelector<HTMLCanvasElement>(".grana")!;
function grana() {
  const dpr = Math.min(devicePixelRatio, 2);
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 90;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
grana();
addEventListener("resize", grana);

if (!ridotto) {
  // L'offset iniziale si imposta QUI e non in CSS: getComputedStyle
  // risolve un translateY(102%) in pixel, quindi GSAP lo legge come
  // `y: 173px` e non come `yPercent: 102`. Animare yPercent da 0 a 0
  // non muove niente e il titolo resta invisibile per sempre.
  gsap.set(".nome .riga i", { yPercent: 102 });
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.to(".nome .riga i", { yPercent: 0, duration: 1.05, stagger: 0.09 })
    .to(".filetto", { scaleX: 1, duration: 0.9 }, "-=0.45")
    .from(".occhiello, .voce, .azione", { opacity: 0, y: 12, duration: 0.6, stagger: 0.06 }, "-=0.6");
} else {
  // Reduced motion: nessun offset da togliere, solo il filetto già steso.
  gsap.set(".filetto", { scaleX: 1 });
}
