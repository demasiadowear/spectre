import { defineConfig } from "vite";
import { resolve } from "node:path";
// Piu entry: il sito e le due prove che hanno deciso se usare il 3D.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist", emptyOutDir: true,
    rollupOptions: { input: {
      index: resolve(__dirname, "index.html"),
      dente3d: resolve(__dirname, "prove/dente-3d.html"),
      dentesvg: resolve(__dirname, "prove/dente-svg.html"),
    } },
  },
});
