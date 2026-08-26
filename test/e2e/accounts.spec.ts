import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import {
  applyTextScale,
  clippingOffenders,
  horizontalOverflow,
  navLinkLineCounts,
  tapTargetOffenders,
} from "./phone-helpers";
import {
  fillSetupRows,
  registerAccounts,
  signUpFresh,
  type SetupRow,
} from "./setup-accounts";

// M3-P14. THE OWNER'S SCENARIO, END TO END.
//
// In the owner's own words: "I have 4 bank accounts, 4 saving accounts and 2
// credit cards. When I upload 1 bank account first, that one contains
// transfers to other accounts. Now Pulse asks me to name them as merchants,
// but they are not merchants." And their correction of the earlier design:
// "Can't we make it that when you make a new account, we just ask to give
// all account numbers and say pot or saving? We explicitly say credit card
// is not needed to give up front."
//
// EVERY VALUE IN THE FIXTURE AND IN THIS FILE IS INVENTED. The eight account
// numbers are the run 900000000001 through 900000000008 with computed check
// digits; the two outside counterparty accounts were already committed with
// their provenance. All of them are listed in
// test/fixtures/allowed-identifiers.txt. Nothing here was transcribed from
// any document.
//
// FIXTURE ARITHMETIC, derived from test/fixtures/setup-current.csv BY HAND
// and never read back from the implementation. All of it books in August
// 2026, which the webServer's fixed clock (2026-09-15) makes a closed month.
//
//   income   +2.500,00  Acme Salaris BV        outside, account basis
//   spend      -86,47   Supermarkt Noord       outside, account basis
//   spend      -12,50   Cafe Zomer             outside, NO counterparty
//                                              account: descriptor basis
//   own       -300,00   spending sibling one
//   own       -150,00   spending sibling two
//   own        -75,00   spending sibling three
//   own       -500,00   savings one
//   own       -200,00   savings two
//   own       -100,00   savings three
//   own        -50,00   savings four
//
// REGISTERED ARM: spend is 86,47 + 12,50 = 98,97, and the seven own
// movements are three INTERNAL and four RESERVE.
// CONTROL ARM: with only the current account registered, all seven fall to
// the sign rule and land in spend: 98,97 + 1.375,00 = 1.473,97.
//
// The two arms differ by EXACTLY the household's own movements, which is
// what stops a fixture built to pass from passing vacuously (hazard H14.1).

const FIXTURES = join(__dirname, "..", "fixtures");
const FIXTURE = "setup-current.csv";

const CURRENT: SetupRow = {
  label: "Daily account",
  bank: "Demobank",
  accountNumber: "BE73900000000001",
  ring: "POT",
};

const SPENDING_SIBLINGS: readonly SetupRow[] = [
  { label: "Joint account", bank: "Demobank", accountNumber: "BE46900000000002", ring: "POT" },
  { label: "Household account", bank: "Demobank", accountNumber: "BE19900000000003", ring: "POT" },
  { label: "Buffer account", bank: "Demobank", accountNumber: "BE89900000000004", ring: "POT" },
];

const SAVINGS: readonly SetupRow[] = [
  { label: "Savings", bank: "Demobank", accountNumber: "BE62900000000005", ring: "RESERVE" },
  { label: "Holiday savings", bank: "Demobank", accountNumber: "BE35900000000006", ring: "RESERVE" },
  { label: "Pension savings", bank: "Demobank", accountNumber: "BE08900000000007", ring: "RESERVE" },
  { label: "Car savings", bank: "Demobank", accountNumber: "BE78900000000008", ring: "RESERVE" },
];

const ALL_EIGHT: readonly SetupRow[] = [
  CURRENT,
  ...SPENDING_SIBLINGS,
  ...SAVINGS,
];

const OUTSIDE_MERCHANTS = 3;

const importFixture = async (page: Page, expectedAdded: string): Promise<void> => {
  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(join(FIXTURES, FIXTURE));
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  await page.getByLabel("Format name").fill("Demobank current account");
  await page.getByTestId("confirm-import").click();
  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("rows-added")).toHaveText(expectedAdded);
};

