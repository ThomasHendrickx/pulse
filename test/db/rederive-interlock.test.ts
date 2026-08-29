import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

// CRITERION 12.23: THE ROUTINE CANNOT OPEN A DATABASE THAT IS NOT THE LOCAL
// STACK, measured five ways, each of which fails on its own; plus the
// absence assertions decision D-62's withdrawal requires. The withdrawn
// instrument (target-guard.ts, runtime-target.ts, gate-target.ts,
// connection-string.ts and the approval branch in guard.ts and client.ts)
// is asserted GONE at the bottom of this file; nothing broader is claimed,
// because a semantic absence is not a testable property, which is the
// lesson decision D-62 records.
//
// Every connection string here is INVENTED and reuses the exact invented
// values test/db/db-guard.test.ts already carries, so no new identifier
// shape enters the tree.

// THE ONE RESOLUTION MODULE IS STUBBED (criterion 12.23 measurement THREE,
// finding R2-M0P14-03). Both consumers, guard-cli.ts and the routine, import
// their reading from src/platform/db/resolve-env.ts; stubbing that ONE
// module and watching both consumers change answer together is the
// structural pin that a second inline copy could not satisfy. The stub gives
// the two exports DIFFERENT answers on purpose: guard-cli must follow
// resolveDbEnv (the Prisma CLI's shell-first, dot-env-fallback reading) and
// the routine must follow resolveClientDbUrl (the client's process.env-only
// reading, finding CR3-M3P12-03), so a consumer wired to the wrong export
// reddens here.
const stub = vi.hoisted(() => ({
  dbEnv: {} as Record<string, string | undefined>,
  clientUrl: undefined as string | undefined,
}));
vi.mock("@/platform/db/resolve-env", () => ({
  resolveDbEnv: (name: string) => stub.dbEnv[name],
  resolveClientDbUrl: () => stub.clientUrl,
  readDotEnvValue: () => undefined,
}));

import { main } from "../../scripts/rederive-merchant-rules";
import type { RederiveMainDeps } from "../../scripts/rederive-merchant-rules";
import { merchantRepository } from "../../src/modules/merchants/application";
import { prismaHasBeenConstructed } from "../../src/platform/db/client";

const projectRoot = join(__dirname, "..", "..");
const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const REMOTE =
  "postgresql://postgres.aaaabbbbccccddddeeee:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";
const REMOTE_HOST = "aws-0-eu-central-1.pooler.supabase.com";
const REMOTE_REF = "aaaabbbbccccddddeeee";

// MEASUREMENT FIVE'S PREDICATE, applied to the captured output of every
// refusal case in this file: no connection string, password or host on any
// path.
const leaksNothing = (captured: string): void => {
  expect(captured).not.toContain(REMOTE);
  expect(captured).not.toContain(REMOTE_HOST);
  expect(captured).not.toContain(REMOTE_REF);
  expect(captured).not.toContain(":pw@");
};

// A fake repository that RECORDS every call, so a refused run can prove it
// read nothing rather than assert it.
const recordingRepository = () => {
  const calls: string[] = [];
  const repository: RederiveMainDeps["merchants"] = {
    listRules: async () => {
      calls.push("listRules");
      return [];
    },
    listCountedTransactions: async () => {
      calls.push("listCountedTransactions");
      return [];
    },
    applyRuleWrites: async () => {
      calls.push("applyRuleWrites");
    },
  };
  return { calls, repository };
};

const runMain = async (deps: {
  argv?: readonly string[];
  databaseUrl: string | undefined;
  allowRemoteDestruction?: string | undefined;
  merchants?: RederiveMainDeps["merchants"];
}): Promise<{ code: number; out: string; calls: string[] }> => {
  const recording = recordingRepository();
  const lines: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...parts) => {
    lines.push(parts.map(String).join(" "));
  });
  const error = vi.spyOn(console, "error").mockImplementation((...parts) => {
    lines.push(parts.map(String).join(" "));
  });
  try {
    const code = await main({
      argv: deps.argv ?? ["node", "rederive-merchant-rules.ts", "--household", "h1"],
      databaseUrl: deps.databaseUrl,
      allowRemoteDestruction: deps.allowRemoteDestruction,
      merchants: deps.merchants ?? recording.repository,
      recompute: async () => {},
    });
    return { code, out: lines.join("\n"), calls: recording.calls };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
};

