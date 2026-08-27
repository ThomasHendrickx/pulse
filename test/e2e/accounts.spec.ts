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

// The seven movements to the household's own accounts, as the strings the
// month view and the naming screen render them in. Hand-written from the
// fixture, never read back from the implementation.
// They are DEBITS, so the naming screen renders them signed.
const OWN_MOVEMENT_AMOUNTS = [
  "-300,00",
  "-150,00",
  "-75,00",
  "-500,00",
  "-200,00",
  "-100,00",
  "-50,00",
] as const;

// The way a Belgian statement prints an account number, which is how the
// fixture's counterparty column is written.
const spacedForm = (compact: string): string =>
  compact.replace(/^(.{4})(.{4})(.{4})(.{4})$/, "$1 $2 $3 $4");

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
  const labelText = labels.join(" ");
  for (const account of ALL_EIGHT) {
    expect(
      labelText,
      `the naming screen offers the registered label ${account.label}`,
    ).not.toContain(account.label);
    expect(
      labelText,
      "the naming screen offers a registered account number",
    ).not.toContain(account.accountNumber);
    // And the SPACED rendering the statement actually carries, which is
    // what a raw string comparison would have let through.
    expect(labelText).not.toContain(spacedForm(account.accountNumber));
  }
  // The counterparty NAME the statement prints on those rows is not offered
  // either, which is what the label of such a group would have been.
  expect(labelText).not.toContain("EIGEN REKENING");
  expect(labelText).not.toContain("EIGEN SPAARREKENING");
  // And not one of the seven own movements is a group total here.
  const registeredTotals = await page
    .getByTestId("unresolved-group")
    .getByTestId("group-total")
    .allTextContents();
  for (const amount of OWN_MOVEMENT_AMOUNTS) {
    expect(
      registeredTotals,
      `${amount} is offered as a merchant group`,
    ).not.toContain(amount);
  }

  // (b) THE RESERVES BLOCK. Exactly the four savings accounts, each
  // rendering the LABEL the household typed. This is the assertion that
  // fails if the reserves join compares raw stored strings, because the
  // fixture writes its counterparty accounts SPACED and the registration
  // stores them compact.
  await page.goto("/?month=2026-08");
  await expect(page.getByTestId("month-title")).toHaveText("August 2026");
  await expect(page.getByTestId("reserve-group")).toHaveCount(SAVINGS.length);
  // EXACT labels, not a substring filter: three of the four typed labels
  // contain the word "savings", so a hasText filter would match several
  // rows and report a pass for the wrong reason.
  const reserveLabels = await page
    .getByTestId("reserve-group")
    .locator(".month-group-label")
    .allTextContents();
  expect([...reserveLabels].sort()).toEqual(
    SAVINGS.map((savings) => savings.label).sort(),
  );
  const reserveText = (
    await page.getByTestId("reserve-group").allTextContents()
  ).join(" ");
  expect(reserveText).not.toContain("BE");

  // (c) THE SPEND TOTAL, byte identical to a hand-written string, EXCLUDING
  // every own-account movement.
  await expect(page.getByTestId("spend-total")).toHaveText("98,97");
  await expect(page.getByTestId("income-total")).toHaveText("2.500,00");
  // Signed toward the reserve: the reserves block renders the parked
  // direction as positive.
  await expect(page.getByTestId("reserves-net")).toHaveText("+850,00");

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
  // THE SEVEN OWN MOVEMENTS ARE EACH THEIR OWN GROUP, which is what makes
  // this the same fixture failing rather than a different one passing: each
  // sibling account is a distinct counterparty identity, so its amount is a
  // group total of its own on the naming screen.
  const controlTotals = await page
    .getByTestId("unresolved-group")
    .getByTestId("group-total")
    .allTextContents();
  for (const amount of OWN_MOVEMENT_AMOUNTS) {
    expect(
      controlTotals.filter((total) => total === amount),
      `the control arm does not offer ${amount} as a merchant group, so the fixture cannot fail`,
    ).toHaveLength(1);
  }
  // And they are offered under the counterparty name the statement prints,
  // which is the naming the owner complained about being asked for.
  const controlLabels = (
    await page.getByTestId("group-label").allTextContents()
  ).join(" ");
  expect(controlLabels).toContain("EIGEN REKENING");
  expect(controlLabels).toContain("EIGEN SPAARREKENING");

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

