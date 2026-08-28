import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { registerCurrentAccount } from "./setup-accounts";
import {
  ACCOUNT_NAMESPACE,
  IDENTITY_FIXTURE_ACCOUNTS,
} from "./identity-fixture-facts";

// M3-P13. THE REVIEW SCREEN SAYS WHAT IT IS GROUPING ON AND HOW FAR A NAMING
// WILL REACH. Driven end to end through the real product: sign up, register
// the account the fixture belongs to, import the committed identity fixture,
// then read the merchant review at the owner's own phone width.
//
// EVERY VALUE IN THIS FILE IS INVENTED and comes from the committed fixture
// generator by import, so no identifier shape is typed in here and none is
// quoted from a real document (criterion 13.9).

const FIXTURE = join(
  __dirname,
  "..",
  "fixtures",
  "belfius-counterparty-identity.pdf",
);

const PHONE = { width: 390, height: 844 } as const;

// The counterparty the fixture gives THREE transactions, each a different
// purpose, a different date and a different amount: DR-0027's accepted cost
// in its smallest visible form.
const THREE_ROW_KEY = `${ACCOUNT_NAMESPACE}${IDENTITY_FIXTURE_ACCOUNTS.counterparty1}`;

const centsOf = (rendered: string): number => {
  const normalised = rendered.replace(/\./g, "").replace(",", ".");
  return Math.round(Number(normalised) * 100);
};

const importFixture = async (page: import("@playwright/test").Page): Promise<void> => {
  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  await page.getByTestId("confirm-import").click();
  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("rows-added")).toHaveText("24");
};

const signUpAndImport = async (
  page: import("@playwright/test").Page,
  prefix: string,
): Promise<void> => {
  const unique = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(`${unique}@pulse-e2e.test`);
  await page.getByLabel("Password").fill(`pw-${unique}`);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);
  await registerCurrentAccount(
    page,
    IDENTITY_FIXTURE_ACCOUNTS.own,
    "Daily account",
    "Demobank",
  );
  await importFixture(page);
};

// Criteria 13.1, 13.2 and 13.3 on ONE page load, because they are three
// statements about the same group and splitting them would triple a
// thirty-second import for nothing.
test("criteria 13.1, 13.2, 13.3: the group states its basis, is labelled by its masked account, and opens onto its three transactions", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await signUpAndImport(page, "identity-review");

  await page.goto("/merchants");
  await expect(
    page.getByRole("heading", { name: "Merchant review" }),
  ).toBeVisible();

  const group = page.locator(`[data-group-key="${THREE_ROW_KEY}"]`);
  await expect(group).toHaveCount(1);

  // 13.1: the count and the basis, by testid, on the RENDERED page.
  await expect(group.getByTestId("group-count")).toHaveText("3 rows");
  await expect(group.getByTestId("group-basis")).toHaveText(
    "Grouped on a shared counterparty account.",
  );

  // 13.1, the other basis: a group the trust gate sent to the descriptor
  // branch says so, in the catalogue's own words.
  const descriptorBases = page
    .getByTestId("unresolved-group")
    .filter({ hasText: "Grouped on a shared description." });
  expect(await descriptorBases.count()).toBeGreaterThan(0);

  // 13.2: the label is the MASKED account, and the account never reaches
  // the reader unmasked.
  const account = IDENTITY_FIXTURE_ACCOUNTS.counterparty1;
  const masked = `${account.slice(0, 4)} **** ${account.slice(-4)}`;
  await expect(group.getByTestId("group-label")).toHaveText(masked);

  const visible = await page.locator("body").innerText();
  expect(visible).toContain(masked);
  expect(visible).not.toContain(account);

  // ...and the hidden field the naming form submits carries the UNMASKED
  // namespaced identity key, which is what the stored rule pattern must be
  // (hazard H13.1). Asserted on the same page, so the two halves are read
  // from one render.
  const subject = group.locator('input[name="counterpartyText"]');
  await expect(subject).toHaveValue(THREE_ROW_KEY);

  // THE STRONGEST FORM OF 13.2's PAGE-SOURCE CLAUSE THAT IS TRUE, and the
  // reason it is not the literal one is recorded in this phase's work
  // history: the criterion asks the full page source to carry no unmasked
  // account AND the hidden field to carry the unmasked identity key, and
  // the identity key of an account-basis group IS the namespace followed by
  // that account. Both cannot hold at once. What is asserted instead is
  // that EVERY occurrence of the unmasked account in the page source is
  // inside a hidden counterpartyText field: nothing the reader sees, and
  // nothing a screenshot can carry, holds it.
  const html = await page.content();
  const withoutHiddenSubjects = html.replace(
    /<input[^>]*name="counterpartyText"[^>]*>/g,
    "",
  );
  expect(withoutHiddenSubjects).not.toContain(account);
  expect(html).toContain(account);

  // 13.3: the three transactions behind the group, each with its own date,
  // its own description and its own amount, summing to the group total.
  const total = centsOf((await group.getByTestId("group-total").innerText()).trim());
  await group.getByTestId("group-rows").locator("summary").click();
  const rows = group.getByTestId("group-row");
  await expect(rows).toHaveCount(3);
  const dates = await rows.getByTestId("group-row-date").allInnerTexts();
  const descriptions = await rows
    .getByTestId("group-row-description")
    .allInnerTexts();
  const amounts = await rows.getByTestId("group-row-amount").allInnerTexts();
  expect(new Set(dates).size).toBe(3);
  expect(new Set(descriptions).size).toBe(3);
  const summed = amounts.reduce((sum, text) => sum + centsOf(text.trim()), 0);
  expect(summed).toBe(total);
  // The transaction lines are descriptor text, so they are masked too: the
  // account is not printed in full on any of them (hazard H13.2).
  for (const description of descriptions) {
    expect(description).not.toContain(account);
  }
});

