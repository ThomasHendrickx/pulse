import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { FIXTURE_ACCOUNT_A, registerCurrentAccount } from "./setup-accounts";
import {
  ACCOUNT_NAMESPACE,
  IDENTITY_FIXTURE_ACCOUNTS,
} from "./identity-fixture-facts";

// M3-P13. THE REVIEW SCREEN SAYS WHAT IT IS GROUPING ON AND HOW FAR A NAMING
// WILL REACH. Driven end to end through the real product: sign up, register
// the account the fixture belongs to, import the committed identity fixture,
// then read the merchant review at the owner's own phone width.
//
// EVERY VALUE IN THIS FILE IS INVENTED. The account numbers come from
// ./identity-fixture-facts, which restates two values of the committed
// fixture generator because the Playwright project compiles test/e2e/ alone;
// a fast-gate test derives the comparison between the two, so a fixture
// change reddens rather than diverging silently. Nothing here is quoted from
// a real document (criterion 13.9).

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

// ADDRESSED BY THE SUBJECT THE FORM SUBMITS, NOT BY THE ROW IDENTITY (fix
// round, findings CR-M3P13-01 and HZ-M3P13-05). data-group-key is now an
// opaque digest of the key, which is the point: the account is gone from the
// markup of every row. The hidden field still carries the key, because the
// criterion requires it to, so it is what a spec can address a group by
// without knowing the digest.
// EVERY RENDERING OF ONE ACCOUNT THAT A SWEEP MUST LOOK FOR, IN ONE PLACE
// (round two, finding CR2-M3P13-04). The primary sweep tested five shapes and
// the second-token sweep tested three, dropping the narrow no-break space and
// the hyphen; the second is the one carrying criterion 13.2's literal
// page-source clause, so the phase's strongest assertion was the weaker of
// the two. Both now build from here, so they cannot drift apart again.
//
// The two visually identical lines are U+00A0 and U+202F. They are written as
// escapes rather than as the characters themselves precisely because they are
// indistinguishable on screen, which is what let the gap survive review.
const renderingsOf = (account: string): readonly string[] => [
  account,
  account.replace(/(.{4})(?=.)/g, "$1 "),
  account.replace(/(.{4})(?=.)/g, "$1\u00a0"),
  account.replace(/(.{4})(?=.)/g, "$1\u202f"),
  account.replace(/(.{4})(?=.)/g, "$1-"),
];

