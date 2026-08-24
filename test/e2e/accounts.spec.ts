import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";

// THE OWNER'S SCENARIO, END TO END (M3-P14 and M3-P15).
//
// The owner has four bank accounts, four savings accounts and two credit
// cards. They upload one bank account's statement first, that statement
// carries transfers to the other accounts, and Pulse asks them to name those
// accounts as merchants. They are not merchants. These specs walk what the
// household now does instead, and they walk the wrong answers too.
//
// THE FIXTURE, and every value in it is invented. test/fixtures/ar-current.csv
// is one current account's August 2026 export carrying, by hand:
//     +3.200,00  salary                                   INCOME
//      -45,00    Bakkerij Ochtend        }
//     -120,50    Warenhuis Zuid          }  three outside merchants
//      -32,25    Apotheek Lindeboom      }   = 197,75 of ordinary spend
//     -100,00 -150,00 -200,00  transfers to THREE pot siblings   = 450,00
//     -250,00 -300,00 -350,00 -400,00 transfers to FOUR savings  = 1.300,00
//
// So, computed from the fixture's own arithmetic and never read back from
// the implementation:
//     CONTROL arm, nothing registered:  spend = 197,75 + 450,00 + 1.300,00
//                                             = 1.947,75, reserves-net 0,00
//     REGISTERED arm, all seven known:  spend = 197,75, reserves 1.300,00
//     the difference between the arms         = 1.750,00, which is exactly
//     every movement between accounts the household owns: its savings PLUS
//     its pot-to-pot transfers. The pot siblings are SPEND in the control
//     arm and INTERNAL in the registered one, so they leave the spend total
//     alongside the four savings transfers.
//     income                                  = 3.200,00 in BOTH arms
//     pot-change = 3.200,00 - 1.947,75        = 1.252,25 in BOTH arms,
//     because every row carries a flow either way and the change in the pot
//     sums every row that has one.

const FIXTURES = join(__dirname, "..", "fixtures");

// THESE ARE LONG JOURNEYS AND THE BUDGET SAYS SO. Registering seven accounts
// is seven form round-trips, each of which writes a declaration and then runs
// a full recompute, on a dev server that compiles on first hit. Measured
// while building this: roughly four seconds per account, so the default
// thirty-second test timeout expires part-way through and the failure
// SCREENSHOT looks like a server error (an empty main with the dev overlay's
// alert) rather than like a timeout. That cost an hour, so it is written
// down: if one of these fails with an empty main, read the elapsed time
// before reading the page.
test.describe.configure({ timeout: 180_000 });

const CONTROL_SPEND = "1.947,75";
const REGISTERED_SPEND = "197,75";
// SignedAmount renders the DIRECTION on a non-zero total, so the parked
// magnitude reaches the page with its sign. Written out here with the glyph
// rather than stripped in the assertion, because what the criterion asks for
// is a byte comparison against a string written by hand from the fixture's
// own arithmetic, and the string the reader sees is this one.
const RESERVES_NET = "+1.300,00";
const INCOME = "3.200,00";
const POT_CHANGE = "1.252,25";

const OWN = [
  { number: "BE66901100002243", ring: "POT", label: "Joint account", group: "EIGEN REKENING SAMEN" },
  { number: "BE42901100003354", ring: "POT", label: "Household account", group: "EIGEN REKENING HUISHOUDEN" },
  { number: "BE18901100004465", ring: "POT", label: "Spare account", group: "EIGEN REKENING RESERVE" },
  { number: "BE24902200001138", ring: "RESERVE", label: "Buffer", group: "EIGEN SPAARREKENING BUFFER" },
  { number: "BE97902200002249", ring: "RESERVE", label: "Holiday fund", group: "EIGEN SPAARREKENING VAKANTIE" },
  { number: "BE73902200003360", ring: "RESERVE", label: "Roof fund", group: "EIGEN SPAARREKENING DAK" },
  { number: "BE49902200004471", ring: "RESERVE", label: "Long term", group: "EIGEN SPAARREKENING LANG" },
] as const;

