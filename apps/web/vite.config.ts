import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `vite build --mode artifact` makes the server-less build (scanner runs in the browser),
// published as a Claude Artifact; see scripts/build-artifact.mjs.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    host: true,
    proxy: { "/api": "http://localhost:8787" },
  },
  ...(mode === "artifact"
    ? {
        base: "./",
        worker: { format: "es", rollupOptions: { output: { entryFileNames: "[name].js" } } },
        publicDir: "public-artifact",
        build: {
          outDir: "dist-artifact",
          emptyOutDir: true,
          modulePreload: false,
          chunkSizeWarningLimit: 4000,
          rollupOptions: { output: { inlineDynamicImports: true, entryFileNames: "app.js", assetFileNames: "[name][extname]" } },
        },
      }
    : {}),
}));
