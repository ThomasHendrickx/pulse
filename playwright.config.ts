import { defineConfig, devices } from "@playwright/test";
import { enforceGateDbTarget } from "./src/platform/db/gate-target";

// The slow gate. Runs against `npm run dev` locally with a seeded database.
// Set PLAYWRIGHT_BASE_URL to point the same specs at a deployed environment
// (used by the deploy-verify stage); in that case no local server is started.
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

// THE GATE'S DATABASE TARGET IS DECIDED HERE, FIRST (M3-P12 fix round four,
// CRITERIA finding CR4-M3P12-02). See src/platform/db/gate-target.ts for the
// the reasoning. Two things happen on this line and both matter:
//
//   IT REFUSES a target no source named, and any target that is not a local
//   stack, by THROWING. A throw out of the config aborts the run before a
//   web server is spawned and before a worker opens a client, which is the
//   only moment early enough to be a mechanism rather than a warning.
//
//   IT ASSIGNS the approved values into process.env. This file used to spread
//   `...process.env` into both web servers, and Next's own loader does not
//   override a variable the shell already carries, so a .env file at the
//   package root was NOT a pin: the servers talked to whatever the container
//   held. After this line process.env carries the named target, so the
//   spreads below and every client any worker constructs resolve to it.
//
// IT IS SKIPPED IN DEPLOY-VERIFY MODE, where PLAYWRIGHT_BASE_URL names a
// deployed app: no server is started there and no database may be opened at
// all, which the one database-driving spec enforces for itself by skipping.
const gateDb =
  externalBaseUrl === undefined ? enforceGateDbTarget() : undefined;
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
      testIgnore: /prod-smoke/,
    },
    {
      name: "chromium-prod",
      use: { ...devices["Desktop Chrome"], baseURL: prodBaseURL },
      testMatch: /prod-smoke/,
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
      testMatch: /(month-view|navigation)\.spec\.ts/,
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
            env: { ...prodEnv, ...gateDb, PULSE_DIST_DIR: ".next-prod" },
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
          // The pinned target is spread AFTER process.env, deliberately and
          // not decoratively: the assignment above already put it there, and
          // spreading it again means a later edit that reintroduces an
          // ambient value cannot win by accident.
          env: {
            ...process.env,
            ...gateDb,
            PULSE_FIXED_NOW: "2026-09-15T12:00:00Z",
          },
          },
        ],
      }),
});