// The three outside merchants, as the naming screen groups them. Written by
// hand so the registered arm's assertion is a set DIFFERENCE of exactly the
// seven own accounts and not merely a smaller number.
const OUTSIDE_GROUPS = [
  "BAKKERIJ OCHTEND",
  "WARENHUIS ZUID",
  "APOTHEEK LINDEBOOM",
];


// EVERY SUBMIT WAITS FOR ITS OWN NAVIGATION, and this is a correctness rule
// rather than a style. A server action here writes a declaration and then
// runs a FULL RECOMPUTE, so the request takes seconds; clicking and then
// navigating away immediately races it, and the page that loads shows the
// state BEFORE the correction while the server goes on to apply it. That
// failure reads exactly like a broken recompute: the month showed eleven
// uninterpreted rows and no accounts entry, and the database showed the
// same rows correctly interpreted a minute later. Two hours went into
// reading the engine before the race was the answer, so it is written here.
const submit = async (page: Page, click: Promise<void>): Promise<void> => {
  await Promise.all([page.waitForURL(/[?&]status=/), click]);
};

const signUp = async (page: Page, prefix: string): Promise<void> => {
  const unique = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(`${unique}@pulse-e2e.test`);
  await page.getByLabel("Password").fill(`pw-${unique}`);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);
};

const uploadFile = async (
  page: Page,
  file: string,
  label: string,
  ring: "POT" | "RESERVE" | null,
  expectedAdded: string,
): Promise<void> => {
  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(join(FIXTURES, file));
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  await page.getByLabel("Format name").fill(`Demobank ${label}`);
  const declaration = page.getByTestId("account-declaration");
  if (await declaration.isVisible()) {
    await page.getByLabel("Label").fill(label);
    await page.getByLabel("Bank").fill("Demobank");
    if (ring !== null) {
      await page.getByTestId("account-ring").selectOption(ring);
    }
  }
  await page.getByTestId("confirm-import").click();
  if (expectedAdded === "") {
    return;
  }
  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("rows-added")).toHaveText(expectedAdded);
};

const register = async (
  page: Page,
  account: { number: string; ring: string; label: string },
): Promise<void> => {
  await page.goto("/accounts");
  await page.getByTestId("account-label").fill(account.label);
  await page.getByTestId("account-bank-field").fill("Demobank");
  await page.getByTestId("account-number").fill(account.number);
  await page.getByTestId("account-ring-field").selectOption(account.ring);
  await submit(page, page.getByTestId("register-account").click());
  await expect(page.getByTestId("accounts-status")).toBeVisible({
    timeout: 30_000,
  });
};

const registerAll = async (page: Page): Promise<void> => {
  for (const own of OWN) {
    await register(page, own);
  }
};

// READ THE LABELS ONLY ONCE THE PAGE HAS ACTUALLY RENDERED. allInnerTexts
// resolves immediately against whatever is in the DOM, so a read issued
// before the server component's content arrives returns an EMPTY ARRAY, and
// an empty array satisfies "does not contain the own-account groups" while
// telling you nothing. That is a test that passes for the wrong reason on
// the assertion this whole phase turns on, so the wait is on a marker the
// page renders in every state rather than on the groups themselves.
const groupLabels = async (page: Page): Promise<string[]> => {
  await page.goto("/merchants");
  await expect(page.getByTestId("unresolved-count")).toBeVisible({
    timeout: 30_000,
  });
  return page.getByTestId("group-label").allInnerTexts();
};

// ---------------------------------------------------------------------
// CRITERION 14.1: the owner's scenario, and the fixture proved capable of
// failing.
// ---------------------------------------------------------------------

test("CONTROL ARM: with nothing registered, the household's own seven accounts are offered as merchants to name", async ({
  page,
}) => {
  await signUp(page, "ar-control");
  await uploadFile(page, "ar-current.csv", "Current account", "POT", "11");

  const labels = await groupLabels(page);
  // THE CONTROL ARM IS WHAT MAKES THE REGISTERED ARM'S ZERO MEANINGFUL. A
  // fixture that produced no own-account groups at all would fail HERE
  // rather than pass the phase.
  for (const own of OWN) {
    expect(labels, `${own.label} is not offered as a merchant`).toContain(
      own.group,
    );
  }
  for (const outside of OUTSIDE_GROUPS) {
    expect(labels).toContain(outside);
  }

  // And the money is in the wrong place, which is the defect itself.
  await page.goto("/?month=2026-08");
  await expect(page.getByTestId("spend-total")).toHaveText(CONTROL_SPEND);
  await expect(page.getByTestId("income-total")).toHaveText(INCOME);
  await expect(page.getByTestId("pot-change")).toHaveText(POT_CHANGE);
  await expect(page.getByTestId("reserves-net")).toHaveText("0,00");
});

