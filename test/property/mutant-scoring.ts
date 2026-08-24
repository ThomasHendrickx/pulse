// HOW A MUTANT RUN IS SCORED, as a pure function so the scoring itself can be
// tested (M3-P12 fix round nine, HAZARD finding CR7-M3P12-02).
//
// WHY IT LIVES APART FROM THE HARNESS. test/property/mutants.mts edits the
// module under test at import time, so nothing may import it, which meant its
// four-way discriminator could only ever be exercised by running the harness.
// The crash-versus-catch branch got a live self-check when it was added; the
// unattributed branch had none, and a branch nothing exercises is how the
// defect it replaced arrived in the first place. Extracting the decision makes
// every branch reachable from the fast gate with a canned report.
//
// THE FOUR OUTCOMES, and each is a failure of the harness unless it is the one
// the entry expects:
//
//   green         the property file passed, so the mutant was not caught
//   dies          it exited non-zero with NO AssertionError, so nothing in the
//                 properties discriminated anything
//   unattributed  an assertion fired but no named property owns the failure,
//                 so the record would say nothing about which check caught it
//   caught        an assertion fired inside a named property

export type MutantOutcome = "green" | "dies" | "unattributed" | "caught";

// The two properties, named so the record says WHICH one caught each mutant.
export const FIRST_PROPERTY = "the loss set and the claimant-merchant class";
export const SECOND_PROPERTY =
  "every published claimant pair and every published promotion pair";

export type Scoring = {
  readonly outcome: MutantOutcome;
  readonly properties: readonly string[];
  readonly message: string;
};

// ATTRIBUTION READS THE FAILURE LINES AND NOT THE WHOLE OUTPUT. Vitest prints
// every test's title on a pass as well as a failure, so a substring search
// over the report says both properties caught every mutant, which is the
// opposite of the thing the harness exists to establish.
export const scoreMutantRun = (
  exitedNonZero: boolean,
  report: string,
): Scoring => {
  const failed = report
    .split("\n")
    .filter((line) => line.trimStart().startsWith("FAIL"))
    .map((line) => line.trim());
  const properties: string[] = [];
  if (failed.some((line) => line.includes(FIRST_PROPERTY))) {
    properties.push("FIRST biconditional");
  }
  if (failed.some((line) => line.includes(SECOND_PROPERTY))) {
    properties.push("SECOND, the lineage check");
  }
  const assertion = report
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.includes("AssertionError:"))
    ?.replace(/^Caused by: /, "");
  const outcome: MutantOutcome = !exitedNonZero
    ? "green"
    : assertion === undefined
      ? "dies"
      : properties.length === 0
        ? "unattributed"
        : "caught";
  return {
    outcome,
    properties,
    message: assertion ?? "(no assertion line found)",
  };
};
