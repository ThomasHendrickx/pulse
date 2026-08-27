import { describe, expect, test } from "vitest";
import {
  approvalSource,
  approvedConnection,
  noteInterlockApproved,
} from "../../src/platform/db/runtime-target";

// M3-P12 FIX ROUND TWELVE, CRITERIA finding CR11-M3P12-04 and HAZARD finding
// HZ11-M3P12-02.
//
// THE REGISTER IS THE ONE THING THAT LETS A NON-PRODUCTION PROCESS OPEN A
// DEPLOYED DATABASE, and round ten's version took a free-text label and
// validated nothing. Two reviewers flipped the client's guard with a probe
// that resolved nothing, matched nothing and asserted work it had not done.
//
// THIS FILE RUNS IN ITS OWN MODULE REGISTRY, which is why the register needs
// no clear. Round ten exported resetInterlockApprovalForTest, called it
// "write-once and never cleared" in the same module, and nothing ever invoked
// it; it is gone. A test that needs a register in a known state gets one by
// being the only file that writes to it.
//
// Every connection string below is INVENTED.

const REMOTE =
  "postgresql://postgres.aaaabbbbccccddddeeee:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
const OTHER =
  "postgresql://postgres.qqqqppppoooonnnnmmmm:pw@aws-0-eu-west-9.pooler.supabase.com:5432/postgres";

const MATCHING = {
  host: "aws-0-eu-central-1.pooler.supabase.com",
  projectRef: "aaaabbbbccccddddeeee",
};

describe("an approval is evidence that this module re-verifies, not a label it is handed", () => {
  test("A CALLER THAT DID NO WORK IS REFUSED, which is the probe that defeated round ten", () => {
    // Nothing resolved at all.
    expect(
      noteInterlockApproved("i-am-not-an-interlock", undefined, {}),
    ).toBe(false);
    // An empty connection is not a connection.
    expect(noteInterlockApproved("i-am-not-an-interlock", "   ", {})).toBe(
      false,
    );
    // A connection with no expectation to match it against.
    expect(noteInterlockApproved("i-am-not-an-interlock", REMOTE, {})).toBe(
      false,
    );
    // An expectation that names a DIFFERENT project from the connection the
    // caller itself supplied.
    expect(
      noteInterlockApproved("i-am-not-an-interlock", REMOTE, {
        host: "aws-0-eu-west-9.pooler.supabase.com",
        projectRef: "qqqqppppoooonnnnmmmm",
      }),
    ).toBe(false);
    // An expectation whose host matches but whose ref does not, which is the
    // case the shared-pooler warning exists for.
    expect(
      noteInterlockApproved("i-am-not-an-interlock", REMOTE, {
        host: "aws-0-eu-central-1.pooler.supabase.com",
        projectRef: "qqqqppppoooonnnnmmmm",
      }),
    ).toBe(false);

    // NOTHING WAS RECORDED BY ANY OF THEM.
    expect(approvedConnection()).toBeUndefined();
    expect(approvalSource()).toBeUndefined();
  });

  test("THE CONTROL: evidence that really matches IS recorded, so the refusals above are refusals", () => {
    expect(noteInterlockApproved("the test", REMOTE, MATCHING)).toBe(true);
    expect(approvedConnection()).toBe(REMOTE);
    expect(approvalSource()).toBe("the test");
  });

  // LAST WRITER WINS, DELIBERATELY. Round ten was write-once, and the hazard
  // lane's sharper point is that write-once is the problem rather than the
  // protection: module-graph evaluation runs before any main(), so a caller at
  // import scope would have locked out the real interlock and the real
  // interlock's later call would have been a silent no-op.
  test("a LATER approval with real evidence replaces an earlier one, so nothing can pre-empt the interlock", () => {
    expect(noteInterlockApproved("the test", REMOTE, MATCHING)).toBe(true);
    expect(
      noteInterlockApproved("a later interlock", OTHER, {
        host: "aws-0-eu-west-9.pooler.supabase.com",
        projectRef: "qqqqppppoooonnnnmmmm",
      }),
    ).toBe(true);
    expect(approvedConnection()).toBe(OTHER);
    expect(approvalSource()).toBe("a later interlock");
  });

  // AND A REFUSED APPROVAL DOES NOT DISTURB A GOOD ONE.
  test("a refused approval leaves the standing one untouched", () => {
    expect(noteInterlockApproved("the test", REMOTE, MATCHING)).toBe(true);
    expect(noteInterlockApproved("a liar", OTHER, {})).toBe(false);
    expect(approvedConnection()).toBe(REMOTE);
  });

  test("there is no exported clear: the module that claimed write-once no longer contradicts itself", async () => {
    const registry = await import("../../src/platform/db/runtime-target");
    expect("resetInterlockApprovalForTest" in registry).toBe(false);
  });
});