test("REGISTERED ARM: registering the seven first leaves only the outside merchants, and the savings appear as savings", async ({
  page,
}) => {
  await signUp(page, "ar-registered");
  await registerAll(page);
  await uploadFile(page, "ar-current.csv", "Current account", "POT", "11");

  const labels = await groupLabels(page);
  // A SET DIFFERENCE OF EXACTLY THE SEVEN, not merely a smaller number.
  for (const own of OWN) {
    expect(labels, `${own.label} is still offered as a merchant`).not.toContain(
      own.group,
    );
  }
  for (const outside of OUTSIDE_GROUPS) {
    expect(labels).toContain(outside);
  }
  // No group label is an account number or a registered account label.
  for (const own of OWN) {
    expect(labels).not.toContain(own.number);
    expect(labels).not.toContain(own.label.toUpperCase());
  }

  // CRITERION 14.2, THE SAVINGS CASE, WHICH NO EXISTING TEST CAN CATCH.
  await page.goto("/?month=2026-08");
  await expect(page.getByTestId("no-reserves")).toHaveCount(0);
  await expect(page.getByTestId("reserves-net")).toHaveText(RESERVES_NET);
  await expect(page.getByTestId("reserve-group")).toHaveCount(4);
  await expect(page.getByTestId("spend-total")).toHaveText(REGISTERED_SPEND);
  await expect(page.getByTestId("income-total")).toHaveText(INCOME);

  // Each reserve group's label is the LABEL THE HOUSEHOLD TYPED, and no
  // reserve-group label carries an account-shaped token. This fails if the
  // reserves join compares raw stored strings.
  const reserveText = await page.getByTestId("reserve-group").allInnerTexts();
  for (const own of OWN.filter((a) => a.ring === "RESERVE")) {
    expect(
      reserveText.some((text) => text.includes(own.label)),
      `no reserve group is labelled ${own.label}`,
    ).toBe(true);
  }
  // NO RESERVE-GROUP LABEL CARRIES AN ACCOUNT-SHAPED TOKEN, which is what
  // fails if the reserves join compares raw stored strings and falls back
  // to the counterparty account instead of the household's typed label.
  for (const text of reserveText) {
    expect(text).not.toMatch(/[A-Z]{2}\d{2}\d{10,}/);
  }

  // CRITERION 14.8: the new gap is named, with its remedy, and the verdict
  // stops reading as books closing. Three pot siblings whose own statements
  // have not been imported are three unmatched internal legs.
  await expect(page.getByTestId("recon-cause-unmatched")).toBeVisible();
  await expect(page.getByTestId("recon-cause-unmatched")).toContainText("3");
});

// ---------------------------------------------------------------------
// CRITERION 14.5: registration heals rows that are already there.
// ---------------------------------------------------------------------

test("HEALING: importing first and registering afterwards reaches the same place, with no further upload", async ({
  page,
}) => {
  await signUp(page, "ar-heal");
  await uploadFile(page, "ar-current.csv", "Current account", "POT", "11");
  expect(await groupLabels(page)).toContain(OWN[0].group);

  await registerAll(page);

  const labels = await groupLabels(page);
  for (const own of OWN) {
    expect(labels).not.toContain(own.group);
  }
  await page.goto("/?month=2026-08");
  await expect(page.getByTestId("spend-total")).toHaveText(REGISTERED_SPEND);
  await expect(page.getByTestId("reserves-net")).toHaveText(RESERVES_NET);
  const reserveText = await page.getByTestId("reserve-group").allInnerTexts();
  for (const own of OWN.filter((a) => a.ring === "RESERVE")) {
    expect(reserveText.some((text) => text.includes(own.label))).toBe(true);
  }
});

