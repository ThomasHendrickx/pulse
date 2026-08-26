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
// THE FIVE OUTCOMES, and each is a failure of the harness unless it is the one
// the entry expects:
//
//   green         the property file passed, so the mutant was not caught
//   dies          it exited non-zero with NO AssertionError anywhere, so
//                 nothing in the properties discriminated anything
//   unattributed  an assertion fired but no named property owns the failure,
//                 so the record would say nothing about which check caught it
//   partial       one property asserted while ANOTHER failing test produced no
//                 assertion at all, which means half the instrument crashed
//   caught        every failing test asserted, and at least one is a named
//                 property
//
// THE FIFTH WAS ADDED IN FIX ROUND NINE (CRITERIA finding CR7-M3P12-04) and
// the four before it could not express it. The scoring used to ask two
// questions of the WHOLE report: does the string "AssertionError:" appear
// anywhere in it, and does any FAIL line name a property. A run in which one
// property raised an assertion and the other DIED of a runtime error answered
// yes to both and printed the same sentence a clean double catch prints, so
// half the instrument crashing was indistinguishable from the whole instrument
// working. That shape is not hypothetical: M5 and M4 both report red on BOTH
// properties today, which is exactly the report a collapse would hide behind.
//
// THE REPAIR IS TO STOP READING THE REPORT AS ONE STRING. Vitest prints one
// FAIL line per failing test followed by that test's own error, so the report
// is split at its FAIL lines and each failing test is asked separately whether
// an assertion fired. A failing test with no assertion is a DEAD test whatever
// its neighbours did.

export type MutantOutcome =
  | "green"
  | "dies"
  | "unattributed"
  | "partial"
  | "caught";

// The two properties, named so the record says WHICH one caught each mutant.
export const FIRST_PROPERTY = "the loss set and the claimant-merchant class";
export const SECOND_PROPERTY =
  "every published claimant pair and every published promotion pair";

export type Scoring = {
  readonly outcome: MutantOutcome;
  readonly properties: readonly string[];
  readonly message: string;
};

// ONE FAILING TEST, ONE BLOCK. A block is a FAIL line and every line after it
// up to the next FAIL line, which is the failing test's OWN output. Anything
// printed before the first FAIL line is preamble and is attributed to nothing:
// vitest prints every test's title on a pass as well as a failure, so a
// substring search over the whole report says both properties caught every
// mutant, which is the opposite of the thing the harness exists to establish.
type FailureBlock = {
  readonly headline: string;
  readonly property: string | undefined;
  readonly assertion: string | undefined;
};

const failureBlocks = (report: string): readonly FailureBlock[] => {
  const blocks: { headline: string; lines: string[] }[] = [];
  for (const line of report.split("\n")) {
    if (line.trimStart().startsWith("FAIL")) {
      blocks.push({ headline: line.trim(), lines: [] });
    } else if (blocks.length > 0) {
      blocks[blocks.length - 1]!.lines.push(line);
    }
  }
  return blocks.map(({ headline, lines }) => ({
    headline,
    property: headline.includes(FIRST_PROPERTY)
      ? "FIRST biconditional"
      : headline.includes(SECOND_PROPERTY)
        ? "SECOND, the lineage check"
        : undefined,
    assertion: lines
      .map((line) => line.trim())
      .find((line) => line.includes("AssertionError:"))
      ?.replace(/^Caused by: /, ""),
  }));
};

export const scoreMutantRun = (
  exitedNonZero: boolean,
  report: string,
): Scoring => {
  const blocks = failureBlocks(report);
  const caught = blocks.filter(
    (block) => block.property !== undefined && block.assertion !== undefined,
  );
  const dead = blocks.filter((block) => block.assertion === undefined);
  const asserted = blocks.filter((block) => block.assertion !== undefined);
  const properties = caught
    .map((block) => block.property as string)
    .filter((name, index, all) => all.indexOf(name) === index);

  const outcome: MutantOutcome = !exitedNonZero
    ? "green"
    : asserted.length === 0
      ? "dies"
      : caught.length > 0 && dead.length > 0
        ? "partial"
        : caught.length === 0
          ? "unattributed"
          : "caught";

  const message =
    outcome === "partial"
      ? `${caught[0]!.assertion} -- BUT ${dead.length} failing test(s) produced no assertion at all, the first being: ${dead[0]!.headline}`
      : (asserted[0]?.assertion ?? "(no assertion line found)");

  return { outcome, properties, message };
};
