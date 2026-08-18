import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The fast gate: unit, schema and property tests. In-process, no network,
// no browser. Playwright specs live under test/e2e and run through
// `npm run test:e2e`, never through this config.
export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/*" -> "./src/*" so domain modules resolve the
    // platform primitives the same way in tests as in the app.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/e2e/**", "node_modules/**"],
    environment: "node",
    testTimeout: 30_000,
  },
});