describe("MEASUREMENT ONE: the invocation point runs the guard first, joined with &&", () => {
  const scripts = (
    JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    }
  ).scripts;

  test("rederive:merchant-rules runs tsx src/platform/db/guard-cli.ts before the routine, and the join is &&", () => {
    const command = scripts["rederive:merchant-rules"];
    expect(command).toBe(
      "tsx src/platform/db/guard-cli.ts && tsx scripts/rederive-merchant-rules.ts",
    );
    // Said again as structure, so the assertion's intent survives a
    // legitimate rewording: guard first, routine second, and the chain is
    // conjunctive. A semicolon or || here is RED rather than merely unusual.
    expect(command?.indexOf("guard-cli.ts")).toBeLessThan(
      command?.indexOf("rederive-merchant-rules.ts") ?? -1,
    );
    expect(command).toContain(" && ");
    expect(command).not.toContain(";");
    expect(command).not.toContain("||");
  });

  test("it is the same form db:reset and db:migrate already use", () => {
    for (const name of ["db:reset", "db:migrate", "rederive:merchant-rules"]) {
      expect(scripts[name]).toMatch(/^tsx src\/platform\/db\/guard-cli\.ts && /);
    }
  });
});

describe("MEASUREMENT TWO: the routine refuses for itself", () => {
  test("a non-local connection with no hatch exits non-zero and the repository records NO call", async () => {
    const { code, out, calls } = await runMain({ databaseUrl: REMOTE });
    expect(code).toBe(3);
    expect(calls).toEqual([]);
    expect(out).toContain("refusing");
    leaksNothing(out);
  });

  test("an ABSENT connection string refuses rather than guesses, before any repository call", async () => {
    const { code, calls, out } = await runMain({ databaseUrl: undefined });
    expect(code).toBe(3);
    expect(calls).toEqual([]);
    expect(out).toContain("DATABASE_URL");
  });

  // INVOKING THE FILE DIRECTLY, not through the npm script, so the chained
  // guard-cli is provably not the only thing standing in the way. The child
  // gets the INVENTED remote connection and no hatch; it must exit 3 having
  // touched nothing (the lazy client constructs only on a repository call,
  // which the refusal precedes).
  test("the routine's own entry point, invoked directly against a non-local target, exits non-zero", () => {
    const env: Record<string, string | undefined> = {
      ...process.env,
      DATABASE_URL: REMOTE,
      DIRECT_URL: undefined,
      PULSE_ALLOW_REMOTE_DB_DESTRUCTION: undefined,
      PULSE_ALLOW_REMOTE_DB_IN_DEV: undefined,
    };
    const result = spawnSync(
      join(projectRoot, "node_modules", ".bin", "tsx"),
      [join(projectRoot, "scripts", "rederive-merchant-rules.ts"), "--household", "h1"],
      { env: env as NodeJS.ProcessEnv, cwd: projectRoot, encoding: "utf-8" },
    );
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("refusing");
    leaksNothing(`${result.stdout}${result.stderr}`);
  });
});

