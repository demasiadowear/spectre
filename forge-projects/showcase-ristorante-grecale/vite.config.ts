import { defineConfig, type Plugin } from "vite";

// Il modulo e differito: non blocca il disegno, ma la rete lo chiede
// subito e con priorita alta, e su una connessione lenta i suoi 115 KB
// tolgono banda al font da cui dipende il testo piu grande della prima
// videata. `fetchpriority=low` non cambia l'ordine di esecuzione e non
// cambia niente di visibile: sposta soltanto il bundle in fondo alla
// coda di rete, dietro il font e la fotografia.
//
// Lo stesso vale per il suo modulepreload, che senza questo vanifica
// l'abbassamento chiedendo la stessa risorsa con priorita alta.
function bundleInCoda(): Plugin {
  return {
    name: "bundle-in-coda",
    enforce: "post",
    transformIndexHtml(html) {
      return html
        .replace(/<script type="module" crossorigin src=/g,
          '<script type="module" fetchpriority="low" crossorigin src=')
        .replace(/<link rel="modulepreload" crossorigin href=/g,
          '<link rel="modulepreload" fetchpriority="low" crossorigin href=');
    },
  };
}

export default defineConfig({
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
  plugins: [bundleInCoda()],
});
