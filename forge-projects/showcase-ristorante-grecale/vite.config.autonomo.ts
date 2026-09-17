import { defineConfig } from "vite";
// Un chunk solo: la versione autonoma deve stare in un file HTML.
export default defineConfig({
  base: "./",
  build: { emptyOutDir: true, rollupOptions: { output: { manualChunks: () => "tutto" } } },
});