// ---------------------------------------------------------------------
// Criterion 14.1: two arms over fresh households, differing in exactly one
// thing: whether the seven sibling accounts were registered at setup.
// ---------------------------------------------------------------------

test("REGISTERED ARM: the household's own accounts are never offered as merchants", async ({
  page,
}) => {
  await signUpFresh(page, "acc-registered");
  await registerAccounts(page, ALL_EIGHT);
  await importFixture(page, "10");

  // (a) THE COMPLAINT ITSELF. The naming screen offers the outside
  // merchants and NOTHING ELSE.
  await page.goto("/merchants");
  await expect(page.getByTestId("unresolved-group")).toHaveCount(
    OUTSIDE_MERCHANTS,
  );
  const labels = await page.getByTestId("group-label").allTextContents();
  for (const account of ALL_EIGHT) {
    for (const label of labels) {
      expect(
        label,
        `the naming screen offers the registered label ${account.label}`,
      ).not.toContain(account.label);
      expect(
        label,
        "the naming screen offers a registered account number",
      ).not.toContain(account.accountNumber);
      // And the SPACED rendering the statement actually carries, which is
      // what a raw string comparison would have let through.
      expect(label).not.toContain(
        account.accountNumber.replace(
          /^(.{4})(.{4})(.{4})(.{4})$/,
          "$1 $2 $3 $4",
        ),
      );
    }
  }

  // (b) THE RESERVES BLOCK. Exactly the four savings accounts, each
  // rendering the LABEL the household typed. This is the assertion that
  // fails if the reserves join compares raw stored strings, because the
  // fixture writes its counterparty accounts SPACED and the registration
  // stores them compact.
  await page.goto("/?month=2026-08");
  await expect(page.getByTestId("month-title")).toHaveText("August 2026");
  await expect(page.getByTestId("reserve-group")).toHaveCount(SAVINGS.length);
  for (const savings of SAVINGS) {
    await expect(
      page.getByTestId("reserve-group").filter({ hasText: savings.label }),
    ).toHaveCount(1);
  }
  const reserveText = (
    await page.getByTestId("reserve-group").allTextContents()
  ).join(" ");
  expect(reserveText).not.toContain("BE");

  // (c) THE SPEND TOTAL, byte identical to a hand-written string, EXCLUDING
  // every own-account movement.
  await expect(page.getByTestId("spend-total")).toHaveText("98,97");
  await expect(page.getByTestId("income-total")).toHaveText("2.500,00");
  await expect(page.getByTestId("reserves-net")).toHaveText("850,00");

  // (d) THE RECONCILIATION PANEL names the unmatched internal legs for the
  // three spending siblings whose statements are absent, and the copy names
  // importing the other statement as the remedy.
  await expect(page.getByTestId("recon-cause-unmatched")).toBeVisible();
  await expect(page.getByTestId("unmatched-leg")).toHaveCount(
    SPENDING_SIBLINGS.length,
  );
  await expect(page.getByTestId("recon-cause-unmatched")).toContainText(
    "525,00",
  );
  await expect(page.getByTestId("recon-cause-unmatched")).toContainText(
    "import the other account's export",
  );
});

test("CONTROL ARM: with only the current account registered, the seven DO appear", async ({
  page,
}) => {
  await signUpFresh(page, "acc-control");
  await registerAccounts(page, [CURRENT]);
  await importFixture(page, "10");

  // The seven own accounts are offered as merchants, exactly the complaint.
  await page.goto("/merchants");
  await expect(page.getByTestId("unresolved-group")).toHaveCount(
    OUTSIDE_MERCHANTS + SPENDING_SIBLINGS.length + SAVINGS.length,
  );
  const labels = (await page.getByTestId("group-label").allTextContents()).join(
    " ",
  );
  for (const sibling of [...SPENDING_SIBLINGS, ...SAVINGS]) {
    const spaced = sibling.accountNumber.replace(
      /^(.{4})(.{4})(.{4})(.{4})$/,
      "$1 $2 $3 $4",
    );
    expect(
      labels.includes(sibling.accountNumber) || labels.includes(spaced),
      `the control arm does not offer ${sibling.label} as a merchant, so the fixture cannot fail`,
    ).toBe(true);
  }

  // And the same movements land in the spend total.
  await page.goto("/?month=2026-08");
  await expect(page.getByTestId("spend-total")).toHaveText("1.473,97");
  await expect(page.getByTestId("reserve-group")).toHaveCount(0);
});

