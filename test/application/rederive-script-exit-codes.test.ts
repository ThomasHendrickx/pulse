import { describe, expect, test, vi } from "vitest";
import type { HouseholdContext } from "@/platform/tenancy";

// THE LIVE CLIENT IS NEVER CONSTRUCTED, and the reason has changed (fix round
// ten, HAZARD finding CR9-M3P12-HZ-01). This comment used to say that the
// command "imports the merchants module, which imports the Prisma adapter,
// which builds a client at import time", and that was true and was the defect:
// merely walking this import graph constructed a client from whatever the
// environment held, before any interlock ran. src/platform/db/client.ts is now
// LAZY, so the import graph builds nothing on its own.
//
// The mock is KEPT rather than removed, for a different and still-good reason:
// this test drives main() with injected dependencies and must not depend on
// any environment at all, and a stub is a stronger statement of that than
// relying on no code path happening to touch the binding.
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
// UPDATED FOR THE INTERLOCK WITHDRAWAL (decision D-62, criterion 12.23):
// the routine's guard is now assessDestructiveDbTarget over the client's own
// connection string, so an APPROVED target here is the LOCAL stack rather
// than a host-and-ref pair, and the expect-* arguments are gone. The refusal
// side of the guard has its own witnesses in
// test/db/rederive-interlock.test.ts (criterion 12.23 measurements TWO,
// FOUR and FIVE); this file keeps the exit codes of the run itself.
//
// Every connection string below is INVENTED.

const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const REMOTE =
  "postgresql://postgres.aaaabbbbccccddddeeee:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";

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
  ...extra,
];

const run = async (over: {
  argv?: readonly string[];
  databaseUrl?: string | undefined;
  allowRemoteDestruction?: string | undefined;
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
      databaseUrl: "databaseUrl" in over ? over.databaseUrl : LOCAL,
      allowRemoteDestruction: over.allowRemoteDestruction,
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
  test("THE CONTROL: a local target and a clean run exits 0 and says it applied", async () => {
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
      databaseUrl: REMOTE,
      argv: ["node", "rederive-merchant-rules.ts"],
    });
    expect(code).toBe(3);
    expect(out).not.toContain("--household");
  });

  test("EXIT 2: an approved target with no household named", async () => {
    const { code } = await run({
      argv: ["node", "rederive-merchant-rules.ts"],
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
        databaseUrl: LOCAL,
        allowRemoteDestruction: undefined,
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
