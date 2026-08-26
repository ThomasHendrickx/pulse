import { expect, test } from "@playwright/test";
import { join } from "node:path";

// Criterion 3.3 (hazard H3.2): name an unresolved counterparty on the
// merchant review screen and assert the month's data REGROUPS it without a
// cent moving between the income and spend totals. Resolution renames and
// regroups; it never reclassifies flow. Fresh household per run (unique
// sign-up email), so earlier runs cannot leak into the totals.
//
// Fixture arithmetic (belfius-account-a.csv, all rows in August 2026):
//   income: +2.500,00 salary and +42.000,00 refund from the same
//           counterparty with no outgoing history, so both INCOME:
//           44.500,00 total
//   spend:  -12,50 -125,30 -86,47 -950,00 = -1.174,27 total

const FIXTURE = join(__dirname, "..", "fixtures", "belfius-account-a.csv");

test("naming an unresolved counterparty regroups it and changes no total", async ({
  page,
}) => {
  const unique = `merchants-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `${unique}@pulse-e2e.test`;
  const password = `pw-${unique}`;

  // Fresh household.
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);

  // One import: declare the account and confirm the detected format.
  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  await page.getByLabel("Format name").fill("Demobank current account");
  await page.getByLabel("Label").fill("Daily account");
  await page.getByLabel("Bank").fill("Demobank");
  await page.getByLabel("Ring").selectOption("POT");
  await page.getByTestId("confirm-import").click();
  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("rows-added")).toHaveText("6");

  // The review screen: every counted counterparty is unresolved, and the
  // totals are the fixture's known values.
  await page.goto("/merchants");
  await expect(page.getByRole("heading", { name: "Merchant review" })).toBeVisible();
  await expect(page.getByTestId("income-total")).toHaveText("44.500,00");
  await expect(page.getByTestId("spend-total")).toHaveText("-1.174,27");
  await expect(page.getByTestId("merchant-group")).toHaveCount(0);
  await expect(page.getByTestId("unresolved-group")).toHaveCount(5);
  const incomeBefore = await page.getByTestId("income-total").textContent();
  const spendBefore = await page.getByTestId("spend-total").textContent();

  // Name ONE unresolved counterparty, in one click: type the name, submit.
  const supermarkt = page
    .getByTestId("unresolved-group")
    .filter({ hasText: "SUPERMARKT NOORD" });
  await expect(supermarkt).toHaveCount(1);
  await supermarkt.getByPlaceholder("Name this counterparty").fill("Supermarkt");
  await supermarkt.getByRole("button", { name: "Name" }).click();

  // Regrouped: the row now sits under the merchant's name, resolved, and
  // the raw descriptor group is gone.
  const named = page.getByTestId("merchant-group").filter({ hasText: "Supermarkt" });
  await expect(named).toHaveCount(1);
  await expect(named.getByTestId("group-total")).toHaveText("-86,47");
  await expect(
    page.getByTestId("unresolved-group").filter({ hasText: "SUPERMARKT NOORD" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("unresolved-group")).toHaveCount(4);

  // The whole point: naming moved cents between GROUPS and none between
  // TOTALS (hazard H3.2). Same values, digit for digit.
  await expect(page.getByTestId("income-total")).toHaveText(incomeBefore ?? "");
  await expect(page.getByTestId("spend-total")).toHaveText(spendBefore ?? "");
  await expect(page.getByTestId("income-total")).toHaveText("44.500,00");
  await expect(page.getByTestId("spend-total")).toHaveText("-1.174,27");
});

// M3-P6, criteria 6.3 (the e2e half) and 6.7. The owner's real statement
// put an unmasked card number on screen: a card descriptor embeds the full
// number and the group label for an unresolved counterparty IS the
// normalised descriptor. This spec drives the SYNTHETIC card fixture
// through the real import and sweeps the rendered group labels on BOTH
// label surfaces, at the phone viewport the owner uses.
//
// The viewport is set HERE rather than in playwright.config.ts (finding
// PR3-008), the shape test/e2e/import.spec.ts and test/e2e/navigation.spec.ts
// already use, so this phase adds no config change.

const CARD_FIXTURE = join(__dirname, "..", "fixtures", "card-descriptors.csv");

// The invented card number the fixture carries, in the form a sweep can
// look for once separators are removed. Synthetic; no real card number
// exists anywhere in this repository.
const INVENTED_CARD_NUMBER = "4000123456789010";

// A card-number run is 13 to 19 digits once spaces, dots and dashes are
// removed, never a contiguous-digit test (finding PR3-001).
const cardNumberRuns = (text: string): readonly string[] =>
  text.replace(/[ .\-]/g, "").match(/(?<!\d)\d{13,19}(?!\d)/g) ?? [];

// The fixture's ONE legitimate structured reference, which criterion 6.3(b)
// names as its single permitted exception. Since fix round 1 narrowed the
// display helper to the card-tail grammar (finding HZ-M3P6-01), the
// exception is REAL on the label side too: a payment reference is not a
// card number, so nothing masks it and the owner can still read it.
const PERMITTED_EXCEPTION = "415123456789012";

const sweepRenderedTexts = async (
  texts: readonly string[],
): Promise<void> => {
  expect(texts.length).toBeGreaterThan(0);
  for (const text of texts) {
    expect(text.replace(/[ .\-]/g, "")).not.toContain(INVENTED_CARD_NUMBER);
    for (const run of cardNumberRuns(text)) {
      expect(run, text).toBe(PERMITTED_EXCEPTION);
    }
  }
};

test.describe("card group labels on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("card rows group under one merchant and no rendered label carries a card number, on either screen", async ({
    page,
  }) => {
    const unique = `card-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const email = `${unique}@pulse-e2e.test`;
    const password = `pw-${unique}`;

    await page.goto("/sign-up");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create household" }).click();
    await expect(page.getByTestId("household-context")).toHaveText(unique);

    await page.goto("/import");
    await page.getByLabel("Bank export file").setInputFiles(CARD_FIXTURE);
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(
      page.getByRole("heading", { name: "Confirm the detected format" }),
    ).toBeVisible();
    await page.getByLabel("Format name").fill("Demobank current account");
    await page.getByLabel("Label").fill("Daily account");
    await page.getByLabel("Bank").fill("Demobank");
    await page.getByLabel("Ring").selectOption("POT");
    // THE CONFIRM-FORMAT PREVIEW, the screen the owner photographed
    // (finding CR-M3P6-01). It renders the RAW parsed descriptor, which is
    // where a card number sits whole, and no criterion named it before this
    // fix round. The sweep runs on the same separator-insensitive test the
    // group labels use.
    const previewTexts = await page.getByTestId("preview-row").allInnerTexts();
    expect(previewTexts).toHaveLength(5);
    await sweepRenderedTexts(previewTexts);
    // NOT VACUOUS: the preview's card rows really do render a masked tail,
    // so the sweep is passing because of the mask rather than because the
    // rows carry no card number.
    expect(previewTexts.filter((text) => text.includes("**** 9010")).length)
      .toBeGreaterThanOrEqual(4);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);

    await page.getByTestId("confirm-import").click();
    await expect(page.getByTestId("import-result")).toBeVisible();
    await expect(page.getByTestId("rows-added")).toHaveText("21");

    // THE MERCHANT REVIEW SCREEN.
    await page.goto("/merchants");
    await expect(
      page.getByRole("heading", { name: "Merchant review" }),
    ).toBeVisible();

    // The grouping defect, gone: five card rows of one merchant, spread
    // across two months and carrying the card tail in both printed shapes,
    // are ONE group.
    const oneMerchant = page
      .getByTestId("unresolved-group")
      .filter({ hasText: "KOFFIEHUIS DE MOLEN" });
    await expect(oneMerchant).toHaveCount(1);
    await expect(oneMerchant).toContainText("5 rows");

    // Two merchants sharing a chain prefix and a city stay two groups.
    await expect(
      page.getByTestId("unresolved-group").filter({ hasText: "SUPERMARKT DE LINDE" }),
    ).toHaveCount(2);

    await sweepRenderedTexts(
      await page.getByTestId("group-label").allInnerTexts(),
    );

    // The one permitted exception, exercised rather than vacuous: the row
    // carrying a legitimate structured reference still shows it, because it
    // is not a card number and the narrowed helper leaves it alone.
    await expect(
      page
        .getByTestId("unresolved-group")
        .filter({ hasText: PERMITTED_EXCEPTION }),
    ).toHaveCount(1);

    // The same merchant paid on BOTH payment rails is ONE group
    // (finding HZ-M3P6-06).
    const bothRails = page
      .getByTestId("unresolved-group")
      .filter({ hasText: "BAKKERIJ ZONNEBLOEM" });
    await expect(bothRails).toHaveCount(1);
    await expect(bothRails).toContainText("3 rows");

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);

    // THE MONTH VIEW, over the closed month that holds the reference row.
    await page.goto("/?month=2026-08");
    await sweepRenderedTexts(
      await page.getByTestId("group-label").allInnerTexts(),
    );
    // THE RECONCILIATION GAP ROWS. STATED HONESTLY RATHER THAN CLAIMED
    // (finding CR-M3P6-11): this fixture produces NO gap rows, measured
    // across all four gap-row test ids in both months, so the sweep below
    // DOES NOT EXECUTE and this spec is not what guards that surface. The
    // zero is asserted rather than described, so the sentence cannot go
    // stale: a fixture that starts producing gap rows reddens here and the
    // next author decides what to sweep.
    //
    // WHAT DOES COVER THE SITE: the derivation test in the fast gate, "every
    // rendering surface that shows descriptor text is derived, not
    // remembered", which reddens when the masking call is removed from the
    // gap row because it becomes an undeclared unmasked descriptor surface.
    // WHAT NEITHER COVERS: the rendered STRING of a gap row. A masker that
    // is applied and returns the wrong text would pass the derivation and
    // has no rendered-output witness on this surface, unlike the three
    // surfaces swept above.
    const gapTexts = (
      await Promise.all(
        [
          "uninterpreted-row",
          "unmatched-leg",
          "in-transit-leg",
          "unresolved-gap",
        ].map((testId) => page.getByTestId(testId).allInnerTexts()),
      )
    ).flat();
    expect(gapTexts).toHaveLength(0);
    if (gapTexts.length > 0) {
      await sweepRenderedTexts(gapTexts);
    }
    await expect(
      page.getByTestId("group-label").filter({ hasText: PERMITTED_EXCEPTION }),
    ).toHaveCount(1);
    await expect(
      page.getByTestId("group-label").filter({ hasText: "KOFFIEHUIS DE MOLEN" }),
    ).toHaveCount(1);

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
  });
});