// ---------------------------------------------------------------------
// Criterion 14.2: setup asks once, explains the rings BEFORE the answer,
// and says cards are not wanted.
// ---------------------------------------------------------------------

test("setup accepts eight accounts in one submission, with rows addable and removable", async ({
  page,
}) => {
  await signUpFresh(page, "acc-eight");
  await page.goto("/accounts");

  // One row to begin with, and the row it starts with cannot be removed.
  await expect(page.getByTestId("account-row")).toHaveCount(1);
  await expect(page.getByTestId("remove-account-row")).toHaveCount(0);

  // Addable.
  await page.getByTestId("add-account-row").click();
  await page.getByTestId("add-account-row").click();
  await expect(page.getByTestId("account-row")).toHaveCount(3);
  // And removable.
  await page.getByTestId("remove-account-row").first().click();
  await expect(page.getByTestId("account-row")).toHaveCount(2);
  await page.getByTestId("remove-account-row").first().click();
  await expect(page.getByTestId("account-row")).toHaveCount(1);

  // Eight accounts, ONE submit.
  await fillSetupRows(page, ALL_EIGHT);
  await expect(page.getByTestId("register-accounts")).toHaveCount(1);
  await page.getByTestId("register-accounts").click();
  await expect(page.getByTestId("registered-account")).toHaveCount(8);
});

test("the ring explanation is plainly visible BEFORE the ring control, with no interaction", async ({
  page,
}) => {
  await signUpFresh(page, "acc-explain");
  await page.goto("/accounts");

  const explainer = page.getByTestId("ring-explainer");
  const cards = page.getByTestId("cards-not-here");

  // VISIBLE, not merely present. A collapsed disclosure, a tooltip or
  // visually-hidden text all satisfy DOM order while the reader sees
  // nothing, and this explanation is the only guard between the owner and a
  // savings account silently marked as a spending account (hazard H14.4).
  await expect(explainer).toBeVisible();
  await expect(cards).toBeVisible();

  // In the terms the criterion names.
  await expect(explainer).toContainText(
    "counted in this month's income and spending",
  );
  await expect(explainer).toContainText("not counted");
  await expect(explainer).toContainText("money set aside");

  // Cards are explicitly not asked for.
  await expect(cards).toContainText("Credit cards are not entered here");
  await expect(cards).toContainText("the first time you import its statement");

  // BEFORE the ring control, in document order AND on screen.
  const ringControl = page.getByTestId("account-row").first().getByLabel("Ring");
  const explainerBox = await explainer.boundingBox();
  const ringBox = await ringControl.boundingBox();
  expect(explainerBox).not.toBeNull();
  expect(ringBox).not.toBeNull();
  expect(explainerBox?.y ?? 0).toBeLessThan(ringBox?.y ?? 0);
  const order = await page.evaluate(() => {
    const explainerNode = document.querySelector('[data-testid="ring-explainer"]');
    const ring = document.querySelector('[data-testid="account-row"] select');
    if (explainerNode === null || ring === null) {
      return "missing";
    }
    return explainerNode.compareDocumentPosition(ring) &
      Node.DOCUMENT_POSITION_FOLLOWING
      ? "explanation first"
      : "control first";
  });
  expect(order).toBe("explanation first");
});

// ---------------------------------------------------------------------
// Criterion 14.3: a typed account number is validated, and the other rows
// the owner typed are preserved rather than cleared.
// ---------------------------------------------------------------------

