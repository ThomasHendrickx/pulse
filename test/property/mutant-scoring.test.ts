import { describe, expect, test } from "vitest";
import {
  FIRST_PROPERTY,
  SECOND_PROPERTY,
  scoreMutantRun,
} from "./mutant-scoring";

// M3-P12 FIX ROUND NINE, HAZARD finding CR7-M3P12-02.
//
// The mutant harness decides four ways and only one of the four was exercised
// by anything: the crash branch got a live self-check when it was added, and
// the unattributed branch had none. A branch nothing exercises is how the
// defect that branch replaced arrived, so all four are driven here with canned
// runner output. The reports below are the shapes vitest actually emits,
// trimmed to the lines the scoring reads.

const passing = `
 ✓ test/property/rederive-loss-reporting.test.ts (2 tests) 260ms
 Test Files  1 passed (1)
`;

const failedIn = (title: string) => `
 ❯ CRITERION 12.7 > ${title} 37ms
 FAIL  test/property/rederive-loss-reporting.test.ts > CRITERION 12.7 > ${title}
Caused by: AssertionError: expected { row: 'accountRow', lost: false } to deeply equal { row: 'accountRow', lost: true }
`;

// A file that DIED: non-zero exit, a FAIL line naming the file, and no
// assertion anywhere. This is what a compile error, an import failure or a
// throw inside the runner looks like.
const died = `
 FAIL  test/property/rederive-loss-reporting.test.ts [ test/property/rederive-loss-reporting.test.ts ]
ReferenceError: thisIdentifierDoesNotExist is not defined
`;

// An assertion fired, but the FAIL line names a test neither property owns.
const unowned = `
 FAIL  test/property/rederive-loss-reporting.test.ts > some other describe > a test nobody named
Caused by: AssertionError: expected 1 to be 2
`;

// HALF THE INSTRUMENT CRASHING, in the shape vitest really prints it (fix
// round nine, CRITERIA finding CR7-M3P12-04). This transcript was CAPTURED
// from a real run of a two-test file, one test asserting and one calling a
// function that does not exist, and trimmed to the lines the scoring reads.
// Under the whole-report scoring this returned "caught" on both properties and
// printed the same sentence a clean double catch prints.
const partial = `
 FAIL  test/property/rederive-loss-reporting.test.ts > CRITERION 12.7 > ${FIRST_PROPERTY}
AssertionError: expected 1 to be 2 // Object.is equality
 FAIL  test/property/rederive-loss-reporting.test.ts > CRITERION 12.7 > ${SECOND_PROPERTY}
TypeError: globalThis.nope is not a function
`;

describe("the mutant harness scores an outcome by identity, not by exit code", () => {
  test("GREEN: the property file passed, so the mutant was not caught", () => {
    expect(scoreMutantRun(false, passing).outcome).toBe("green");
  });

  test("CAUGHT: an assertion fired inside a named property, and the property is attributed", () => {
    const first = scoreMutantRun(true, failedIn(FIRST_PROPERTY));
    expect(first.outcome).toBe("caught");
    expect(first.properties).toEqual(["FIRST biconditional"]);
    expect(first.message).toContain("AssertionError:");
    expect(first.message).not.toContain("Caused by:");

    const both = scoreMutantRun(
      true,
      `${failedIn(FIRST_PROPERTY)}${failedIn(SECOND_PROPERTY)}`,
    );
    expect(both.outcome).toBe("caught");
    expect(both.properties).toEqual([
      "FIRST biconditional",
      "SECOND, the lineage check",
    ]);
  });

  // THE BRANCH THAT WAS ONLY EVER PROSE. A non-zero exit with no assertion is
  // the file dying, and before fix round eight it was scored as a catch.
  test("DIES: non-zero exit with no AssertionError is not a catch", () => {
    const scoring = scoreMutantRun(true, died);
    expect(scoring.outcome).toBe("dies");
    expect(scoring.message).toBe("(no assertion line found)");
  });

  // THE BRANCH WITH NO LIVE SELF-CHECK, which is what this file is for.
  test("UNATTRIBUTED: an assertion fired that no named property owns", () => {
    const scoring = scoreMutantRun(true, unowned);
    expect(scoring.outcome).toBe("unattributed");
    expect(scoring.properties).toEqual([]);
  });

  // THE FIFTH OUTCOME, AND THE FOUR NAMES DID NOT COVER IT. One property
  // asserts, the other dies of a runtime error. This is NOT a catch: the
  // second property proved nothing, and reporting it as one hides a broken
  // instrument behind a working one.
  test("PARTIAL: one property asserted while another failing test produced no assertion", () => {
    const scoring = scoreMutantRun(true, partial);
    expect(scoring.outcome).toBe("partial");
    // The property that really did assert is still attributed, and the one
    // that died is NOT credited with a catch it did not make.
    expect(scoring.properties).toEqual(["FIRST biconditional"]);
    expect(scoring.message).toContain("no assertion at all");
  });

  // AND A DEAD BLOCK ALONE IS STILL "dies", not "partial": partial needs one
  // of each, so the two outcomes cannot absorb one another.
  test("a run in which EVERY failing test died is dies, not partial", () => {
    const bothDied = `
 FAIL  test/property/rederive-loss-reporting.test.ts > CRITERION 12.7 > ${FIRST_PROPERTY}
TypeError: globalThis.nope is not a function
 FAIL  test/property/rederive-loss-reporting.test.ts > CRITERION 12.7 > ${SECOND_PROPERTY}
TypeError: globalThis.nope is not a function
`;
    expect(scoreMutantRun(true, bothDied).outcome).toBe("dies");
  });

  // AN ASSERTION IN THE PREAMBLE BELONGS TO NOBODY. Before the split, an
  // "AssertionError:" printed anywhere in stdout, including by a test's own
  // console output, made a dying run look like a catch.
  test("an AssertionError printed OUTSIDE any failing test's block does not rescue a dead run", () => {
    const noise = `
stdout | some other test
the words AssertionError: appear here as text
${died}`;
    expect(scoreMutantRun(true, noise).outcome).toBe("dies");
  });

  // AND THE ATTRIBUTION READS FAILURE LINES, NOT THE WHOLE REPORT. A passing
  // run prints every title too, so a substring search would report that both
  // properties caught every mutant.
  test("a property named only in a PASSING line is not credited with the catch", () => {
    const mixed = ` ✓ CRITERION 12.7 > ${SECOND_PROPERTY} 12ms\n${failedIn(FIRST_PROPERTY)}`;
    const scoring = scoreMutantRun(true, mixed);
    expect(scoring.outcome).toBe("caught");
    expect(scoring.properties).toEqual(["FIRST biconditional"]);
  });
});
