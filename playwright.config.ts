import { defineConfig, devices } from "@playwright/test";

// The slow gate. Runs against `npm run dev` locally with a seeded database.
// Set PLAYWRIGHT_BASE_URL to point the same specs at a deployed environment
// (used by the deploy-verify stage); in that case no local server is started.
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseUrl ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command: "npm run dev",
          url: baseURL,
          // NEVER reuse a server this config did not start (fix round 1,
          // finding CR-505): a stale dev server from another worktree
          // would serve the suite WITHOUT the pinned clock below, and
          // every partial-month assertion would silently depend on the
          // real date. With reuse off, an occupied port fails the run
          // loudly instead.
          reuseExistingServer: false,
          timeout: 120_000,
          // Deterministic clock (M1-P5, criterion 4.2): the app's notion
          // of "now" is pinned mid-September 2026 so the committed
          // absolute-month fixtures keep their meaning forever: September
          // 2026 is the partial current month, August 2026 a closed month
          // compared against July 2026. Parsed by fixedNowOverride in
          // src/platform/config.ts, consumed by appClock only.
          env: {
            ...process.env,
            PULSE_FIXED_NOW: "2026-09-15T12:00:00Z",
          },
        },
      }),
});
