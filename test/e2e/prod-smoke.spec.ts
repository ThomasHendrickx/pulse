import { expect, test } from "@playwright/test";
import { join } from "node:path";

// PRODUCTION-MODE smoke (deploy-verify defect round). The owner's
// production 500 (a server-action throw when the deployed runtime could
// not load the extraction module) escaped because the e2e gate only ever
// exercised `next dev`: dev and the built server resolve and load
// modules differently, so a prod-only failure had no witness. This spec
// runs against `next start` over a real production build (the
// chromium-prod project; against the deployed URL in deploy-verify) and
// asserts the exact journey that broke, plus the health probe that makes
// the deployed runtime's module state observable without log access.
//
// The prod server runs WITHOUT the frozen e2e clock (the app refuses
// PULSE_FIXED_NOW in production by design), so every assertion here is
// clock-independent: the fixture's month (May 2026) is fully in the past
// for any run date after it, and the reconciliation verdict of a closed
// month does not depend on "now".

const PDF_FIXTURE = join(
  __dirname,
  "..",
  "fixtures",
  "belfius-statement-a.pdf",
);

test("production build: health probe ok, PDF upload lands, month reconciles", async ({
  page,
  request,
}) => {
  // The deploy-verify self-check first: the runtime can load pdfjs and
  // run a real extraction over the embedded probe document.
  const health = await request.get("/api/health/pdf");
  expect(health.status(), "GET /api/health/pdf").toBe(200);
  const body = (await health.json()) as {
    pdfExtraction: string;
    moduleLoad: string;
    extraction: string;
  };
  expect(body.pdfExtraction).toBe("ok");
  expect(body.moduleLoad).toBe("ok");
  expect(body.extraction).toBe("ok");

  const unique = `prod-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(`${unique}@pulse-e2e.test`);
  await page.getByLabel("Password").fill(`pw-${unique}`);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);

  // The exact journey that 500ed in production: /import renders, the
  // upload posts, and the outcome is a real import state, never an
  // application-error page.
  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "Import" })).toBeVisible();
  await page.getByLabel("Bank export file").setInputFiles(PDF_FIXTURE);
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(
    page.getByRole("heading", { name: "Confirm the detected format" }),
  ).toBeVisible();
  await expect(page.getByTestId("account-declaration")).toBeVisible();
  await page.getByLabel("Label").fill("Daily account");
  await page.getByLabel("Bank").fill("Belfius");
  await page.getByLabel("Ring").selectOption("POT");
  await page.getByTestId("confirm-import").click();

  await expect(page.getByTestId("import-result")).toBeVisible();
  await expect(page.getByTestId("rows-added")).toHaveText("9");

  await page.goto("/?month=2026-05");
  await expect(page.getByTestId("recon-panel")).toBeVisible();
  await expect(page.getByTestId("recon-panel")).toHaveAttribute(
    "data-state",
    "ok",
  );
});
