import { defineConfig } from "vite";
import { resolve } from "node:path";

// Build a più entry: le tre direzioni creative e il sito finale.
// `base: "./"` perché l'output viene servito da una sottocartella
// qualsiasi (preview locale, hosting statico) senza riscrivere i path.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        a: resolve(__dirname, "heroes/a.html"),
        b: resolve(__dirname, "heroes/b.html"),
        c: resolve(__dirname, "heroes/c.html"),
        rasoiosvg: resolve(__dirname, "prove/rasoio-svg.html"),
        rasoio3d: resolve(__dirname, "prove/rasoio-3d.html"),
      },
    },
  },
});
