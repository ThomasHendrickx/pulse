import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { householdId, userId, type HouseholdContext } from "../../src/platform/tenancy";
import { uploadStatement } from "../../src/modules/import/application/upload-statement";
import { makeFakeImportWorld } from "./fake-import-world";

// Deploy-verify defect round (owner-reported production 500): when the
// extraction module cannot LOAD in the deployed runtime, the upload used
// to THROW out of the server action (HZ-003's rethrow design), rendering
// "Application error: a server-side exception" with ZERO import rows.
// Reproduced in production mode with the package absent: the server log
// showed ERR_MODULE_NOT_FOUND ("Cannot find package 'pdfjs-dist'
// imported from .next/server/app/(app)/import/page.js") and the page
// showed the digest error. THE CONTRACT NOW: a missing module is a
// Result, the upload lands a loud FAILED import (extraction-failed) with
// zero transaction rows, every page keeps rendering, and the
// infrastructure signal lives in the /api/health/pdf probe plus one
// logged server-side stack.
//
// This mock simulates the deployed condition: the module exists in no
// resolvable location. It is a third-party package, not code we own.
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => {
  throw new Error("Cannot find package 'pdfjs-dist' (simulated deployed bundle)");
});
vi.mock("pdfjs-dist/legacy/build/pdf.worker.mjs", () => {
  throw new Error("Cannot find package 'pdfjs-dist' (simulated deployed bundle)");
});

const context: HouseholdContext = {
  householdId: householdId("household-1"),
  userId: userId("user-1"),
};

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, "..", "fixtures", name)));

describe("PDF module unavailable in the runtime (deploy-verify defect round)", () => {
  test("the upload fails LOUDLY as a FAILED import with extraction-failed, never a thrown server error, zero rows", async () => {
    const world = makeFakeImportWorld();
    const outcome = await uploadStatement(context, world.deps, {
      fileName: "statement-a.pdf",
      bytes: fixture("belfius-statement-a.pdf"),
    });
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.reason).toBe("extraction-failed");
    }
    const imports = [...world.imports.values()];
    expect(imports).toHaveLength(1);
    expect(imports[0]?.status).toBe("FAILED");
    expect(imports[0]?.failureReason).toBe("extraction-failed");
    expect(world.transactions).toHaveLength(0);
  });

  test("non-PDF bytes flow down the delimited path untouched by the broken module", async () => {
    const world = makeFakeImportWorld();
    const outcome = await uploadStatement(context, world.deps, {
      fileName: "belfius-account-a.csv",
      bytes: fixture("belfius-account-a.csv"),
    });
    // The delimited path never loads the module: the CSV parses and the
    // unknown account parks the import for declaration exactly as with
    // a healthy module.
    expect(outcome.kind).toBe("awaiting-declaration");
  });

  test("the health probe reports the module load failed AND names the error (micro round 2)", async () => {
    const { probePdfExtraction } = await import(
      "../../src/modules/import/adapters/pdf-text-extractor"
    );
    const report = await probePdfExtraction();
    expect(report.moduleLoad).toBe("failed");
    expect(report.extraction).toBe("failed");
    // The deployed failure must name itself at the module-load stage:
    // the probe was blind exactly here in the first deployed round.
    expect(report.errorName).toBeDefined();
  });
});