test("a mistyped account number is refused by name and the other rows survive", async ({
  page,
}) => {
  await signUpFresh(page, "acc-typo");
  await page.goto("/accounts");

  // Three rows: two good, and one whose last two digits are transposed, so
  // it is the right country and the right length and fails the checksum.
  await fillSetupRows(page, [
    CURRENT,
    { ...SPENDING_SIBLINGS[0]!, accountNumber: "BE46900000000020" },
    SAVINGS[0]!,
  ]);
  await page.getByTestId("register-accounts").click();

  // The message names the row that is wrong.
  await expect(page.getByTestId("account-row-error")).toHaveCount(1);
  await expect(page.getByTestId("account-row-error")).toContainText(
    "does not check out",
  );
  const rows = page.getByTestId("account-row");
  await expect(rows.nth(1).getByTestId("account-row-error")).toBeVisible();

  // AND THE OTHER ROWS ARE STILL THERE, with what the owner typed in them.
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).getByLabel("Label")).toHaveValue(CURRENT.label);
  await expect(rows.nth(0).getByLabel("Account number")).toHaveValue(
    CURRENT.accountNumber,
  );
  await expect(rows.nth(0).getByLabel("Ring")).toHaveValue("POT");
  await expect(rows.nth(2).getByLabel("Label")).toHaveValue(SAVINGS[0]!.label);
  await expect(rows.nth(2).getByLabel("Ring")).toHaveValue("RESERVE");

  // Nothing was registered.
  await expect(page.getByTestId("accounts-none")).toBeVisible();

  // Correcting the one bad row and submitting again registers all three.
  await rows.nth(1).getByLabel("Account number").fill(
    SPENDING_SIBLINGS[0]!.accountNumber,
  );
  await page.getByTestId("register-accounts").click();
  await expect(page.getByTestId("registered-account")).toHaveCount(3);
});

test("a submission with the ring unanswered is refused rather than defaulted", async ({
  page,
}) => {
  await signUpFresh(page, "acc-noring");
  await page.goto("/accounts");
  const row = page.getByTestId("account-row").first();
  await row.getByLabel("Label").fill(CURRENT.label);
  await row.getByLabel("Bank").fill(CURRENT.bank);
  await row.getByLabel("Account number").fill(CURRENT.accountNumber);
  await page.getByTestId("register-accounts").click();

  await expect(page.getByTestId("account-row-error")).toContainText(
    "spending account or a savings account",
  );
  await expect(page.getByTestId("accounts-none")).toBeVisible();
});

// ---------------------------------------------------------------------
// Criterion 14.5: the import's own account is a registered account or a
// card.
// ---------------------------------------------------------------------

test("a statement whose own account is not registered is refused, and the message links to setup", async ({
  page,
}) => {
  await signUpFresh(page, "acc-unregistered");
  // Setup is complete, but with a DIFFERENT account from the one the file
  // carries, so the refusal is about this file and not about an empty
  // household.
  await registerAccounts(page, [SPENDING_SIBLINGS[0]!]);

  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(join(FIXTURES, FIXTURE));
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  // The screen says so before the submit that will refuse it.
  await expect(page.getByTestId("landing-unregistered")).toBeVisible();
  // And there is no declaration to fill: the ring is answered at setup.
  await expect(page.getByTestId("account-declaration")).toHaveCount(0);

  await page.getByLabel("Format name").fill("Demobank current account");
  await page.getByTestId("confirm-import").click();

  await expect(page.getByTestId("import-status")).toBeVisible();
  await expect(page.getByTestId("import-status")).toContainText(
    "an account you have not registered",
  );
  await expect(
    page.getByTestId("import-status").getByRole("link", { name: "accounts screen" }),
  ).toHaveAttribute("href", "/accounts");

  // Nothing was ingested and no account was created.
  await expect(page.getByTestId("import-result")).toHaveCount(0);
  await page.goto("/accounts");
  await expect(page.getByTestId("registered-account")).toHaveCount(1);
  await page.goto("/");
  await expect(page.getByTestId("empty-state")).toBeVisible();
});