describe("MEASUREMENT THREE: one resolution module, each consumer pinned to ITS export", () => {
  // guard-cli exits at module scope, so each run re-evaluates the module
  // with process.exit trapped; the throw stops evaluation exactly where the
  // real exit would.
  const runGuardCli = async (): Promise<{ code: number; out: string }> => {
    vi.resetModules();
    let exitCode = -1;
    const lines: string[] = [];
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number | string | null) => {
        exitCode = typeof code === "number" ? code : 0;
        throw new Error("guard-cli-exit-sentinel");
      }) as (code?: number | string | null) => never);
    const log = vi.spyOn(console, "log").mockImplementation((...parts) => {
      lines.push(parts.map(String).join(" "));
    });
    const error = vi.spyOn(console, "error").mockImplementation((...parts) => {
      lines.push(parts.map(String).join(" "));
    });
    const previousHatch = process.env.PULSE_ALLOW_REMOTE_DB_DESTRUCTION;
    delete process.env.PULSE_ALLOW_REMOTE_DB_DESTRUCTION;
    try {
      await import("../../src/platform/db/guard-cli");
      throw new Error("guard-cli returned without exiting");
    } catch (thrown) {
      if (!(thrown instanceof Error) || !String(thrown.message).includes("guard-cli-exit-sentinel")) {
        throw thrown;
      }
    } finally {
      if (previousHatch !== undefined) {
        process.env.PULSE_ALLOW_REMOTE_DB_DESTRUCTION = previousHatch;
      }
      exit.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
    return { code: exitCode, out: lines.join("\n") };
  };

  // The routine's default dependencies read resolveClientDbUrl at call time,
  // so calling main() with no argument is what routes it through the stubbed
  // module. process.argv carries no --household under vitest, so a run that
  // gets PAST the guard stops at exit 2, before any repository exists.
  const runRoutineOnStub = async (): Promise<number> => {
    expect(process.argv).not.toContain("--household");
    const previousHatch = process.env.PULSE_ALLOW_REMOTE_DB_DESTRUCTION;
    delete process.env.PULSE_ALLOW_REMOTE_DB_DESTRUCTION;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      return await main();
    } finally {
      if (previousHatch !== undefined) {
        process.env.PULSE_ALLOW_REMOTE_DB_DESTRUCTION = previousHatch;
      }
      log.mockRestore();
      error.mockRestore();
    }
  };

  test("guard-cli follows resolveDbEnv and the routine follows resolveClientDbUrl, from the ONE stubbed module", async () => {
    // The two exports answer DIFFERENTLY: the CLI reading sees the local
    // stack, the client reading sees the invented remote. A consumer wired
    // to the wrong export gives the wrong answer on exactly this split.
    stub.dbEnv = { DATABASE_URL: LOCAL, DIRECT_URL: LOCAL };
    stub.clientUrl = REMOTE;
    const cli = await runGuardCli();
    expect(cli.code).toBe(0);
    expect(await runRoutineOnStub()).toBe(3);

    // And the split reversed: both consumers change answer together when
    // the one module's answers change, which no second inline copy would.
    stub.dbEnv = { DATABASE_URL: REMOTE, DIRECT_URL: REMOTE };
    stub.clientUrl = LOCAL;
    const cliReversed = await runGuardCli();
    expect(cliReversed.code).toBe(1);
    leaksNothing(cliReversed.out);
    expect(await runRoutineOnStub()).toBe(2);
  });

  test("no file under src or scripts other than resolve-env.ts opens a .env file by name", () => {
    const offenders: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else if (/\.(ts|tsx|mts|mjs)$/.test(entry)) {
          const source = readFileSync(path, "utf-8");
          if (/["'`]\.env["'`]/.test(source)) {
            offenders.push(path);
          }
        }
      }
    };
    walk(join(projectRoot, "src"));
    walk(join(projectRoot, "scripts"));
    expect(offenders).toEqual([
      join(projectRoot, "src", "platform", "db", "resolve-env.ts"),
    ]);
  });
});