// M3-P12, criterion 12.18: THE STALE PAGE. Decision D-46 deploys the code
// before the re-derivation runs, so for the length of that window a page
// rendered earlier holds the OLD subject: a normalised counterparty text
// with no namespace. Submitting it must reach the reader as a refusal, not
// be written as a rule that can never match anything (hazard H12.21).
//
// The stale submission is produced by editing the hidden field's value in
// the DOM, which is exactly what an old page's HTML carries. Nothing else in
// the flow is faked: the real form, the real server action and the real use
// case run.
test("submitting a PRE-MIGRATION un-namespaced subject surfaces the refusal to the reader", async ({
  page,
}) => {
  const unique = `stale-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `${unique}@pulse-e2e.test`;
  const password = `pw-${unique}`;

  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);

  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  await page.getByLabel("Format name").fill("Demobank current account");
  await page.getByLabel("Label").fill("Daily account");
  await page.getByLabel("Bank").fill("Demobank");
  await page.getByLabel("Ring").selectOption("POT");
  await page.getByTestId("confirm-import").click();
  await expect(page.getByTestId("import-result")).toBeVisible();

  await page.goto("/merchants");
  const group = page.getByTestId("unresolved-group").first();
  await expect(group).toBeVisible();
  const unresolvedBefore = await page.getByTestId("unresolved-group").count();

  // Roll the hidden subject back to what a pre-migration page carried: the
  // namespace stripped off.
  await group.evaluate((element) => {
    const hidden = element.querySelector<HTMLInputElement>(
      'input[name="counterpartyText"]',
    );
    if (hidden === null) {
      throw new Error("no counterpartyText field on the unresolved group");
    }
    hidden.value = hidden.value.replace(/^(account|descriptor):/, "");
  });
  await group.getByPlaceholder("Name this counterparty").fill("Stale Naming");
  await group.getByRole("button", { name: "Name" }).click();

  // THE REFUSAL REACHES THE READER. This is the half this spec carries, and
  // it is the half that needs a browser: the banner is rendered from a
  // redirect status the screen reads, in the reader's own language.
  await expect(page.getByTestId("naming-refused")).toBeVisible();

  // NOTHING WAS WRITTEN. Corrected in the fix round, finding HZ-M3P12-08:
  // the two assertions below used to be described as showing this, and they
  // cannot, because an un-namespaced pattern matches no identity key, so a
  // rule that WAS written would also produce zero merchant groups and an
  // unchanged unresolved count. They are kept because they DO show that the
  // screen did not regroup, and the observation that distinguishes a refusal
  // from a dead rule is added after them: a reload re-renders the group from
  // the database, so an unchanged hidden subject and an unchanged group set
  // is the page state a refusal leaves and a written rule does not.
  //
  // The stronger form of "writes NOTHING", counting the repository calls, is
  // carried by test/application/counterparty-identity-surfaces.test.ts,
  // which can see the port. Neither test claims the other's half.
  await expect(page.getByTestId("merchant-group")).toHaveCount(0);
  await expect(page.getByTestId("unresolved-group")).toHaveCount(
    unresolvedBefore,
  );

  await page.reload();
  await expect(page.getByTestId("unresolved-group")).toHaveCount(
    unresolvedBefore,
  );
  await expect(page.getByTestId("merchant-group")).toHaveCount(0);
  const subjectAfterReload = await page
    .getByTestId("unresolved-group")
    .first()
    .evaluate((element) => {
      const hidden = element.querySelector<HTMLInputElement>(
        'input[name="counterpartyText"]',
      );
      return hidden === null ? null : hidden.value;
    });
  // Still a namespaced identity key, which is what the derivation produces
  // and what the stale page had rolled back.
  expect(subjectAfterReload).not.toBeNull();
  expect(subjectAfterReload).toMatch(/^(account|descriptor):.+/);
});