test("a statement whose own account is registered in the SAVINGS ring is refused, and the message names what the correction costs", async ({
  page,
}) => {
  await signUpFresh(page, "acc-savings-ring");
  // The same account number the file carries, registered as savings.
  await registerAccounts(page, [{ ...CURRENT, ring: "RESERVE" }]);

  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(join(FIXTURES, FIXTURE));
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  await page.getByLabel("Format name").fill("Demobank current account");
  await page.getByTestId("confirm-import").click();

  const status = page.getByTestId("import-status");
  await expect(status).toBeVisible();
  await expect(status).toContainText("registered as a savings account");
  // THE REMEDY, and its PRICE. A message naming the remedy without its
  // price fails this criterion (decision D-55's standing debt).
  await expect(status).toContainText("change its ring");
  await expect(status).toContainText("out of the reserves block");
  await expect(status).toContainText("stops counting as money set aside");
  await expect(
    status.getByRole("link", { name: "accounts screen" }),
  ).toHaveAttribute("href", "/accounts");

  await expect(page.getByTestId("import-result")).toHaveCount(0);
});

test("a card statement, which carries no own-account column, is accepted and declared at first sight", async ({
  page,
}) => {
  await signUpFresh(page, "acc-card");
  await registerAccounts(page, [CURRENT]);

  await page.goto("/import");
  await page
    .getByLabel("Bank export file")
    .setInputFiles(join(FIXTURES, "kbc-card.csv"));
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  // The card is declared HERE, at first sight, with NO ring control: a card
  // is a pot account by definition (decision D-48, criterion 14.6).
  await expect(page.getByTestId("account-declaration")).toBeVisible();
  await expect(page.getByLabel("Ring")).toHaveCount(0);

  await page.getByLabel("Format name").fill("Demobank card export");
  await page.getByLabel("Label").fill("Credit card");
  await page.getByLabel("Bank").fill("Demokaart");
  await page.getByTestId("confirm-import").click();
  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("landing-account")).toHaveText("Credit card");

  // Criterion 14.6: the accounts list shows the card once it exists, with
  // its ring, and says it carries no account number.
  await page.goto("/accounts");
  const card = page
    .getByTestId("registered-account")
    .filter({ hasText: "Credit card" });
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId("registered-account-ring")).toHaveText(
    "Spending account",
  );
  await expect(card.getByTestId("registered-account-number")).toHaveText(
    "Card, no account number",
  );
});

test("the ring control is gone from the import confirmation screen", async () => {
  // A grep, because the criterion asks for one: the ring is answered at
  // setup and a second place to answer it is a second place to answer it
  // wrongly.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(
    join(__dirname, "..", "..", "src", "modules", "import", "ui", "profile-confirmation.tsx"),
    "utf8",
  );
  expect(source).not.toContain('name="accountRole"');
  expect(source).not.toContain("accountRingField");
  expect(source).not.toContain("ringReserve");
});

// ---------------------------------------------------------------------
// Criterion 14.8: the ring correction, and the trap it has to describe.
// ---------------------------------------------------------------------

test("an account that already carries its own rows cannot have its ring changed, and the screen says so", async ({
  page,
}) => {
  await signUpFresh(page, "acc-ringfixed");
  await registerAccounts(page, ALL_EIGHT);
  await importFixture(page, "10");

  await page.goto("/accounts");
  const current = page
    .getByTestId("registered-account")
    .filter({ hasText: CURRENT.label });
  await current.getByTestId("switch-account-ring").click();

  const status = page.getByTestId("accounts-status");
  await expect(status).toBeVisible();
  // PLAINLY WHAT HAPPENED AND THAT IT IS FIXED. The reachable trap: a
  // savings account answered as a spending account at setup IS importable,
  // because the import gate only refuses an account registered as savings.
  // Once its statement lands, the ring is fixed for good, and the copy has
  // to say that rather than fail silently.
  await expect(status).toContainText("already carries statement rows of its own");
  await expect(status).toContainText("can no longer be changed");
  await expect(current.getByTestId("registered-account-ring")).toHaveText(
    "Spending account",
  );

  // A sibling with no rows of its own CAN still be corrected.
  const sibling = page
    .getByTestId("registered-account")
    .filter({ hasText: SPENDING_SIBLINGS[0]!.label });
  await sibling.getByTestId("switch-account-ring").click();
  await expect(page.getByTestId("accounts-status")).toContainText(
    "recalculated",
  );
  await expect(
    page
      .getByTestId("registered-account")
      .filter({ hasText: SPENDING_SIBLINGS[0]!.label })
      .getByTestId("registered-account-ring"),
  ).toHaveText("Savings account");
});