// Criterion 13.4: the reach is stated BEFORE the naming, it is the group's
// own row count, and it is stated in all three languages.
test("criterion 13.4: the naming form states how far the naming reaches, in English, Dutch and French", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize(PHONE);
  await signUpAndImport(page, "identity-reach");

  await page.goto("/merchants");
  const three = page.locator(`[data-group-key="${THREE_ROW_KEY}"]`);
  await expect(three.getByTestId("group-reach")).toHaveText(
    "Naming this reaches 3 transactions of this month.",
  );

  // A group of ONE, chosen by its own rendered COUNT rather than by any
  // fixture text, so this assertion carries no descriptor and no amount.
  const single = page
    .getByTestId("unresolved-group")
    .filter({
      has: page.getByTestId("group-count").filter({ hasText: /^1 rows$/ }),
    })
    .first();
  await expect(single.getByTestId("group-reach")).toHaveText(
    "Naming this reaches 1 transaction of this month.",
  );
  // Its key, captured in English, is how the same group is found again once
  // the locale changes: the key is the household's data and never copy.
  const singleKey = (await single.getAttribute("data-group-key")) ?? "";
  expect(singleKey.length).toBeGreaterThan(0);

  // The reach sits INSIDE the form the reader is about to submit.
  await expect(
    three.locator("form.merchant-name-form").getByTestId("group-reach"),
  ).toHaveCount(1);

  const expectations = [
    {
      locale: "nl",
      three: "Deze naam geldt voor 3 transacties van deze maand.",
      one: "Deze naam geldt voor 1 transactie van deze maand.",
      basis: "Gegroepeerd op een gedeelde rekening van de tegenpartij.",
    },
    {
      locale: "fr",
      three: "Ce nom s'applique à 3 transactions de ce mois.",
      one: "Ce nom s'applique à 1 transaction de ce mois.",
      basis: "Regroupées sur un compte de contrepartie commun.",
    },
  ];
  for (const expectation of expectations) {
    await page.context().addCookies([
      {
        name: "locale",
        value: expectation.locale,
        url: baseURL ?? "http://127.0.0.1:3000",
      },
    ]);
    await page.goto("/merchants");
    const group = page.locator(`[data-group-key="${THREE_ROW_KEY}"]`);
    await expect(group.getByTestId("group-reach")).toHaveText(expectation.three);
    await expect(group.getByTestId("group-basis")).toHaveText(expectation.basis);
    await expect(
      page
        .locator(`[data-group-key="${singleKey}"]`)
        .getByTestId("group-reach"),
    ).toHaveText(expectation.one);
  }
});

// Criterion 13.5 (hazard H13.5, and H3.2 one milestone back): this screen
// change moves no money. The direction totals are read before and after a
// naming made on the account-basis group and compared byte for byte.
test("criterion 13.5: naming a group on this screen still moves no total", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await signUpAndImport(page, "identity-totals");

  await page.goto("/merchants");
  const incomeBefore = await page.getByTestId("income-total").textContent();
  const spendBefore = await page.getByTestId("spend-total").textContent();

  const group = page.locator(`[data-group-key="${THREE_ROW_KEY}"]`);
  await group.getByPlaceholder("Name this counterparty").fill("Demo Insurer");
  await group.getByRole("button", { name: "Name" }).click();

  const named = page
    .getByTestId("merchant-group")
    .filter({ hasText: "Demo Insurer" });
  await expect(named).toHaveCount(1);
  // The naming reached every row it said it would reach: three.
  await expect(named.getByTestId("group-count")).toHaveText("3 rows");
  // A resolved group carries no basis line, because it is joined by the
  // household's own naming rather than by a derivation.
  await expect(named.getByTestId("group-basis")).toHaveCount(0);

  expect(await page.getByTestId("income-total").textContent()).toBe(incomeBefore);
  expect(await page.getByTestId("spend-total").textContent()).toBe(spendBefore);
});