// ---------------------------------------------------------------------
// CRITERION 14.12: a registration the engine cannot use is refused at the
// form, and the owner sees the message.
// ---------------------------------------------------------------------

test("a mistyped account number is refused on the accounts screen and the list is unchanged", async ({
  page,
}) => {
  await signUp(page, "ar-refuse");
  await page.goto("/accounts");
  await expect(page.getByTestId("account-row")).toHaveCount(0);

  // One transposed pair of digits in an otherwise valid invented number.
  await page.getByTestId("account-label").fill("Buffer");
  await page.getByTestId("account-bank-field").fill("Demobank");
  await page.getByTestId("account-number").fill("BE24902200001183");
  await page.getByTestId("account-ring-field").selectOption("RESERVE");
  await submit(page, page.getByTestId("register-account").click());

  await expect(page.getByTestId("accounts-status")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("accounts-status")).toContainText(
    "does not check out",
  );
  await expect(page.getByTestId("account-row")).toHaveCount(0);
});

test("the accounts screen says how a card is registered and offers no way to register one", async ({
  page,
}) => {
  await signUp(page, "ar-card");
  await page.goto("/accounts");
  await expect(page.getByTestId("accounts-card-note")).toBeVisible();
  await expect(page.getByTestId("accounts-card-note")).toContainText(
    "importing its statement",
  );
  // The number field is required, so there is no control that submits an
  // account without one.
  await expect(page.getByTestId("account-number")).toHaveAttribute(
    "required",
    "",
  );
});

// ---------------------------------------------------------------------
// CRITERION 14.11: the savings statement is ACCEPTED, in the order every
// household is actually in, and nothing is declared silently.
// ---------------------------------------------------------------------

test("uploading a savings statement first is admitted, its rows are HELD, and the screen says so", async ({
  page,
}) => {
  await signUp(page, "ar-savings-first");
  // Nothing registered. Uploading is the only way into Pulse today.
  await page.goto("/import");
  await page
    .getByLabel("Bank export file")
    .setInputFiles(join(FIXTURES, "ar-savings.csv"));
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();

  // BOTH ANSWERS ARE OFFERED, and the copy beside each states its
  // consequence.
  await expect(page.getByTestId("ring-pot-meaning")).toContainText("counted");
  await expect(page.getByTestId("ring-reserve-meaning")).toContainText("kept");
  // THE WRONG ANSWER IS RECOVERABLE AND THE SCREEN SAYS WHERE.
  await expect(page.getByTestId("ring-change-link")).toBeVisible();

  await page.getByLabel("Format name").fill("Demobank savings");
  await page.getByLabel("Label").fill("Buffer");
  await page.getByLabel("Bank").fill("Demobank");
  await page.getByTestId("account-ring").selectOption("RESERVE");
  await page.getByTestId("confirm-import").click();

  // ADMITTED, with the same row count it reports for any other file.
  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("rows-added")).toHaveText("3");

  // AND THE MONTH NAMES THEM AS HELD rather than showing nothing.
  await page.goto("/?month=2026-08");
  const entry = page
    .getByTestId("month-account")
    .filter({ hasText: "Buffer" });
  await expect(entry).toHaveCount(1);
  await expect(entry).toHaveAttribute("data-state", "held");
  // THE STATE IS WORDS THE READER SEES, not an attribute a test can read.
  await expect(entry).toContainText("kept and counted in no month");
  await expect(entry).toContainText("3 rows");

  // AND THE BOOKS STILL CLOSE: a held statement is a normal state, not a
  // cause, and it is not an uninterpreted gap.
  await expect(page.getByTestId("recon-cause-uninterpreted")).toHaveCount(0);
  await expect(page.getByTestId("recon-difference")).toHaveCount(0);
});

