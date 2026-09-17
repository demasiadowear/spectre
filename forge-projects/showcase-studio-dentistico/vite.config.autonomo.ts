import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: { emptyOutDir: true, rollupOptions: { output: { manualChunks: () => "tutto" } } },
});
