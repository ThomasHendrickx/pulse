import { defineConfig } from "vitest/config";

// The fast gate: unit, schema and property tests. In-process, no network,
// no browser. Playwright specs live under test/e2e and run through
// `npm run test:e2e`, never through this config.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/e2e/**", "node_modules/**"],
    environment: "node",
    testTimeout: 30_000,
  },
});
