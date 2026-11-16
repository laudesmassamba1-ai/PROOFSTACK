import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit/integration tests run against TypeScript sources, so `pnpm test` needs no
 * build step. The published artifacts are checked separately by `pnpm build`.
 */
const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@proofstack/core": src("packages/core/src/index.ts"),
      "@proofstack/contracts": src("packages/contracts/src/index.ts"),
      "@proofstack/config": src("packages/config/src/index.ts"),
      "@proofstack/engine": src("packages/engine/src/index.ts"),
      "@proofstack/module-world": src("packages/modules/world/src/index.ts"),
      "@proofstack/module-flow": src("packages/modules/flow/src/index.ts"),
      "@proofstack/module-exit": src("packages/modules/exit/src/index.ts"),
      "@proofstack/adapter-payments": src("packages/adapters/payments/src/index.ts"),
      "@proofstack/adapter-browser": src("packages/adapters/browser/src/index.ts"),
      "@proofstack/adapter-exports": src("packages/adapters/exports/src/index.ts"),
      "@proofstack/adapter-reporting": src("packages/adapters/reporting/src/index.ts"),
      "@proofstack/billing": src("packages/billing/src/index.ts"),
      "@proofstack/sdk": src("packages/sdk/src/index.ts"),
      "@proofstack/db": src("packages/db/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/unit/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "packages/modules/*/src/**", "packages/adapters/*/src/**"],
      exclude: ["**/*.test.ts", "**/dist/**"],
      reporter: ["text", "json-summary"],
    },
  },
});
