// THE PROCESS'S OWN RECORD OF AN APPROVED TARGET (M3-P12 fix round ten,
// HAZARD finding CR9-M3P12-HZ-01).
//
// WHY THIS EXISTS. Two things had to be true at once and neither could be
// given up. The application's Prisma client must be able to open PRODUCTION,
// which is why it cannot call the gate assertion: that assertion refuses
// everything that is not the local stack. And every NON-PRODUCTION entry point
// that reaches that client must not be able to open a target nobody named,
// which is what the client's old guard failed to do, because it returned
// allowed for every NODE_ENV that was not exactly "development" and so checked
// nothing under vitest and nothing under tsx.
//
// The one case that sits between those two is the re-derivation command: a tsx
// entry point, not production, whose whole purpose is to open a DEPLOYED
// database, and which already proves its target harder than anything else in
// this tree by requiring an explicit host AND project ref on its own command
// line. Refusing it would refuse the one command criterion 12.23 exists for.
//
// SO THE ANSWER IS NOT A FLAG. An environment variable saying "this target is
// fine" is an assertion of the very thing being checked, which is the reason
// the gate interlock has no override and the re-derivation interlock has no
// override. What is recorded here instead is a FACT ESTABLISHED IN THIS
// PROCESS: an interlock ran, it was given a target on the command line, it
// resolved the connection that would actually be opened, and it matched. Only
// code inside this process that has actually done that work can call this.
//
// IT IS DELIBERATELY WRITE-ONCE AND NEVER CLEARED. A second interlock
// approving a second target within one process is not a shape this repository
// has, and silently replacing an approval would turn this into the flag it
// exists not to be.
//
// SIBLING READERS: the two interlocks that may call this are
// src/platform/db/target-guard.ts's caller in scripts/rederive-merchant-rules.ts
// and nothing else today. src/platform/db/gate-target.ts does NOT call it: the
// gate pins its target by assigning process.env, so the client's own guard
// sees a local host and needs no approval.

let approval: string | undefined;

// Called by an interlock that has resolved the connection it would open and
// matched it against a target named explicitly by the operator. The source is
// printed in the client's refusal, never the target.
export const noteInterlockApproved = (source: string): void => {
  if (approval === undefined) {
    approval = source;
  }
};

export const interlockApproval = (): string | undefined => approval;

// TEST ONLY. Exported because a suite that could not reset this would have to
// run each case in its own process; named so that a production call site is
// obvious in review.
export const resetInterlockApprovalForTest = (): void => {
  approval = undefined;
};