test("a declaration carrying no ring is refused by name, and nothing is defaulted", async ({
  page,
}) => {
  await signUp(page, "ar-no-ring");
  await page.goto("/import");
  await page
    .getByLabel("Bank export file")
    .setInputFiles(join(FIXTURES, "ar-savings.csv"));
  await page.getByRole("button", { name: "Upload" }).click();
  await page.getByLabel("Format name").fill("Demobank savings");
  await page.getByLabel("Label").fill("Buffer");
  await page.getByLabel("Bank").fill("Demobank");
  // The ring is left unanswered. The select is required, so the browser
  // itself refuses; the SERVER refusal is what this asserts, so the
  // attribute is removed first to reach it.
  await page
    .getByTestId("account-ring")
    .evaluate((element) => element.removeAttribute("required"));
  await page.getByTestId("confirm-import").click();
  await expect(page.getByTestId("import-status")).toContainText(
    "spending account or a savings account",
  );
});

// ---------------------------------------------------------------------
// CRITERION 14.15 witness SIX and CRITERION 15.9: the wrong answer, walked
// back. This is the answer no engine signal distinguishes from a correct
// one.
// ---------------------------------------------------------------------

test("THE WRONG ANSWER, WALKED BACK: a savings statement answered as a spending account is visible, and the ring can be corrected", async ({
  page,
}) => {
  await signUp(page, "ar-wrong-ring");
  await uploadFile(page, "ar-savings.csv", "Buffer", "POT", "3");

  // NOTHING ON THE MONTH VIEW'S FIGURES DIFFERS FROM A CORRECT MONTH: the
  // interest is income, the outgoing is spend, the verdict reads that the
  // books close, and the reserves card reads zero.
  await page.goto("/?month=2026-08");
  await expect(page.getByTestId("reserves-net")).toHaveText("0,00");
  await expect(page.getByTestId("recon-difference")).toHaveCount(0);

  // THE ONE THING THAT DOES DIFFER, and it is a fact the household can
  // check rather than a warning they would learn to ignore.
  const entry = page.getByTestId("month-account").filter({ hasText: "Buffer" });
  await expect(entry).toHaveCount(1);
  await expect(entry).toHaveAttribute("data-state", "counted");
  await expect(entry).toContainText("counted in this month's income and spend");
  // THE FIXTURE'S OWN ARITHMETIC, by hand. Answered as a SPENDING account,
  // the savings statement's three rows are classified like any other pot
  // account's: the +250,00 deposit is INCOME, the -55,00 transfer out is
  // SPEND, the +1,37 interest is INCOME. So spend is 55,00 and income is
  // 251,37, and nothing about either figure says a savings account produced
  // them.
  await expect(page.getByTestId("spend-total")).toHaveText("55,00");
  await expect(page.getByTestId("income-total")).toHaveText("251,37");

  // A naming made in the wrong state, which is what that state invites.
  await page.goto("/merchants");
  const group = page.getByTestId("unresolved-group").first();
  await group.locator('input[name="merchantName"]').fill("Not a merchant");
  await Promise.all([
    page.waitForURL(/\/merchants/),
    group.getByRole("button", { name: "Name" }).click(),
  ]);

  // FOLLOW THE LINK THE COPY RENDERS, and correct the ring with the control
  // that copy named.
  await page.goto("/?month=2026-08");
  await page.getByTestId("month-accounts-link").click();
  await expect(page).toHaveURL(/\/accounts/);

  // WHAT WILL MOVE IS STATED BEFORE THE CHANGE IS MADE.
  await page
    .getByTestId("account-row")
    .filter({ hasText: "Buffer" })
    .getByTestId("correct-ring")
    .click();
  const row = page.getByTestId("account-row").filter({ hasText: "Buffer" });
  await expect(row.getByTestId("ring-change-preview")).toBeVisible();
  // WHAT WILL MOVE IS STATED BEFORE THE CHANGE IS MADE, in words.
  await expect(row.getByTestId("ring-change-preview")).toContainText(
    "stop being counted",
  );
  await submit(page, row.getByTestId("confirm-ring-change").click());

  // AND THE RULE THAT STOPPED MATCHING IS REPORTED BY NAME AND COUNT.
  await expect(page.getByTestId("accounts-rules-stopped")).toBeVisible();

  // The rows are HELD and named, the spend total has fallen by exactly
  // them, and the verdict still reads as books closing.
  await page.goto("/?month=2026-08");
  // THE SPEND TOTAL HAS FALLEN BY EXACTLY THOSE ROWS, and so has income:
  // every row on the account is now held and enters nothing.
  await expect(page.getByTestId("spend-total")).toHaveText("0,00");
  await expect(page.getByTestId("income-total")).toHaveText("0,00");
  const held = page.getByTestId("month-account").filter({ hasText: "Buffer" });
  await expect(held).toHaveCount(1);
  await expect(held).toHaveAttribute("data-state", "held");
  await expect(held).toContainText("kept and counted in no month");
  await expect(page.getByTestId("recon-cause-uninterpreted")).toHaveCount(0);
  await expect(page.getByTestId("recon-difference")).toHaveCount(0);
});

