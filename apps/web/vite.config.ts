import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The web app consumes workspace packages as TypeScript sources, so no package
 * build step is needed for `pnpm web:dev`. Linked workspace packages must not be
 * pre-bundled: their sources are transformed by Vite directly.
 *
 * Dev proxy: /api, /v1 and /health are forwarded to the local API so the browser
 * talks to one origin and the HttpOnly session cookie stays first-party. The
 * proxy target follows PORT (the API's own override) — one env var moves the
 * whole stack.
 */
const apiPort = process.env.PORT ? Number(process.env.PORT) : 8787;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: process.env.DEV_PORT ? Number(process.env.DEV_PORT) : 5173,
    strictPort: true,
    host: true,
    proxy: {
      "/api": `http://localhost:${apiPort}`,
      "/v1": `http://localhost:${apiPort}`,
      "/health": `http://localhost:${apiPort}`,
    },
  },
  preview: { port: 5173, strictPort: true, host: true },
  resolve: {
    preserveSymlinks: false,
  },
  optimizeDeps: {
    exclude: [
      "@proofcore/billing",
      "@proofcore/contracts",
      "@proofcore/core",
      "@proofcore/module-world",
    ],
  },
});