// REWRITTEN FROM THE REFUSAL TEST M3-P14's CRITERION 14.5 SHIPPED
// (M3-P18, criterion 18.1): DR-0030 supersedes decision D-55, so a
// statement whose own account is registered in the SAVINGS ring is now
// ACCEPTED, its rows ingested and shown as held. The gate keeps its
// three-arm coverage: the unregistered refusal above and the card
// acceptance below stand unchanged.
test("a statement whose own account is registered in the SAVINGS ring is accepted, its rows held (DR-0030)", async ({
  page,
}) => {
  await signUpFresh(page, "acc-savings-accept");
  // The savings account the file belongs to, registered in the SAVINGS
  // ring at setup. Invented for M3-P18; provenance in
  // test/fixtures/allowed-identifiers.txt.
  await registerAccounts(page, [
    {
      label: "Savings",
      bank: "Demobank",
      accountNumber: "BE27910000000004",
      ring: "RESERVE",
    },
  ]);

  await page.goto("/import");
  await page
    .getByLabel("Bank export file")
    .setInputFiles(join(FIXTURES, "savings-statement.csv"));
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  // The account is registered, so there is nothing to declare and no
  // unregistered warning.
  await expect(page.getByTestId("account-declaration")).toHaveCount(0);
  await expect(page.getByTestId("landing-unregistered")).toHaveCount(0);

  await page.getByLabel("Format name").fill("Demobank savings statement");
  await page.getByTestId("confirm-import").click();

  // ACCEPTED: the import completes and every row lands. A tree in which
  // this upload is refused for its ring fails criterion 18.1.
  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("rows-added")).toHaveText("6");
  await expect(page.getByTestId("import-status")).toHaveCount(0);

  // And the rows are SHOWN, as held, under the account's typed label
  // (the full held-block contract is asserted in
  // test/e2e/month-view.spec.ts under criterion 18.2).
  await page.goto("/?month=2026-08");
  await expect(page.getByTestId("held-rows")).toBeVisible();
  await expect(
    page.getByTestId("held-rows").getByRole("heading", { name: "Savings" }),
  ).toBeVisible();
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

// Criterion 14.6, the second half: the CONSEQUENCE of leaving cards out of
// setup, witnessed rather than asserted. Before the card statement is
// imported the settlement debit is honest aggregate SPEND against the
// issuer; after it, the debit is INTERNAL and the card's own line items are
// the counted spend. Over the committed golden-journey fixtures, zero new
// fixtures.
//
// FIXTURE ARITHMETIC, by hand. gj-current.csv, August: +2.500,00 salary,
// -12,50, -86,47 and -950,00 outside spend, -300,00 to the second registered
// account (INTERNAL) and -850,00 settling the card. gj-card.csv: -450,00,
// -250,00 and -150,00 line items plus the +850,00 mirror credit.
//   before the card:  spend = 12,50 + 86,47 + 950,00 + 850,00 = 1.898,97
//   after the card:   spend = 12,50 + 86,47 + 950,00
//                           + 450,00 + 250,00 + 150,00 = 1.898,97
// The TOTAL is the same, which is the whole point of the card-settlement
// correction: the month must not count the settlement and the line items
// both. What changes is WHICH rows carry it, and that is what this asserts.
test("a card is not entered at setup, and importing its statement moves the settlement debit out of spend", async ({
  page,
}) => {
  await signUpFresh(page, "acc-card-consequence");
  await registerAccounts(page, [
    { label: "Daily account", bank: "Demobank", accountNumber: "BE68539007547034", ring: "POT" },
    { label: "Second account", bank: "Demobank", accountNumber: "BE59539007547099", ring: "POT" },
  ]);
  // The setup screen says the card is not wanted here, which is the whole
  // reason this state is reachable at all.
  await expect(page.getByTestId("cards-not-here")).toBeVisible();

  await page.goto("/import");
  await page
    .getByLabel("Bank export file")
    .setInputFiles(join(FIXTURES, "gj-current.csv"));
  await page.getByRole("button", { name: "Upload" }).click();
  await page.getByLabel("Format name").fill("Demobank current account");
  await page.getByTestId("confirm-import").click();
  await expect(page.getByTestId("rows-added")).toHaveText("8");

  // BEFORE. One aggregate spend row against the issuer, carrying the whole
  // settlement, and not one card line item anywhere.
  await page.goto("/?month=2026-08");
  await expect(page.getByTestId("spend-total")).toHaveText("1.898,97");
  const issuerRow = page
    .getByTestId("spend-group")
    .filter({ hasText: "KREDIETKAART" });
  await expect(issuerRow).toHaveCount(1);
  await expect(issuerRow.getByTestId("group-total")).toHaveText("850,00");
  for (const item of ["PIZZA NAPOLI", "ELEKTRO CITY", "BOEKHANDEL DE MAAN"]) {
    await expect(
      page.getByTestId("spend-group").filter({ hasText: item }),
    ).toHaveCount(0);
  }

  // The card arrives, and is declared at first sight because its statement
  // carries no account number.
  await page.goto("/import");
  await page
    .getByLabel("Bank export file")
    .setInputFiles(join(FIXTURES, "gj-card.csv"));
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByTestId("account-declaration")).toBeVisible();
  await page.getByLabel("Format name").fill("Card statement");
  await page.getByLabel("Label").fill("Credit card");
  await page.getByLabel("Bank").fill("Demokaart");
  await page.getByTestId("confirm-import").click();
  await expect(page.getByTestId("rows-added")).toHaveText("4");

  // AFTER. The debit is INTERNAL: it is in no group and no total, and the
  // card's own line items are the counted spend. The whole main region is
  // checked, so the settlement cannot hide in any block.
  await page.goto("/?month=2026-08");
  await expect(page.getByTestId("spend-total")).toHaveText("1.898,97");
  await expect(
    page.getByTestId("spend-group").filter({ hasText: "KREDIETKAART" }),
  ).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText("850,00");
  for (const [item, total] of [
    ["PIZZA NAPOLI", "450,00"],
    ["ELEKTRO CITY", "250,00"],
    ["BOEKHANDEL DE MAAN", "150,00"],
  ] as const) {
    const group = page.getByTestId("spend-group").filter({ hasText: item });
    await expect(group).toHaveCount(1);
    await expect(group.getByTestId("group-total")).toHaveText(total);
  }
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