// ---------------------------------------------------------------------
// CRITERION 15.2 and 15.3: a row on an account that left the pot stops
// counting, stops being offered, and the books still close.
// ---------------------------------------------------------------------

test("a row on an account that LEFT the pot stops counting and stops being offered, and the entry flips rather than vanishing", async ({
  page,
}) => {
  await signUp(page, "ar-left-pot");
  await uploadFile(page, "ar-current.csv", "Current account", "POT", "11");
  await page.goto("/?month=2026-08");
  await expect(page.getByTestId("spend-total")).toHaveText(CONTROL_SPEND);
  expect(await groupLabels(page)).toContain("BAKKERIJ OCHTEND");

  await page.goto("/accounts");
  await page
    .getByTestId("account-row")
    .filter({ hasText: "Current account" })
    .getByTestId("correct-ring")
    .click();
  await submit(
    page,
    page
      .getByTestId("account-row")
      .filter({ hasText: "Current account" })
      .getByTestId("confirm-ring-change")
      .click(),
  );

  await page.goto("/?month=2026-08");
  // NONE OF THOSE ROWS APPEARS IN ANY MONTH FIGURE.
  await expect(page.getByTestId("spend-total")).toHaveText("0,00");
  await expect(page.getByTestId("income-total")).toHaveText("0,00");
  await expect(page.getByTestId("reserves-net")).toHaveText("0,00");
  // NONE OF THEIR COUNTERPARTIES IS AN UNRESOLVED GROUP.
  expect(await groupLabels(page)).not.toContain("BAKKERIJ OCHTEND");

  // THEY ARE NAMED AS HELD rather than simply vanishing from the page: a
  // correction that makes a household's rows disappear with no statement is
  // the same surprise as the defect this round exists to remove.
  await page.goto("/?month=2026-08");
  const entry = page
    .getByTestId("month-account")
    .filter({ hasText: "Current account" });
  await expect(entry).toHaveCount(1);
  await expect(entry).toHaveAttribute("data-state", "held");
  await expect(entry).toContainText("11 rows");

  // CRITERION 15.3: AND THE BOOKS STILL CLOSE.
  await expect(page.getByTestId("recon-cause-uninterpreted")).toHaveCount(0);
  await expect(page.getByTestId("recon-difference")).toHaveCount(0);

  // A SECOND CORRECTION BACK returns them to the counted set and FLIPS the
  // entry from held to counted, the entry REMAINING on the page.
  await page.goto("/accounts");
  await page
    .getByTestId("account-row")
    .filter({ hasText: "Current account" })
    .getByTestId("correct-ring")
    .click();
  await submit(
    page,
    page
      .getByTestId("account-row")
      .filter({ hasText: "Current account" })
      .getByTestId("confirm-ring-change")
      .click(),
  );
  await page.goto("/?month=2026-08");
  const back = page
    .getByTestId("month-account")
    .filter({ hasText: "Current account" });
  await expect(back).toHaveCount(1);
  await expect(back).toHaveAttribute("data-state", "counted");
  await expect(page.getByTestId("spend-total")).toHaveText(CONTROL_SPEND);
});

// ---------------------------------------------------------------------
// CRITERION 14.15 witnesses FOUR, FIVE and SIX: the state is words the
// reader sees, IN THEIR OWN LANGUAGE, and the reserves heading is not a
// balance.
// ---------------------------------------------------------------------

