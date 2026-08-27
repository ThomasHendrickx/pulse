import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { ensureRegistered, FIXTURE_ACCOUNT_A } from "./setup-accounts";

// General navigation (M3-P1, criterion 1.1, owner feedback DR-0002 item 1).
// Written BEFORE the nav existed: the red witness for this phase. Two
// journeys, each on a fresh household:
//
//   1. Empty household: the shell header carries the nav, and the empty
//      state's call to action is a real link whose click lands on /import,
//      instead of copy that only names the import screen.
//   2. Seeded household (mv-partial.csv, 4 rows): the header links
//      navigate between /, /import, /merchants and /accounts, the aria-current="page"
//      marker follows the route, and the nav is present on all three
//      routes.
//
// The nav must be rendered by the shell layout, not per page (hazard H1.1,
// finding PR2-006); the companion grep half of criterion 1.1 pins the
// testids below to src/app/(app)/layout.tsx and is run in the work
// history, since a per-page copy on these three routes would pass the
// route assertions here while shipping the next route bare.

const FIXTURES = join(__dirname, "..", "fixtures");

const NAV_LINKS = [
  { testId: "nav-overview", path: "/", label: "Overview" },
  { testId: "nav-import", path: "/import", label: "Import" },
  { testId: "nav-merchants", path: "/merchants", label: "Merchants" },
  // M3-P14's fourth link. The nav is asserted BY NAME rather than by count
  // (fleet environment warning), so a later phase appending a fifth adds a
  // row here instead of turning this red.
  { testId: "nav-accounts", path: "/accounts", label: "Accounts" },
] as const;

const signUp = async (page: Page, prefix: string): Promise<void> => {
  const unique = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(`${unique}@pulse-e2e.test`);
  await page.getByLabel("Password").fill(`pw-${unique}`);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);
};

// M3-P14: setup first, then the file. The ring is answered at setup and no
// longer on the confirmation screen.
const uploadPotFile = async (
  page: Page,
  file: string,
  label: string,
  expectedAdded: string,
): Promise<void> => {
  await ensureRegistered(page, {
    label,
    bank: "Demobank",
    accountNumber: FIXTURE_ACCOUNT_A,
    ring: "POT",
  });
  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(join(FIXTURES, file));
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  await page.getByLabel("Format name").fill("Demobank current account");
  await page.getByTestId("confirm-import").click();
  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("rows-added")).toHaveText(expectedAdded);
};

// Asserts the full nav state at one route: all three links present in the
// shell header, exactly the current route's link marked aria-current.
const expectNavOn = async (page: Page, activePath: string): Promise<void> => {
  await expect(page.getByTestId("main-nav")).toBeVisible();
  for (const link of NAV_LINKS) {
    const locator = page.getByTestId(link.testId);
    await expect(locator).toBeVisible();
    await expect(locator).toHaveText(link.label);
    if (link.path === activePath) {
      await expect(locator).toHaveAttribute("aria-current", "page");
    } else {
      await expect(locator).not.toHaveAttribute("aria-current", "page");
    }
  }
};

test("empty household: the nav is in the shell and the empty state links to import", async ({
  page,
}) => {
  await signUp(page, "nav-empty");

  // The default route shows the empty state, with the nav above it.
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expectNavOn(page, "/");

  // M3-P14, AND THIS ASSERTION CHANGED RATHER THAN BEING QUIETLY DROPPED
  // (clause R-087). Before this phase the empty state's one call to action
  // landed on /import and the file input was there. A household that has
  // registered NOTHING is now sent to the accounts screen before the import
  // screen will accept a file, because accounts used to be discovered one
  // statement at a time and every account a statement had not yet
  // introduced was offered as a merchant. So the empty state names setup
  // first, and the import link, followed by a household with nothing
  // registered, lands on the accounts screen.
  await expect(page.getByTestId("empty-state-accounts-link")).toBeVisible();
  await page.getByTestId("empty-state-accounts-link").click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByTestId("accounts-screen")).toBeVisible();
  await expectNavOn(page, "/accounts");

  await page.goto("/");
  await page.getByTestId("empty-state-import-link").click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByTestId("accounts-screen")).toBeVisible();

  // ONCE AN ACCOUNT IS REGISTERED, the import screen is reachable and the
  // file input is there, which is the half M3-P1 criterion 1.1 asserted.
  await ensureRegistered(page, {
    label: "Daily account",
    bank: "Demobank",
    accountNumber: FIXTURE_ACCOUNT_A,
    ring: "POT",
  });
  await page.goto("/");
  await page.getByTestId("empty-state-import-link").click();
  await expect(page).toHaveURL(/\/import$/);
  await expect(page.getByLabel("Bank export file")).toBeVisible();
  await expectNavOn(page, "/import");
});

test("import sub-route: the import link stays current on the confirm step (CR-601)", async ({
  page,
}) => {
  await signUp(page, "nav-subroute");

  // M3-P14: setup first, so the import screen accepts the file at all.
  await ensureRegistered(page, {
    label: "Daily account",
    bank: "Demobank",
    accountNumber: FIXTURE_ACCOUNT_A,
    ring: "POT",
  });

  // Upload a file and stop at the confirm step, which lives on the real
  // sub-route /import/<id> (the redirect in the upload action), the exact
  // journey the owner runs. Section membership, not string equality: the
  // import link must be marked current here too.
  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(join(FIXTURES, "mv-partial.csv"));
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/import\/[^/?]+/);

  await expect(page.getByTestId("main-nav")).toBeVisible();
  await expect(page.getByTestId("nav-import")).toHaveAttribute("aria-current", "page");
  // And only the import link: the month link at "/" stays exact-match,
  // so a prefix rule must not make it active everywhere.
  await expect(page.getByTestId("nav-overview")).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("nav-merchants")).not.toHaveAttribute("aria-current", "page");
});

