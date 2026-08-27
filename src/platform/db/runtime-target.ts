import { assessRederiveTarget, type RederiveTargetExpectation } from "./target-guard";

// AN APPROVAL THAT CARRIES THE TARGET IT APPROVED (M3-P12 fix round twelve,
// CRITERIA finding CR11-M3P12-04 and HAZARD finding HZ11-M3P12-02).
//
// WHY THIS EXISTS. Two things had to be true at once and neither could be
// given up. The application's Prisma client must be able to open PRODUCTION,
// which is why it cannot call the gate assertion: that assertion refuses
// everything that is not the local stack. And every NON-PRODUCTION entry point
// that reaches that client must not be able to open a target nobody named.
// The one case between them is the re-derivation command: a tsx entry point,
// not production, whose whole purpose is to open a DEPLOYED database, and
// which proves its target harder than anything else here by requiring an
// explicit host and project ref on its own command line.
//
// WHAT ROUND TEN SHIPPED AND WHY IT WAS A FLAG AFTER ALL, quoted rather than
// deleted (clause R-087). This module said:
//
//   "Only code inside this process that has actually done that work can call
//   this."
//
// That sentence was FALSE. noteInterlockApproved took a free-text label,
// validated nothing, resolved nothing and recorded nothing about the target.
// Two reviewers called it from probes that checked absolutely nothing, and the
// client then constructed against a non-local host, printing a reason that
// asserted work which never happened. Round ten's entire argument for widening
// the client's guard rested on this being a fact rather than a flag, and it
// was a flag reachable by any module in the import graph.
//
//   "IT IS DELIBERATELY WRITE-ONCE AND NEVER CLEARED."
//
// That was false twice over. The module exported a clear, which nothing
// called, so the widening bought nothing and the sentence contradicted the
// file it was written in. And write-once is not the protection it reads as:
// the FIRST writer wins, and module-graph evaluation runs before any main(),
// so a caller at import scope would silently pre-empt the real interlock and
// the real interlock's later call would become a no-op that nothing reported.
//
//   "THE PROCESS'S OWN RECORD"
//
// Also false, and measured: an ESM caller and a CJS caller get TWO copies of
// this module in one process, so there are two registers. That direction is
// fail closed, because a client resolved through the copy with no approval
// refuses, so it is not a hole; but the sentence claimed a property the module
// does not have.
//
// WHAT IT DOES NOW, and every clause of this is checked by a test rather than
// asserted here.
//
//   THE APPROVAL IS EVIDENCE, NOT A LABEL. A caller hands over the connection
//   string it resolved and the expectation the operator gave on the command
//   line, and THIS MODULE RE-RUNS assessRederiveTarget over them. A caller
//   that resolved nothing cannot produce a pair that passes, so the probe that
//   defeated round ten's version is refused here.
//
//   THE APPROVAL NAMES A CONNECTION. What is recorded is the exact connection
//   string that was approved. The client compares the string it is about to
//   open against that one, so an approval is a statement about a specific
//   database rather than a mood, and an approval obtained for one target does
//   not admit another.
//
//   LAST WRITER WINS, DELIBERATELY, and the ordering guarantee is explicit
//   rather than incidental. An approval for a NEW target replaces the previous
//   one, which is the safe direction under the pre-emption above: a caller at
//   import scope can no longer lock out the real interlock, because the real
//   interlock's own call, made later and with real evidence, is the one that
//   stands.
//
//   THERE IS NO CLEAR. The test-only reset is gone. A test that needs a clean
//   register drives assessNonProductionDbTarget directly, which is a pure
//   function taking the approval as a parameter.
//
// SIBLING READERS: the one caller today is scripts/rederive-merchant-rules.ts,
// and test/db/gate-target.test.ts holds an allow list over the tracked tree
// that makes a second caller red.

type Approval = {
  readonly source: string;
  readonly connection: string;
};

let approval: Approval | undefined;

// Called by an interlock that has resolved the connection it would open and
// been given a target on the command line. The assessment is re-run HERE, so
// the caller's own diligence is not taken on trust. Returns whether the
// approval was recorded, so a caller can report a refusal rather than assume.
export const noteInterlockApproved = (
  source: string,
  connection: string | undefined,
  expectation: RederiveTargetExpectation,
): boolean => {
  if (connection === undefined || connection.trim() === "") {
    return false;
  }
  const verdict = assessRederiveTarget({ DATABASE_URL: connection }, expectation);
  if (!verdict.allowed) {
    return false;
  }
  approval = { source, connection };
  return true;
};

// The connection this process has an interlock's approval to open, or
// undefined. The value is a connection string and is never printed: this
// repository is public.
export const approvedConnection = (): string | undefined => approval?.connection;

// The caller that obtained the approval, for the guard's reason line. Never a
// connection string.
export const approvalSource = (): string | undefined => approval?.source;
