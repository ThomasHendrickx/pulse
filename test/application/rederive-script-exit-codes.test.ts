import { describe, expect, test, vi } from "vitest";
import type { HouseholdContext } from "@/platform/tenancy";

// THE LIVE CLIENT IS NEVER CONSTRUCTED. The command under test imports the
// merchants module, which imports the Prisma adapter, which builds a client
// at import time. This test drives main() with injected dependencies and must
// not depend on any environment, so the client module is replaced before the
// import graph is walked.
vi.mock("@/platform/db/client", () => ({ prisma: {} }));

import { main } from "../../scripts/rederive-merchant-rules";

// M3-P12 FIX ROUND FOUR, CRITERIA finding CR4-M3P12-05.
//
// THE EXIT CODES ARE A CONTRACT AND NOTHING EXECUTED THEM. The only test of
// the recompute-failure path read the script as TEXT and asserted that its
// header comment contained the words "EXIT 4", so changing `return 4` to
// `return 1` left every assertion green while the header kept promising 4. A
// contract nothing can execute is prose. main() now takes everything impure
// as a parameter, so the codes can be driven.
//
// Every connection string below is INVENTED: the ref is a hand-typed letter
// run and the password is the literal word.

const HOST = "aws-0-eu-central-1.pooler.supabase.com";
const REF = "aaaabbbbccccddddeeee";
const APPROVED = `postgresql://postgres.${REF}:pw@${HOST}:5432/postgres`;

const emptyRepository = {
  listRules: async () => [],
  listCountedTransactions: async () => [],
  upsertRule: async () => {
    throw new Error("not used by this test");
  },
  applyRuleWrites: async () => {},
};

const argv = (...extra: string[]): readonly string[] => [
  "node",
  "rederive-merchant-rules.ts",
  "--household",
  "household-under-test",
  "--expect-host",
  HOST,
  "--expect-ref",
  REF,
  ...extra,
];

const run = async (over: {
  argv?: readonly string[];
  databaseUrl?: string | undefined;
  recompute?: (context: HouseholdContext) => Promise<void>;
}): Promise<{ code: number; out: string }> => {
  const lines: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...parts) => {
    lines.push(parts.map(String).join(" "));
  });
  const error = vi.spyOn(console, "error").mockImplementation((...parts) => {
    lines.push(parts.map(String).join(" "));
  });
  try {
    const code = await main({
      argv: over.argv ?? argv(),
      databaseUrl: "databaseUrl" in over ? over.databaseUrl : APPROVED,
      merchants: emptyRepository,
      recompute: over.recompute ?? (async () => {}),
    });
    return { code, out: lines.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
};

describe("the command's exit codes, executed rather than asserted about its comments", () => {
  test("THE CONTROL: an approved target and a clean run exits 0 and says it applied", async () => {
    const { code, out } = await run({});
    expect(code).toBe(0);
    expect(out).toContain("applied yes");
  });

  // THE ONE THE FINDING IS ABOUT. Changing `return 4` to `return 1` now fails
  // here instead of leaving a header comment promising a code nothing returns.
  test("EXIT 4: the rule writes committed and the recompute then failed, and the report still says applied yes", async () => {
    const { code, out } = await run({
      recompute: async () => {
        throw new Error("simulated recompute failure");
      },
    });
    expect(code).toBe(4);
    expect(out).toContain("applied yes");
    expect(out).toContain("--- decision report ---");
    expect(out).toContain("RE-RUN THIS COMMAND");
    // And it must NOT tell the operator nothing was written.
    expect(out).not.toContain("nothing was written");
  });

  test("EXIT 3: a refused target, and it is decided before the household argument is read", async () => {
    const { code, out } = await run({
      databaseUrl: `postgresql://postgres.aaaabbbbccccddddeeef:pw@${HOST}:5432/postgres`,
      argv: ["node", "rederive-merchant-rules.ts", "--expect-host", HOST, "--expect-ref", REF],
    });
    expect(code).toBe(3);
    expect(out).not.toContain("--household");
  });

  test("EXIT 2: an approved target with no household named", async () => {
    const { code } = await run({
      argv: ["node", "rederive-merchant-rules.ts", "--expect-host", HOST, "--expect-ref", REF],
    });
    expect(code).toBe(2);
  });

  test("EXIT 0 on a dry run, which says in words that it wrote nothing", async () => {
    const { code, out } = await run({ argv: argv("--dry-run") });
    expect(code).toBe(0);
    expect(out).toContain("applied no");
    expect(out).toContain("this was a dry run");
  });

  // A NON-RECOMPUTE FAILURE IS NOT SWALLOWED INTO EXIT 4. The distinction is
  // the whole point of the distinguishable error: only a throw AFTER the
  // committed writes may claim the table changed.
  test("a failure INSIDE the rule writes propagates instead of returning 4", async () => {
    await expect(
      main({
        argv: argv(),
        databaseUrl: APPROVED,
        merchants: {
          ...emptyRepository,
          applyRuleWrites: async () => {
            throw new Error("simulated write failure");
          },
        },
        recompute: async () => {},
      }),
    ).rejects.toThrow("simulated write failure");
  });
});
