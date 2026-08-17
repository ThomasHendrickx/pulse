import { expect, test } from "@playwright/test";

// Criterion 0.3: signs up with email and password, signs out, signs in
// again, and asserts an authenticated household context renders. Runs in the
// default locale (English); the copy asserted below comes from
// messages/en.json. The household name is derived from the email local
// part, which is unique per run, so the context assertion cannot pass
// against a stale session from an earlier run.

test("sign up, sign out, sign in again with a household context", async ({
  page,
}) => {
  const unique = `e2e-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `${unique}@pulse-e2e.test`;
  const password = `pw-${unique}`;

  // Sign up with email and password.
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Create household" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create household" }).click();

  // An authenticated household context renders: the shell shows the
  // household created for this user, named after the email local part.
  await expect(page.getByTestId("household-context")).toHaveText(unique);
  await expect(page.getByTestId("empty-state")).toBeVisible();

  // Sign out lands back on the sign-in screen.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  // The signed-out session cannot see the app: the month route redirects
  // back to sign-in instead of rendering a household context.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  // Sign in again with the same credentials.
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);
});
