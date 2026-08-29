import { defineConfig, devices } from "@playwright/test";

// The slow gate. Runs against `npm run dev` locally with a seeded database.
// Set PLAYWRIGHT_BASE_URL to point the same specs at a deployed environment
// (used by the deploy-verify stage); in that case no local server is started.
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

// THE GATE'S MODULE-SCOPE TARGET ENFORCEMENT IS WITHDRAWN, loudly (clause
// R-087, decision D-62, criterion 12.23). A call to enforceGateDbTarget from
// src/platform/db/gate-target.ts stood here (M3-P12 fix round four, CRITERIA
// finding CR4-M3P12-02): it THREW during config load on a database target no
// source named or one that was not a local stack, and it ASSIGNED the
// approved values into process.env for the webServer env blocks below. That
// module left the tree with the target interlock D-62 withdrew. What stands
// in its place is the posture the repository already has: the servers this
// config starts resolve DATABASE_URL from the invoking shell, db:reset and
// db:migrate stay behind guard-cli's local-only refusal, and the client's
// own construction-time guard (assessNonProductionDbTarget) refuses a
// non-local target in every non-production process, the gate's dev server
// included. The gate's target question beyond that refusal is carried on the
// plan's parked surface rather than answered here.
const baseURL = externalBaseUrl ?? "http://127.0.0.1:3000";
// The production-mode server (deploy-verify defect round): the owner's
// production 500 lived in behaviour next dev never exercises (runtime
// module resolution of the built server), so the gate now drives ONE
// smoke journey against next start as well. Scoping, recorded: a single
// prod-mode smoke spec (health probe, sign-in, PDF upload through the
// declaration, month view) rather than the whole suite, to keep the
// gate's duration bounded; the full behavioural matrix stays on the dev
// server where iteration is cheap.
const prodBaseURL = externalBaseUrl ?? "http://127.0.0.1:3100";
// The prod server refuses a frozen clock by design (the app's own
// production guard), so its env drops PULSE_FIXED_NOW; the smoke spec
// only asserts clock-independent states (a fully past month).
const prodEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) => key !== "PULSE_FIXED_NOW" && value !== undefined,
  ),
) as Record<string, string>;

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    // Fix round 1, finding CR-903: full runs lost single tests to
    // MOVING chromium renderer crashes ("Page crashed" on page.goto, a
    // different pre-existing test each run, never an assertion, green in
    // isolation), in the review container and then reproduced once in
    // the implementer container. MEASURED ROOT CAUSE THERE: the
    // container's root filesystem was 100% full (54MB free) and the
    // kernel log showed chrome-headless-shell Compositor processes
    // trapping (dmesg "traps: Compositor ... trap int3"); after
    // reclaiming ~3GB of caches the full suite passed with zero
    // renderer traps. So the first diagnostic for this failure shape is
    // DISK, not the suite: check df -h and dmesg before touching tests.
    // The flags below stay as harmless in-container hardening (both
    // remove chromium crash surfaces no test here needs), but they are
    // NOT what fixed the witnessed crashes; the disk reclaim was.
    launchOptions: {
      args: ["--disable-dev-shm-usage", "--disable-gpu"],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // optimistic-naming runs against the PRODUCTION server only (M3-P11,
      // decision D-34, finding DELTA-M0P4-09): the spec drives en, nl and
      // fr itself, so a development pass would repeat the whole matrix a
      // third time for nothing the dev-server specs do not already record.
      testIgnore: /prod-smoke|optimistic-naming/,
    },
    {
      name: "chromium-prod",
      use: { ...devices["Desktop Chrome"], baseURL: prodBaseURL },
      // M3-P11: the prediction, failure and difference measurements run at
      // the desk width against the production build as well (criteria 11.2
      // and 11.4 name both widths).
      testMatch: /(prod-smoke|optimistic-naming)\.spec\.ts/,
    },
    // THE PHONE PROJECT (M3-P7, DR-0022, criterion 7.12). A chromium mobile
    // device descriptor at the mockup's own frame size. The two specs that
    // carry the month view and the shell run under this project AND under
    // the desktop project above, so a regression at either width is red.
    //
    // CORRECTED RATHER THAN QUIETLY REWRITTEN (clause R-087, M3-P7 fix
    // round, finding HZ-M3P7-06). This comment used to say that without
    // isMobile the meta viewport tag is never exercised and that the phone
    // specs shipped before this phase could not see whether the tag was
    // there at all. THAT WAS FALSE of the guard as written: reading the
    // tag's content attribute out of the DOM works in any project and does
    // pass under the desktop project, which the suite's own run shows.
    // What isMobile actually buys is that the browser HONOURS the tag, so
    // window.innerWidth is the declared device width rather than a layout
    // viewport Playwright sized directly. That is now asserted beside the
    // DOM read in test/e2e/month-view.spec.ts, and it is the assertion this
    // project exists for.
    {
      name: "chromium-phone",
      use: {
        ...devices["Pixel 5"],
        isMobile: true,
        hasTouch: true,
        viewport: { width: 390, height: 844 },
      },
      // M3-P9 widens this to carry the pressed, disabled and busy
      // measurement at 390 by 844 as well as at the desk width, under the
      // touch emulation this project declares: a held press measured
      // without hasTouch is a desktop measurement at a phone width, which
      // is the error class this round exists to avoid.
      // M3-P10 FIX ROUND 2 adds merchants (criteria finding CR-M3P10-05).
      // Criterion 10.8 asks that the merchant journey passes unchanged
      // "under BOTH PROJECTS", and it was discovered under the desk
      // project only: no phone project's testMatch reached it, so the arm
      // was never runnable and nothing said so. The file already drives
      // its card-label describe at 390 by 844 through its own test.use,
      // so what this line adds is the FIRST journey (naming an unresolved
      // counterparty) at the phone width, under this project's touch
      // emulation. NOT EXECUTED IN THE ROUND THAT ADDED IT: the fix-round
      // container has no Docker and therefore no auth service, so every
      // journey here signs up and none can run. The widening is recorded
      // as owed execution in delivery/work-history/m3-p10.yaml rather
      // than claimed green.
      testMatch: /(month-view|navigation|pressed-and-disabled|busy-state|merchants)\.spec\.ts/,
    },
    // THE PRODUCTION-MODE PHONE PROJECT (M3-P10, decision D-34). The same
    // chromium mobile descriptor as the project above, bound to the server
    // this config already builds and starts with `npm run build` and
    // `npx next start`, because that is the build the owner presses and it
    // differs from the dev server in exactly the dimension the navigation
    // measurement turns on: viewport prefetching is disabled in
    // development, so a pending state proved only against `next dev` proves
    // nothing about the owner's screen.
    //
    // WHAT THIS COSTS, and both halves are real. The production server
    // refuses a frozen clock by the app's own guard, so prodEnv above drops
    // PULSE_FIXED_NOW and the spec below must be clock-independent: it
    // reaches a month through the month view's own query parameter rather
    // than through whatever month the clock gives. And the phase cannot
    // close unless the production bundle builds, which is the right gate to
    // depend on.
    {
      name: "chromium-phone-prod",
      use: {
        ...devices["Pixel 5"],
        isMobile: true,
        hasTouch: true,
        viewport: { width: 390, height: 844 },
        baseURL: prodBaseURL,
      },
      // M3-P11 adds the optimistic-naming measurements here: criterion 11.2
      // names this project for the 390 by 844 half of the matrix.
      testMatch: /(busy-state|optimistic-naming)\.spec\.ts/,
    },
  ],
  ...(externalBaseUrl
    ? {}
    : {
        webServer: [
          {
            // The production-mode server: its own dist directory so the
            // build cannot race the dev server's .next (PULSE_DIST_DIR,
            // see next.config.ts), its own port, no frozen clock.
            command: "npm run build && npx next start -p 3100",
            url: prodBaseURL,
            reuseExistingServer: false,
            // Building inside the webServer is what makes the gate
            // exercise the real production bundle; the timeout covers
            // prisma generate plus next build.
            timeout: 300_000,
            env: { ...prodEnv, PULSE_DIST_DIR: ".next-prod" },
          },
          {
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
        ],
      }),
});
