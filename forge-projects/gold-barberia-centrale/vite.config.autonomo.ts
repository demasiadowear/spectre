import { defineConfig } from "vite";

// Build per il file HTML autonomo: UN SOLO chunk JS.
// La build normale divide il codice (entry + vendor), il che è giusto
// per il web ma rende impossibile inlinare: l'entry importerebbe un
// file che nel file singolo non esiste.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist-autonomo",
    emptyOutDir: true,
    rollupOptions: {
      output: { manualChunks: () => "tutto" },
    },
  },
});
