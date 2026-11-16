import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The web app consumes workspace packages as TypeScript sources, so no package
 * build step is needed for `pnpm web:dev`. Linked workspace packages must not be
 * pre-bundled: their sources are transformed by Vite directly.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: process.env.DEV_PORT
      ? Number(process.env.DEV_PORT)
      : process.env.PORT
        ? Number(process.env.PORT)
        : 5173,
    strictPort: true,
    host: true,
  },
  preview: { port: 5173, strictPort: true },
  resolve: {
    preserveSymlinks: false,
  },
  optimizeDeps: {
    exclude: [
      "@proofstack/billing",
      "@proofstack/contracts",
      "@proofstack/core",
      "@proofstack/module-world",
    ],
  },
});
