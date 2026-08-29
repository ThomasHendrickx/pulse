import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { registerCurrentAccount } from "./setup-accounts";
import { UNSTAMPED } from "@/app/api/health/version/build-stamp";

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

  // M3-P17: the build stamp. This spec builds and serves the application
  // itself (next start over a local production bundle), so no Vercel
  // platform variable exists in this process and the unstamped branch is
  // the one this run can ever take; the accepted values below carry both
  // branches for that reason, and the deployed shape (a real sha and
  // deploymentEnvironment "production") is witnessed by M3-P16's own fetch
  // against the production origin, not by this local run.
  const version = await request.get("/api/health/version");
  expect(version.status(), "GET /api/health/version").toBe(200);
  const versionBody = (await version.json()) as {
    sha: string;
    deploymentEnvironment: string;
  };
  expect(Object.keys(versionBody).sort()).toEqual([
    "deploymentEnvironment",
    "sha",
  ]);
  expect(
    versionBody.sha === UNSTAMPED || /^[0-9a-f]{7,40}$/i.test(versionBody.sha),
  ).toBe(true);
  expect(
    versionBody.deploymentEnvironment === UNSTAMPED ||
      ["production", "preview", "development"].includes(
        versionBody.deploymentEnvironment,
      ),
  ).toBe(true);

  const unique = `prod-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(`${unique}@pulse-e2e.test`);
  await page.getByLabel("Password").fill(`pw-${unique}`);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByTestId("household-context")).toHaveText(unique);

  // M3-P14: the account the statement belongs to is registered at setup
  // before it is imported. Its number is invented and listed with its
  // provenance in test/fixtures/allowed-identifiers.txt.
  await registerCurrentAccount(page, "BE72012345678944", "Daily account", "Belfius");

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
  await expect(page.getByTestId("account-declaration")).toHaveCount(0);
  await expect(page.getByTestId("landing-account")).toContainText("Daily account");
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
