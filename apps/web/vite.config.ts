import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * lucide-react ships a CJS main; without this alias Rollup bundles the CJS
 * interop with every icon in the library (~220 kB loaded on every route). The
 * ESM entry tree-shakes to the handful of icons each page actually imports.
 */
const lucideAlias = fileURLToPath(
  new URL("./node_modules/lucide-react/dist/esm/lucide-react.mjs", import.meta.url)
);

/**
 * The web app consumes workspace packages as TypeScript sources, so no package
 * build step is needed for `pnpm web:dev`. Linked workspace packages must not be
 * pre-bundled: their sources are transformed by Vite directly.
 *
 * Dev proxy: /api, /v1 and /health are forwarded to the local API so the browser
 * talks to one origin and the HttpOnly session cookie stays first-party.
 *
 * `API_PORT` wins over `PORT` on purpose. `PORT` is also how a *web* process is told
 * which port to listen on (the e2e harness does exactly that), so reading only `PORT`
 * made the proxy point at the web server itself and answer 502 for every API call —
 * a loop that looks like a dead backend.
 */
const apiPort = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);

export default defineConfig(() => ({
  build: {
    rollupOptions: {
      output: {
        // React ships CJS only. Without this, the CJS module is duplicated: one
        // copy in the entry chunk and one hoisted into the shared async chunk of
        // the lazy routes (~140 kB extra on every page). advancedChunks pins the
        // react graph into one named chunk that both graphs share.
        advancedChunks: {
          groups: [
            {
              name: "reactVendor",
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "lucide-react": lucideAlias,
    },
    dedupe: ["react", "react-dom"],
    preserveSymlinks: false,
  },
  server: {
    port: process.env.DEV_PORT ? Number(process.env.DEV_PORT) : 5173,
    strictPort: true,
    host: true,
    proxy: {
      // 127.0.0.1, not localhost: on some hosts "localhost" resolves to ::1 first and
      // the proxy stalls on a DNS/IPv6 lookup instead of failing fast.
      "/api": `http://localhost:${apiPort}`,
      "/v1": `http://localhost:${apiPort}`,
      "/health": `http://localhost:${apiPort}`,
    },
  },
  preview: { port: 5173, strictPort: true, host: true },
  optimizeDeps: {
    exclude: [
      "@proofcore/billing",
      "@proofcore/contracts",
      "@proofcore/core",
      "@proofcore/module-world",
    ],
  },
}));