const groupOf = (page: import("@playwright/test").Page, key: string) =>
  page
    .getByTestId("unresolved-group")
    .filter({ has: page.locator(`input[name="counterpartyText"][value="${key}"]`) });

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

  const group = groupOf(page, THREE_ROW_KEY);
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

  // 13.2: the label is the MASKED account, and the account never reaches the
  // reader unmasked in EITHER of the two shapes it exists in: the COMPACT
  // form the importer stores, and the SPACED form the statement prints and
  // the descriptor therefore carries. The spaced form is the one that leaked
  // before this phase, because an account-basis group was labelled by the
  // smallest normalised descriptor and that descriptor carries the account
  // exactly as printed.
  const account = IDENTITY_FIXTURE_ACCOUNTS.counterparty1;
  const shapes = renderingsOf(account);
  const masked = `${account.slice(0, 4)} **** ${account.slice(-4)}`;
  await expect(group.getByTestId("group-label")).toHaveText(masked);

  const visible = await page.locator("body").innerText();
  expect(visible).toContain(masked);
  for (const shape of shapes) {
    expect(
      visible.includes(shape),
      `the rendered text carries the account in the shape ${JSON.stringify(shape)}`,
    ).toBe(false);
  }

  // ...and the hidden field the naming form submits carries the UNMASKED
  // namespaced identity key, which is what the stored rule pattern must be
  // (hazard H13.1). Asserted on the same page, so the two halves are read
  // from one render.
  const subject = group.locator('input[name="counterpartyText"]');
  await expect(subject).toHaveValue(THREE_ROW_KEY);

  // THE STRONGEST FORM OF 13.2's PAGE-SOURCE CLAUSE THAT IS TRUE FOR AN
  // ACCOUNT THAT IS AN IDENTITY KEY, and the reason it is not the literal one
  // is recorded in this phase's work history. The criterion asks the full page
  // source to carry no unmasked account AND the hidden field to carry the
  // unmasked identity key, and the identity key of an account-basis group IS
  // the namespace followed by that account, so the two halves cannot both
  // hold. TWO channels in the source must hold it, measured rather than
  // assumed, and the count came DOWN from three in this fix round:
  //
  //   the hidden counterpartyText input, which the criterion itself requires;
  //   the framework's own serialised payload, because the naming row is a
  //     client component and the identity key reaches it as a prop, so it is
  //     serialised into a script element on the way.
  //
  //   NO LONGER A CHANNEL: the row's data-group-key. It used to carry the key
  //     through the card mask, which does not touch an account. It is now an
  //     opaque digest, so the account is gone from the markup of every row
  //     (findings CR-M3P13-01 and HZ-M3P13-05). The assertion below removes
  //     only scripts and the hidden subject, and the attribute is asserted
  //     clean on its own.
  //
  // Neither remaining channel is RENDERED, which is what hazard H13.2 is
  // about. So the assertion is made over the rendered markup with those two
  // removed.
  //
  // THE SEPARATOR SHAPES ARE PART OF THE SWEEP NOW (fix round, finding
  // HZ-M3P13-01). The first version compared against a form built with ASCII
  // spaces only, so an account rendered with a no-break space satisfied every
  // not-toContain assertion while being fully legible on the screen. U+00A0 is
  // byte 0xA0 in Windows-1252, one of exactly two encodings the importer
  // accepts, and this repository has witnessed it inside stored account
  // renderings.
  const leak = await page.evaluate(
    ({ shapesIn, maskedForm }) => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      for (const script of clone.querySelectorAll("script")) {
        script.remove();
      }
      for (const hidden of clone.querySelectorAll(
        'input[name="counterpartyText"]',
      )) {
        hidden.remove();
      }
      const markup = clone.innerHTML;
      return {
        leaked: shapesIn.filter((shape) => markup.includes(shape)),
        // NOT VACUOUS: the masked form is still there, so the sweep is
        // passing because the account was masked and not because the clone
        // came back empty.
        masked: markup.includes(maskedForm),
        // The row identity carries no shape of the account at all.
        identities: [...clone.querySelectorAll("[data-group-key]")].map(
          (row) => row.getAttribute("data-group-key") ?? "",
        ),
      };
    },
    { shapesIn: shapes, maskedForm: masked },
  );
  expect(leak.leaked).toEqual([]);
  expect(leak.masked).toBe(true);
  expect(leak.identities.length).toBeGreaterThan(0);
  for (const identity of leak.identities) {
    for (const shape of shapes) {
      expect(identity).not.toContain(shape);
    }
  }
  // ...and the account IS in the untouched source, through the two channels
  // above, so the removal is doing work.
  expect(await page.content()).toContain(account);

  // ROW 20'S SECOND ACCOUNT, ON THE DEVELOPMENT SERVER (fix round, finding
  // CR-M3P13-02, and a channel neither review lane named). The contradiction
  // in 13.2 bites only on an account that IS an identity key. Row 20 carries
  // two account-shaped tokens and the importer's first-wins rule stores the
  // first, so the SECOND is never a subject, never a row identity and never a
  // client prop: it reaches the screen only through row 20's description,
  // which the transaction lines render and mask.
  //
  // On the DEVELOPMENT server it is nevertheless in the page source, and
  // finding out why was worth the round: `next dev` emits a
  // server-component DEBUG payload into script elements, carrying every
  // server component's name, source location, stack AND ITS PROPS. Measured
  // directly, the chunk reads {"name":"GroupRow","env":"Server","stack":
  // [...],"props":{"group":{...,"rows":[...raw descriptions...]}}}. So on the
  // dev server every ReviewGroup crosses whole, raw descriptions included.
  // That is a property of the development server and not of the page, and
  // the assertion below says exactly that and no more: on the dev server the
  // account appears ONLY inside script elements, never in rendered markup.
  const second = IDENTITY_FIXTURE_ACCOUNTS.secondToken;
  const secondShapes = renderingsOf(second);
  const maskedSecond = `${second.slice(0, 4)} **** ${second.slice(-4)}`;
  const devLeak = await page.evaluate(
    ({ shapesIn }) => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      for (const script of clone.querySelectorAll("script")) {
        script.remove();
      }
      const markup = clone.innerHTML;
      return shapesIn.filter((shape) => markup.includes(shape));
    },
    { shapesIn: secondShapes },
  );
  expect(devLeak).toEqual([]);
  // NOT VACUOUS: that account does reach this page, masked, on the
  // transaction line of the row that carries it.
  expect(await page.content()).toContain(maskedSecond);

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

  // CRITERION 13.2's LITERAL PAGE-SOURCE CLAUSE, MET WITH NOTHING EXCLUDED,
  // ON THE BUILD THE OWNER ACTUALLY RUNS (fix round, finding CR-M3P13-02).
  // The clause is unachievable for an account that is an identity key,
  // because the criterion itself requires that key in a hidden field on the
  // same page; it IS achievable for row 20's second token, which is never a
  // key. Asserted here against the PRODUCTION server this config already
  // starts and builds, because the development server's server-component
  // debug payload carries every component's props and is not what ships.
  // Same host, so the session cookie is sent: cookies ignore the port.
  //
  // This is the only assertion on this screen that can show the exclusion set
  // used above is forced by the contradiction rather than chosen for
  // convenience, and it is made with NOTHING removed from the source.
  await page.goto("http://127.0.0.1:3100/merchants");
  await expect(
    page.getByRole("heading", { name: "Merchant review" }),
  ).toBeVisible();
  const prodSource = await page.content();
  for (const shape of secondShapes) {
    expect(
      prodSource.includes(shape),
      `the production page source carries row 20's second account in the shape ${JSON.stringify(shape)}`,
    ).toBe(false);
  }
  // NOT VACUOUS on this server either.
  expect(prodSource).toContain(maskedSecond);
  // AND THE DEBUG PAYLOAD IS A DEVELOPMENT-ONLY CHANNEL, asserted rather than
  // assumed: the production source carries no server-component debug chunk.
  expect(prodSource).not.toContain('\\"env\\":\\"Server\\"');
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
  const three = groupOf(page, THREE_ROW_KEY);
  await expect(three.getByTestId("group-reach")).toHaveText(
    "Naming this applies to 3 transactions already imported.",
  );

  // A group of ONE, chosen by its own rendered COUNT rather than by any
  // fixture text, so this assertion carries no descriptor and no amount.
  const single = page
    .getByTestId("unresolved-group")
    .filter({
      has: page.getByTestId("group-count").filter({ hasText: /^\s*1 rows\s*$/ }),
    })
    .first();
  await expect(single.getByTestId("group-reach")).toHaveText(
    "Naming this applies to 1 transaction already imported.",
  );
  // Its key, captured in English, is how the same group is found again once
  // the locale changes: the key is the household's data and never copy.
  const singleKey =
    (await single.locator('input[name="counterpartyText"]').getAttribute("value")) ??
    "";
  expect(singleKey.length).toBeGreaterThan(0);

  // The reach sits INSIDE the form the reader is about to submit.
  await expect(
    three.locator("form.merchant-name-form").getByTestId("group-reach"),
  ).toHaveCount(1);

  const expectations = [
    {
      locale: "nl",
      three: "Deze naam geldt voor 3 al geïmporteerde transacties.",
      one: "Deze naam geldt voor 1 al geïmporteerde transactie.",
      basis: "Gegroepeerd op een gedeelde rekening van de tegenpartij.",
    },
    {
      locale: "fr",
      three: "Ce nom s'applique à 3 transactions déjà importées.",
      one: "Ce nom s'applique à 1 transaction déjà importée.",
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
    const group = groupOf(page, THREE_ROW_KEY);
    await expect(group.getByTestId("group-reach")).toHaveText(expectation.three);
    await expect(group.getByTestId("group-basis")).toHaveText(expectation.basis);
    await expect(
      groupOf(page, singleKey).getByTestId("group-reach"),
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

  const group = groupOf(page, THREE_ROW_KEY);
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

// FINDING HZ-M3P13-03, PINNED SO THE REACH SENTENCE CANNOT GO VACUOUS AGAIN.
//
// The first version of this copy said "of this month" in all three languages,
// and the read behind it carries no month at all: listCountedTransactions
// filters on householdId and flow with no date bound, listMerchantReview
// takes no period and the route passes none. With ONE statement imported the
// two readings coincide, which is exactly why the fixture-driven assertions
// above could not tell them apart.
//
// This case makes them disagree. TWO statements are imported into one
// household, and the group under test holds five transactions spread across
// TWO calendar months. A month-scoped sentence would be false of it in either
// month, so the assertion below is impossible to satisfy with the old copy
// and is what stops it coming back.
const CSV_FIXTURE = join(__dirname, "..", "fixtures", "belfius-account-a.csv");
const CARD_FIXTURE = join(__dirname, "..", "fixtures", "card-descriptors.csv");

// EACH UPLOAD DECLARES ITS OWN FORMAT NAME. A source profile's name is
// unique per household (prisma/schema/import.prisma), so answering the format
// question twice with one name fails the insert. Measured here as an
// unhandled server exception on the second upload rather than as a refusal
// the screen states, which is recorded as an open question in
// delivery/work-history/m3-p13.yaml: it is a pre-existing defect in the
// import path and not this phase's to fix.
const uploadCsv = async (
  page: import("@playwright/test").Page,
  fixture: string,
  expectedAdded: string,
  formatLabel: string,
): Promise<void> => {
  await page.goto("/import");
  await page.getByLabel("Bank export file").setInputFiles(fixture);
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  // The format question disappears once Pulse has learned the layout, so the
  // second upload does not answer it.
  const formatName = page.getByLabel("Format name");
  if ((await formatName.count()) > 0) {
    await formatName.fill(formatLabel);
  }
  await page.getByTestId("confirm-import").click();
  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("rows-added")).toHaveText(expectedAdded);
};

test("criterion 13.4 and finding HZ-M3P13-03: the reach counts every imported transaction, across two statements and two months", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  const unique = `identity-reach-two-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(`${unique}@pulse-e2e.test`);
  await page.getByLabel("Password").fill(`pw-${unique}`);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);
  await registerCurrentAccount(page, FIXTURE_ACCOUNT_A);

  await uploadCsv(page, CSV_FIXTURE, "6", "Demobank current account");
  await uploadCsv(page, CARD_FIXTURE, "21", "Demobank card lines");

  await page.goto("/merchants");
  await expect(
    page.getByRole("heading", { name: "Merchant review" }),
  ).toBeVisible();

  // EVERY GROUP IS WALKED, and the assertion is made on whichever ones
  // actually span two months, so it depends on no descriptor, no amount and
  // no fixture ordering. A group whose rows fall in two calendar months
  // cannot have a true month-scoped reach in either of them, so asserting
  // that its reach equals its FULL row count is what refutes the old copy.
  const groups = page.getByTestId("unresolved-group");
  const total = await groups.count();
  expect(total).toBeGreaterThan(0);
  let spanning = 0;
  for (let index = 0; index < total; index += 1) {
    const group = groups.nth(index);
    const countText = (
      await group.getByTestId("group-count").innerText()
    ).trim();
    const rowCount = Number(countText.split(" ")[0]);
    if (!Number.isFinite(rowCount) || rowCount < 2) {
      continue;
    }
    await group.getByTestId("group-rows").locator("summary").click();
    const dates = await group
      .getByTestId("group-row")
      .getByTestId("group-row-date")
      .allInnerTexts();
    expect(dates).toHaveLength(rowCount);
    const months = new Set(dates.map((date) => date.trim().slice(0, 7)));
    if (months.size < 2) {
      continue;
    }
    spanning += 1;
    await expect(group.getByTestId("group-reach")).toHaveText(
      `Naming this applies to ${rowCount} transactions already imported.`,
    );
  }
  expect(
    spanning,
    "no group in this household spans two months, so this case cannot tell a month-scoped reach from a household-wide one",
  ).toBeGreaterThan(0);
});
