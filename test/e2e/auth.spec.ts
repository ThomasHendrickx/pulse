import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { assertGateApiTargetIsLocal } from "@/platform/db/gate-target";

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

// Fix round 1, finding 4 (hazard CR-004): a failed sign-in surfaces a
// distinct localized status line instead of silently re-rendering the form.
test("a wrong password surfaces the localized sign-in failure line", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("nobody@pulse-e2e.test");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("auth-status")).toHaveText(
    "Sign in failed. Check your email and password.",
  );
  // Still on a rendered sign-in screen, not a loop and not a blank bounce.
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

// Fix round 1, finding 1 (hazard CR-001 = criteria CR-001): an authenticated
// Supabase user with no users row must RECOVER to a rendered sign-in screen,
// not live-lock between the middleware and the household-context guard. The
// orphan state is constructed through the admin API exactly as the criteria
// reviewer constructed it. Skipped when no service role key is in the
// environment (deployed runs); the skip is visible in the report.
test("an auth user without a household link recovers to sign-in instead of looping", async ({
  page,
}) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  test.skip(
    !supabaseUrl || !serviceRoleKey,
    "needs the local service role key to construct the orphan auth user",
  );

  // THIS SPEC OPENS A PROJECT WITH A SERVICE ROLE KEY, SO IT SAYS WHICH ONE
  // (M3-P12 fix round five, CRITERIA finding CR5-M3P12-08). A service-role
  // key against a project API creates users and writes rows exactly as a
  // connection string does, and this was the one such construction in the
  // tree with nothing in front of it. The gate's config already pins the
  // target; this refuses for itself, which is what covers the spec being run
  // by something other than `playwright test`.
  assertGateApiTargetIsLocal();

  const admin = createClient(supabaseUrl ?? "", serviceRoleKey ?? "", {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const unique = `orphan-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `${unique}@pulse-e2e.test`;
  const password = `pw-${unique}`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(created.error).toBeNull();

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Recovery: the broken half-session is destroyed at the boundary and the
  // sign-in screen actually renders, carrying the incomplete-sign-up line.
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByTestId("auth-status")).toHaveText(
    "Sign-up did not complete. Try again.",
  );

  // The recovery destroyed the session: a plain navigation to the app lands
  // on sign-in again, rendered, not spinning.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