test("seeded household: header links navigate and the active marker follows the route", async ({
  page,
}) => {
  await signUp(page, "nav-seeded");
  await uploadPotFile(page, "mv-partial.csv", "Daily account", "4");

  // Overview: nav present, overview marked current.
  await page.goto("/");
  await expect(page.getByTestId("month-title")).toBeVisible();
  await expectNavOn(page, "/");

  // Click through to import.
  await page.getByTestId("nav-import").click();
  await expect(page).toHaveURL(/\/import$/);
  await expect(page.getByLabel("Bank export file")).toBeVisible();
  await expectNavOn(page, "/import");

  // Click through to merchants.
  await page.getByTestId("nav-merchants").click();
  await expect(page).toHaveURL(/\/merchants$/);
  await expectNavOn(page, "/merchants");

  // And back to the overview; the month view renders again and the
  // marker moved with the route.
  await page.getByTestId("nav-overview").click();
  await expect(page.getByTestId("month-title")).toBeVisible();
  await expectNavOn(page, "/");
});

// Criterion 1.5 (owner-feedback amendment, 2026-08-21): the shipped header
// broke on the owner's phone while every gate ran at the desktop default
// viewport, because no criterion named a phone viewport. Both presentations
// are asserted here explicitly so neither regresses the other: at 390x844
// and at the desktop size, every authenticated route must show the nav
// links, the account identity and the sign-out control, with no horizontal
// scrolling (documentElement.scrollWidth within the viewport width).

const AUTH_ROUTES = ["/", "/import", "/merchants"] as const;

const expectFullHeaderWithoutHorizontalScroll = async (
  page: Page,
  viewportWidth: number,
): Promise<void> => {
  for (const path of AUTH_ROUTES) {
    await page.goto(path);
    await expect(page.getByTestId("main-nav")).toBeVisible();
    for (const link of NAV_LINKS) {
      await expect(page.getByTestId(link.testId)).toBeVisible();
    }
    await expect(page.getByTestId("household-context")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidth, `no horizontal scroll on ${path}`).toBeLessThanOrEqual(
      viewportWidth,
    );
  }
};

test.describe("phone viewport (criterion 1.5)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("at 390x844 the nav, identity and sign out are usable on every route", async ({
    page,
  }) => {
    await signUp(page, "nav-mobile");
    await expectFullHeaderWithoutHorizontalScroll(page, 390);

    // Clickable, not merely visible: sign out works at this viewport.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});

test.describe("desktop viewport (criterion 1.5, kept assertion)", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("at 1280x720 the nav, identity and sign out are usable on every route", async ({
    page,
  }) => {
    await signUp(page, "nav-desktop");
    await expectFullHeaderWithoutHorizontalScroll(page, 1280);
  });
});

// FINDING HZ-M3P7-05 (M3-P7 fix round). The shell rebuild moved the
// sign-out form into an identity row placed ahead of the navigation, so the
// FIRST Tab on every route in the product landed on Sign out. Document
// order and visual order agreed, so it was not a reading-order defect; it
// was the destructive control becoming the first stop for a keyboard or a
// switch user, and nothing measured it. Nothing in the fifteen criteria
// names the header's focusable sequence and no spec pressed Tab.
//
// The header keeps its two visual rows. What changed is that the rows are
// placed with CSS grid rather than by document order, which is the same
// technique the three month-view cards already use and the same reason:
// the order the document has is the order that is read.
test.describe("shell header focus order (M3-P7 fix round, HZ-M3P7-05)", () => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 720 },
  ] as const) {
    test(`at ${viewport.width} the navigation is reached before sign out`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await signUp(page, `nav-focus-${viewport.width}`);
      await page.goto("/");
      await expect(page.getByTestId("main-nav")).toBeVisible();

      const reached: { name: string; top: number }[] = [];
      // FIVE STOPS SINCE M3-P14, which adds a fourth navigation link. The
      // number follows the enumeration above rather than being pinned by
      // hand, so a later phase appending a fifth link changes one list.
      for (let step = 0; step < NAV_LINKS.length + 1; step += 1) {
        await page.keyboard.press("Tab");
        reached.push(
          await page.evaluate(() => {
            const active = document.activeElement;
            if (active === null) {
              return { name: "(none)", top: -1 };
            }
            return {
              name:
                active.getAttribute("data-testid") ??
                (active.textContent ?? "").trim().slice(0, 20),
              top: Math.round(active.getBoundingClientRect().top),
            };
          }),
        );
      }

      expect(
        reached.map((stop) => stop.name),
        "the first stops are the nav links in order, then sign out",
      ).toEqual([...NAV_LINKS.map((link) => link.testId), "Sign out"]);

      // FINDING HZ2-07 (follow-up round). Buying the tab sequence cost the
      // property round 0 had recorded as holding: at 390 focus ran along the
      // second visual row and then jumped back UP to the sign-out control on
      // the first. Document order and visual order have to agree, which is
      // the promise this header's own comment makes and the promise the
      // whole grid-placement rule in this phase rests on. Non-decreasing
      // tops is that promise as a number.
      const tops = reached.map((stop) => stop.top);
      const sorted = [...tops].sort((a, b) => a - b);
      expect(
        tops,
        `focus runs down the header, never back up, at ${viewport.width}`,
      ).toEqual(sorted);
    });
  }
});