// ---------------------------------------------------------------------
// Criterion 14.7: the screen survives the phone, including eight rows of
// it. Runs at 390 and at 360, at 100, 150 and 200 percent text scale.
// ---------------------------------------------------------------------

for (const width of [390, 360] as const) {
  test.describe(`the accounts screen at ${width}`, () => {
    test.use({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });

    test(`eight rows are reachable and usable at ${width}`, async ({ page }) => {
      await signUpFresh(page, `acc-phone-${width}`);

      // REACHABLE FROM THE MONTH VIEW'S EMPTY STATE, which is the first
      // screen anyone sees.
      await page.goto("/");
      await expect(page.getByTestId("empty-state")).toBeVisible();
      await page.getByTestId("empty-state-accounts-link").click();
      await expect(page.getByTestId("accounts-screen")).toBeVisible();

      // AND FROM THE SHELL'S NAVIGATION ROW.
      await page.goto("/");
      await page.getByTestId("nav-accounts").click();
      await expect(page.getByTestId("accounts-screen")).toBeVisible();

      // THE ADDED LINK RENDERS ON AT MOST THE LARGEST LINE COUNT ANY
      // EXISTING LINK RENDERS ON. The number is measured off the row rather
      // than carried as a constant, so the added link cannot be the one
      // element the guard leaves free to be the offender.
      const linesAtRest = await navLinkLineCounts(page);
      const existing = Object.entries(linesAtRest)
        .filter(([id]) => id !== "nav-accounts")
        .map(([, lines]) => lines);
      expect(existing.length).toBe(3);
      expect(linesAtRest["nav-accounts"] ?? 99).toBeLessThanOrEqual(
        Math.max(...existing),
      );

      // Eight rows entered, and the sweep over the fully loaded screen.
      await fillSetupRows(page, ALL_EIGHT);
      await expect(page.getByTestId("account-row")).toHaveCount(8);

      for (const scale of [1, 1.5, 2]) {
        if (scale !== 1) {
          await applyTextScale(page, scale);
        }
        // Tap targets in BOTH dimensions, which is the half the pre-existing
        // helper did not measure and the half a fourth nav link can break.
        const offenders = await tapTargetOffenders(page, "both");
        expect(
          offenders,
          `tap targets below the floor at ${width} and ${scale * 100} percent`,
        ).toEqual([]);

        const clipping = await clippingOffenders(page);
        expect(
          clipping.horizontal,
          `horizontally clipped at ${width} and ${scale * 100} percent`,
        ).toEqual([]);
        expect(
          clipping.vertical,
          `vertically clipped at ${width} and ${scale * 100} percent`,
        ).toEqual([]);

        const overflow = await horizontalOverflow(page);
        expect(
          overflow.scrollWidth,
          `the document scrolls sideways at ${width} and ${scale * 100} percent`,
        ).toBeLessThanOrEqual(width);

        const lines = await navLinkLineCounts(page);
        const others = Object.entries(lines)
          .filter(([id]) => id !== "nav-accounts")
          .map(([, count]) => count);
        expect(
          lines["nav-accounts"] ?? 99,
          `the added nav link wraps further than every existing one at ${width} and ${scale * 100} percent`,
        ).toBeLessThanOrEqual(Math.max(...others));

        if (scale !== 1) {
          await page.reload();
          await fillSetupRows(page, ALL_EIGHT);
        }
      }

      // And the form still submits at this width.
      await page.getByTestId("register-accounts").click();
      await expect(page.getByTestId("registered-account")).toHaveCount(8);
    });
  });
}