describe("MEASUREMENT FOUR: the hatches are the only way through, and neither is an argument", () => {
  test("with the destruction hatch set, the routine proceeds past its own guard", async () => {
    const { code, out, calls } = await runMain({
      databaseUrl: REMOTE,
      allowRemoteDestruction: "1",
    });
    expect(code).toBe(0);
    expect(out).toContain("PULSE_ALLOW_REMOTE_DB_DESTRUCTION=1 is set");
    // Past the guard means the run actually ran: the repository was read.
    expect(calls).toContain("listRules");
  });

  // THE SECOND GUARD, WITNESSED RATHER THAN ASSUMED: a repository-backed
  // invocation carrying ONLY the destruction hatch reaches the real
  // adapter, whose first call constructs the application client, and the
  // client's own construction-time check (assessNonProductionDbTarget,
  // which stays) refuses the non-local target because
  // PULSE_ALLOW_REMOTE_DB_IN_DEV is not set. The deployed run therefore
  // needs BOTH hatches inline, which is M3-P16's command line.
  test("a repository-backed invocation carrying ONLY the destruction hatch is REFUSED at client construction", async () => {
    const previousUrl = process.env.DATABASE_URL;
    const previousInDev = process.env.PULSE_ALLOW_REMOTE_DB_IN_DEV;
    process.env.DATABASE_URL = REMOTE;
    delete process.env.PULSE_ALLOW_REMOTE_DB_IN_DEV;
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...parts) => {
      lines.push(parts.map(String).join(" "));
    });
    const error = vi.spyOn(console, "error").mockImplementation((...parts) => {
      lines.push(parts.map(String).join(" "));
    });
    try {
      await expect(
        main({
          argv: ["node", "rederive-merchant-rules.ts", "--household", "h1"],
          databaseUrl: REMOTE,
          allowRemoteDestruction: "1",
          merchants: merchantRepository,
          recompute: async () => {},
        }),
      ).rejects.toThrow("[pulse:db]");
      expect(prismaHasBeenConstructed()).toBe(false);
      leaksNothing(lines.join("\n"));
    } finally {
      log.mockRestore();
      error.mockRestore();
      if (previousUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousUrl;
      }
      if (previousInDev !== undefined) {
        process.env.PULSE_ALLOW_REMOTE_DB_IN_DEV = previousInDev;
      }
    }
  });

  test("NO command-line argument of the routine's own has either hatch's effect", async () => {
    // Every argument the routine accepts, plus the withdrawn interlock's
    // own vocabulary and the generic force shapes: an argument asserting the
    // target is right is the assertion being checked, so none may pass the
    // guard.
    const { code, calls, out } = await runMain({
      databaseUrl: REMOTE,
      argv: [
        "node",
        "rederive-merchant-rules.ts",
        "--household",
        "h1",
        "--dry-run",
        "--accept",
        "r1",
        "--accept-loss",
        "r1:t1",
        "--expect-host",
        REMOTE_HOST,
        "--expect-ref",
        REMOTE_REF,
        "--expect-port",
        "6543",
        "--allow-remote",
        "1",
        "--force",
      ],
    });
    expect(code).toBe(3);
    expect(calls).toEqual([]);
    leaksNothing(out);
  });
});

describe("THE WITHDRAWAL IS COMPLETE (decision D-62): the four paths are gone and the register exports resolve nowhere", () => {
  test("the four withdrawn modules do not exist", () => {
    for (const name of [
      "target-guard.ts",
      "runtime-target.ts",
      "gate-target.ts",
      "connection-string.ts",
    ]) {
      expect(
        existsSync(join(projectRoot, "src", "platform", "db", name)),
        `src/platform/db/${name} should not exist`,
      ).toBe(false);
    }
  });

  test("no module under src, scripts or test exports the register's two names", () => {
    // The names are assembled so this file's own source cannot satisfy the
    // scan it performs.
    const registerExports = ["noteInterlock" + "Approved", "approved" + "Connection"];
    const offenders: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) {
          if (entry === "node_modules" || entry === ".next") {
            continue;
          }
          walk(path);
        } else if (/\.(ts|tsx|mts|mjs)$/.test(entry)) {
          const source = readFileSync(path, "utf-8");
          for (const name of registerExports) {
            if (new RegExp(`export[^\\n]*\\b${name}\\b`).test(source)) {
              offenders.push(`${path}: ${name}`);
            }
          }
        }
      }
    };
    walk(join(projectRoot, "src"));
    walk(join(projectRoot, "scripts"));
    walk(join(projectRoot, "test"));
    expect(offenders).toEqual([]);
  });
});