test("both states are rendered as words in each of the three languages, and the reserves heading names a movement", async ({
  page,
  baseURL,
}) => {
  await signUp(page, "ar-locales");
  // One HELD account (a savings statement answered correctly) and one
  // COUNTED account (an ordinary current account), so both states are on
  // the page at once and each language is checked against both.
  await uploadFile(page, "ar-savings.csv", "Buffer", "RESERVE", "3");
  await uploadFile(page, "ar-current.csv", "Current account", "POT", "11");

  const expectations = [
    {
      locale: "en",
      counted: "counted in this month's income and spend",
      held: "kept and counted in no month",
      heading: "Moved to savings this month",
      eyebrow: "This month only",
      // Balance words in this language. The reserves card must contain
      // none of them: this block is a MOVEMENT IN THE MONTH and nothing in
      // v1 is accumulated across months, so a heading that reads as an
      // amount held would be inventing exactly the number the owner
      // decision rejected.
      //
      // THE COPY SAYS WHAT IT IS RATHER THAN WHAT IT IS NOT, and this test
      // is why. The eyebrow first read "Movement in the month, not a
      // balance", which tripped its own guard on the word inside the
      // denial. Rewording it around the word would have been a way to keep
      // defensive prose and satisfy a check; saying "This month only"
      // instead is shorter, fits a phone better, and needs no denial.
      balanceWords: ["balance", "total saved", "saved so far", "holdings"],
    },
    {
      locale: "nl",
      counted: "telt mee in de inkomsten en uitgaven van deze maand",
      held: "bewaard en telt in geen enkele maand mee",
      heading: "Deze maand opzijgezet",
      eyebrow: "Alleen deze maand",
      balanceWords: ["saldo", "tegoed", "totaal gespaard"],
    },
    {
      locale: "fr",
      counted: "compté dans les revenus et les dépenses de ce mois",
      held: "conservé et compté dans aucun mois",
      heading: "Mis de côté ce mois-ci",
      eyebrow: "Ce mois-ci uniquement",
      balanceWords: ["solde", "avoir", "total \u00e9pargn\u00e9"],
    },
  ] as const;

  for (const expectation of expectations) {
    await page.context().addCookies([
      {
        name: "locale",
        value: expectation.locale,
        url: baseURL ?? "http://127.0.0.1:3210",
      },
    ]);
    await page.goto("/?month=2026-08");

    const counted = page
      .getByTestId("month-account")
      .filter({ hasText: "Current account" });
    await expect(counted).toHaveAttribute("data-state", "counted");
    // THE VISIBLE TEXT carries the state copy. A label, a number and an
    // invisible attribute would satisfy a weaker wording while telling the
    // household nothing, so this asserts what is on the page.
    await expect(counted).toContainText(expectation.counted);

    const held = page.getByTestId("month-account").filter({ hasText: "Buffer" });
    await expect(held).toHaveAttribute("data-state", "held");
    await expect(held).toContainText(expectation.held);

    // AN ACCOUNT APPEARS IN AT MOST ONE ENTRY, by construction: the two
    // reads carry complementary ring predicates.
    await expect(page.getByTestId("month-account")).toHaveCount(2);

    // THE HEADING IS NOT A BALANCE (decision D-60).
    const reserves = page.getByTestId("reserves-card");
    await expect(reserves).toContainText(expectation.heading);
    await expect(reserves).toContainText(expectation.eyebrow);
    const reservesText = (await reserves.innerText()).toLowerCase();
    for (const word of expectation.balanceWords) {
      expect(
        reservesText.includes(word.toLowerCase()),
        `the reserves card reads as a balance in ${expectation.locale}: "${word}"`,
      ).toBe(false);
    }

    // AND IT RENDERS OUTSIDE THE RECONCILIATION PANEL, with the verdict
    // still reading as books closing: a held statement is a normal state
    // and rendering it as a cause would say the books are open when they
    // are not.
    await expect(
      page.getByTestId("recon-panel").getByTestId("month-accounts"),
    ).toHaveCount(0);
    await expect(page.getByTestId("recon-cause-uninterpreted")).toHaveCount(0);
  }
});
