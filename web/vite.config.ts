import { defineConfig } from "vite";

// Dev server proxies REST + WS to the Node server (default :8080) so the SPA can
// run on Vite's :5173 during development and still reach the live data.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
