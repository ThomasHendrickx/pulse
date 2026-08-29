import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  assessDestructiveDbTarget,
  assessNonProductionDbTarget,
} from "../../src/platform/db/guard";
import { resolveDbEnv } from "../../src/platform/db/resolve-env";

// Fix round 1, finding CR-002 (hazard verdict): destructive db scripts must
// refuse to run unless the resolved target is the local stack. The pure
// assessment is tested directly; the process-level tests prove the CLI the
// npm scripts actually call exits nonzero on a foreign target, so the
// wiring, not only the function, is what is guarded.

const FOREIGN_POOLER =
  "postgresql://user:secret@aws-1-eu-north-1.pooler.supabase.com:6543/postgres";
const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("assessDestructiveDbTarget", () => {
  test("refuses a foreign DATABASE_URL even when DIRECT_URL is local", () => {
    const verdict = assessDestructiveDbTarget({
      DATABASE_URL: FOREIGN_POOLER,
      DIRECT_URL: LOCAL,
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      // THE ASSERTION ON THE HOSTNAME IS INVERTED (M3-P12 interlock
      // withdrawal, criterion 12.23 measurement FIVE, finding R2-M0P14-02).
      // This test used to assert the resolved hostname INTO the refusal
      // reason; the reason now names the VARIABLE only, because this
      // repository is public, so the hostname must be absent.
      expect(verdict.reason).toContain("DATABASE_URL");
      expect(verdict.reason).not.toContain(
        "aws-1-eu-north-1.pooler.supabase.com",
      );
      expect(verdict.reason).not.toContain("secret");
    }
  });

  test("refuses a foreign DIRECT_URL even when DATABASE_URL is local", () => {
    const verdict = assessDestructiveDbTarget({
      DATABASE_URL: LOCAL,
      DIRECT_URL: FOREIGN_POOLER,
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toContain("DIRECT_URL");
    }
  });

  test("refuses when a connection string is missing (fail closed, no guessing)", () => {
    expect(assessDestructiveDbTarget({}).allowed).toBe(false);
    expect(
      assessDestructiveDbTarget({ DATABASE_URL: LOCAL }).allowed,
    ).toBe(false);
  });

  test("refuses an unparseable connection string", () => {
    const verdict = assessDestructiveDbTarget({
      DATABASE_URL: "not a url at all",
      DIRECT_URL: LOCAL,
    });
    expect(verdict.allowed).toBe(false);
  });

  test("allows 127.0.0.1, localhost and ::1 targets", () => {
    expect(
      assessDestructiveDbTarget({ DATABASE_URL: LOCAL, DIRECT_URL: LOCAL })
        .allowed,
    ).toBe(true);
    expect(
      assessDestructiveDbTarget({
        DATABASE_URL: "postgresql://postgres:postgres@localhost:54322/postgres",
        DIRECT_URL: "postgresql://postgres:postgres@[::1]:54322/postgres",
      }).allowed,
    ).toBe(true);
  });

  test("allows a remote target only under the explicit override variable", () => {
    const verdict = assessDestructiveDbTarget({
      DATABASE_URL: FOREIGN_POOLER,
      DIRECT_URL: FOREIGN_POOLER,
      PULSE_ALLOW_REMOTE_DB_DESTRUCTION: "1",
    });
    expect(verdict.allowed).toBe(true);
  });
});

describe("guard-cli process wiring", () => {
  const projectRoot = join(__dirname, "..", "..");
  const tsxBin = join(projectRoot, "node_modules", ".bin", "tsx");
  const cli = join(projectRoot, "src", "platform", "db", "guard-cli.ts");

  const runCli = (extraEnv: Record<string, string>) => {
    const env: Record<string, string | undefined> = {
      ...process.env,
      PULSE_ALLOW_REMOTE_DB_DESTRUCTION: undefined,
      ...extraEnv,
    };
    return spawnSync(tsxBin, [cli], { env: env as NodeJS.ProcessEnv, cwd: projectRoot, encoding: "utf-8" });
  };

  test("exits nonzero when the environment points at a foreign host", () => {
    const result = runCli({
      DATABASE_URL: FOREIGN_POOLER,
      DIRECT_URL: FOREIGN_POOLER,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("refusing");
  });

  test("exits zero when the environment points at the local stack", () => {
    const result = runCli({ DATABASE_URL: LOCAL, DIRECT_URL: LOCAL });
    expect(result.status).toBe(0);
  });
});

// M3-P12 FIX ROUND FOUR, CRITERIA finding CR4-M3P12-01.
//
// src/platform/db/resolve-env.ts used to claim, as a present-tense fact about
// another program, that the Prisma CLI falls back to .env for a variable the
// shell carries as the EMPTY STRING. It does not. Criterion 12.23 repeats the
// same sentence, and the criterion's word "decorative" rests on it, so the
// asymmetry is pinned here rather than left as a corrected paragraph nothing
// checks. Both halves are executed: what the CLI does, and what this tree's
// resolver does.
describe("the guard's reading and the Prisma CLI's differ on the EMPTY case, and the guard is the stricter one", () => {
  const projectRoot = join(__dirname, "..", "..");
  const LOCAL_FROM_DOT_ENV =
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

  // A throwaway package root: its own schema and its own .env, so nothing
  // here depends on whether this checkout has a .env or what is in it.
  const scratch = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "pulse-env-asymmetry-"));
    writeFileSync(
      join(dir, "schema.prisma"),
      [
        "generator client {",
        '  provider = "prisma-client-js"',
        "}",
        "datasource db {",
        '  provider = "postgresql"',
        '  url      = env("DATABASE_URL")',
        '  directUrl = env("DIRECT_URL")',
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, ".env"),
      `DATABASE_URL="${LOCAL_FROM_DOT_ENV}"\nDIRECT_URL="${LOCAL_FROM_DOT_ENV}"\n`,
    );
    return dir;
  };

  const validate = (overrides: Record<string, string | undefined>) => {
    const dir = scratch();
    const env: Record<string, string | undefined> = {
      ...process.env,
      DATABASE_URL: undefined,
      DIRECT_URL: undefined,
      ...overrides,
    };
    return spawnSync(
      join(projectRoot, "node_modules", ".bin", "prisma"),
      ["validate", "--schema", join(dir, "schema.prisma")],
      { env: env as NodeJS.ProcessEnv, cwd: dir, encoding: "utf-8" },
    );
  };

  test("THE CLI: an ABSENT variable falls back to .env, which is the half that is true", () => {
    const result = validate({});
    expect(result.status).toBe(0);
  });

  test("THE CLI: a shell-EMPTY variable does NOT fall back; it aborts. This is the sentence that was false", () => {
    const result = validate({ DATABASE_URL: "" });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("empty string");
  });

  test("THE GUARD: a shell-EMPTY variable IS treated as absent, so it falls back where the CLI aborts", () => {
    const dir = scratch();
    const previousCwd = process.cwd();
    const previous = process.env["DATABASE_URL"];
    try {
      process.chdir(dir);
      process.env["DATABASE_URL"] = "";
      expect(resolveDbEnv("DATABASE_URL")).toBe(LOCAL_FROM_DOT_ENV);
      delete process.env["DATABASE_URL"];
      expect(resolveDbEnv("DATABASE_URL")).toBe(LOCAL_FROM_DOT_ENV);
    } finally {
      process.chdir(previousCwd);
      if (previous === undefined) {
        delete process.env["DATABASE_URL"];
      } else {
        process.env["DATABASE_URL"] = previous;
      }
    }
  });

  // WHICH .env, PINNED (fix round nine, CRITERIA finding CR7-M3P12-06). Every
  // comment in src/platform/db/ used to say "the .env file at the package
  // root" while readDotEnvValue joins process.cwd(). The two are the same only
  // when the command is invoked from the package root. This test states which
  // of the two the code means, so the corrected comments are a checked claim
  // rather than a second sentence nothing verifies.
  test("THE LOCATION IS THE WORKING DIRECTORY: a subdirectory finds nothing and refuses, it does not climb to a package root", () => {
    const dir = scratch();
    const nested = join(dir, "nested");
    mkdirSync(nested);
    const previousCwd = process.cwd();
    const previous = process.env["DATABASE_URL"];
    try {
      delete process.env["DATABASE_URL"];

      // THE CONTROL: from the directory that HOLDS the .env, the value is
      // found. Without this the refusal below could be a broken reader.
      process.chdir(dir);
      expect(resolveDbEnv("DATABASE_URL")).toBe(LOCAL_FROM_DOT_ENV);

      // AND ONE LEVEL DOWN: nothing. The reader does not climb, so the guard
      // finds no target and its caller refuses. That is a round trip, not a
      // run against a database nobody named.
      process.chdir(nested);
      expect(resolveDbEnv("DATABASE_URL")).toBeUndefined();
    } finally {
      process.chdir(previousCwd);
      if (previous === undefined) {
        delete process.env["DATABASE_URL"];
      } else {
        process.env["DATABASE_URL"] = previous;
      }
    }
  });

  // AND THE COMMENTS SAY THE SAME THING THE TEST DOES. A corrected sentence
  // that drifts back is the shape clause R-087 exists for, so the wording is
  // pinned rather than trusted.
  // gate-target.ts left this list with the withdrawn target interlock
  // (decision D-62, criterion 12.23); the two files that remain are the ones
  // that still read the .env location.
  test("no comment in the database platform directory still says the reader looks at the package root", () => {
    const dbDir = join(__dirname, "..", "..", "src", "platform", "db");
    for (const name of ["resolve-env.ts", "guard-cli.ts"]) {
      const source = readFileSync(join(dbDir, name), "utf-8");
      // The phrase survives only where it is QUOTED as the old, false
      // wording, which is how clause R-087 requires a correction to be
      // written. A line carrying it unquoted is a live claim again.
      const claims = source
        .split("\n")
        .filter((line) => /\.env file at the package root/.test(line))
        .filter((line) => !line.includes('"'));
      expect(claims).toEqual([]);
    }
  });

  // WHY THE DIVERGENCE IS SAFE, executed rather than argued. The divergence
  // exists only for a shell-EMPTY value, and in that case the command the
  // guard protects aborts before opening anything. So the guard either
  // approves a target the command never reaches, or refuses and the command
  // never runs. It is stricter than its subject in both directions, which is
  // the only direction a fail-closed interlock may err in.
  test("THE CONSEQUENCE: the empty case can only make the guard refuse a run the CLI would have aborted anyway", () => {
    const foreign =
      "postgresql://postgres.aaaabbbbccccddddeeee:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
    // What the guard sees when the shell carries empty and .env carries a
    // foreign target: it resolves the .env value and REFUSES.
    expect(
      assessDestructiveDbTarget({ DATABASE_URL: foreign, DIRECT_URL: foreign })
        .allowed,
    ).toBe(false);
    // And the empty string itself is refused outright, never read as a host.
    expect(
      assessDestructiveDbTarget({ DATABASE_URL: "", DIRECT_URL: "" }).allowed,
    ).toBe(false);
  });
});

// M3-P12 FIX ROUND FIVE, HAZARD finding HAZ5-3.
//
// The work history used to rest an open question on "the deployed app must
// open a deployed database, so a local-only refusal would be wrong". True of
// `next start`, false of `next dev`, and the conflation left the live gap
// open: in a fleet container the ambient DATABASE_URL is a DEPLOYED project
// with a working password, and `npm run dev` opened it with no refusal.
//
// The predicate is tested here rather than through a real dev server, which
// the fast gate cannot start. Every connection string is INVENTED.
describe("a non-production server may not open a deployed database", () => {
  const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  const REMOTE =
    "postgresql://postgres.aaaabbbbccccddddeeee:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";

  test("THE LIVE GAP: a development server pointed at a deployed host is refused", () => {
    const verdict = assessNonProductionDbTarget({
      NODE_ENV: "development",
      DATABASE_URL: REMOTE,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("not production");
  });

  // WHAT THIS TEST USED TO ASSERT, AND WHY THAT WAS THE DEFECT (fix round ten,
  // HAZARD finding CR9-M3P12-HZ-01). It was titled "PRODUCTION, TESTS AND
  // SCRIPTS ARE UNTOUCHED, which is what makes this safe to ship", and it
  // asserted allowed for NODE_ENV of production, test and undefined against a
  // DEPLOYED connection string. Two of those three were the only contexts this
  // module was ever actually reached by: one npm test run constructed the
  // application client from thirteen distinct test files, and the
  // re-derivation script constructed it before its own interlock spoke. The
  // guard was inert exactly where it was needed and the test pinned it that
  // way, which is why nothing went red for five rounds.
  //
  // It is replaced rather than deleted, and the replacement asserts the
  // opposite for two of the three.
  test("PRODUCTION IS UNTOUCHED, and every other context is refused a deployed target", () => {
    expect(
      assessNonProductionDbTarget({
        NODE_ENV: "production",
        DATABASE_URL: REMOTE,
      }).allowed,
    ).toBe(true);
    for (const NODE_ENV of ["development", "test", undefined]) {
      expect(
        assessNonProductionDbTarget({ NODE_ENV, DATABASE_URL: REMOTE }).allowed,
      ).toBe(false);
    }
  });

  // THE INTERLOCK-APPROVAL CASES THAT STOOD HERE ARE WITHDRAWN, loudly
  // (clause R-087, decision D-62, criterion 12.23). They witnessed the
  // approval-register branch of this predicate, the pair recorded by the
  // re-derivation command's host-and-ref interlock and honoured here; that
  // branch, the register (src/platform/db/runtime-target.ts) and the
  // interlock itself left the tree together. What replaces the admitted
  // path is a per-run hatch pair the deployed run sets inline (M3-P16), and
  // the environment-only refusal below is what remains of these cases.
  test("a deployed target with NOTHING set is refused: no in-process record can admit one any more", () => {
    expect(
      assessNonProductionDbTarget({ NODE_ENV: undefined, DATABASE_URL: REMOTE })
        .allowed,
    ).toBe(false);
  });

  // THE FAST GATE IS NOT MADE TO REFUSE, and this is the cost the old narrow
  // predicate was protecting against. It is answered by the client being LAZY
  // rather than by the guard being inert: a run that issues no query
  // constructs no client, so the predicate is never consulted. The
  // behavioural witness is the import-constructs-nothing test at the bottom
  // of this file (the startup-line count over a whole fast-gate run left
  // with the withdrawn test/db/gate-target.test.ts, decision D-62); here we
  // only pin that the predicate itself WOULD refuse, so the two halves
  // cannot both drift.
  test("under vitest the predicate refuses a deployed target, so laziness is what keeps the gate green", () => {
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(
      assessNonProductionDbTarget({
        NODE_ENV: process.env.NODE_ENV,
        DATABASE_URL: REMOTE,
      }).allowed,
    ).toBe(false);
  });

  test("a development server on the local stack proceeds", () => {
    expect(
      assessNonProductionDbTarget({ NODE_ENV: "development", DATABASE_URL: LOCAL })
        .allowed,
    ).toBe(true);
  });

  test("an unparseable value is refused rather than read as a host", () => {
    expect(
      assessNonProductionDbTarget({ NODE_ENV: "development", DATABASE_URL: "not-a-url" })
        .allowed,
    ).toBe(false);
  });

  test("an ABSENT value is left to the client's own error, which is more precise", () => {
    expect(assessNonProductionDbTarget({ NODE_ENV: "development" }).allowed).toBe(true);
  });

  test("the escape hatch is one variable, set per run, and it is the only way through", () => {
    expect(
      assessNonProductionDbTarget({
        NODE_ENV: "development",
        DATABASE_URL: REMOTE,
        PULSE_ALLOW_REMOTE_DB_IN_DEV: "1",
      }).allowed,
    ).toBe(true);
    // Not any truthy value: the destructive guard beside it uses the same
    // literal, and a guard that takes "0" or "false" as consent is a joke.
    expect(
      assessNonProductionDbTarget({
        NODE_ENV: "development",
        DATABASE_URL: REMOTE,
        PULSE_ALLOW_REMOTE_DB_IN_DEV: "false",
      }).allowed,
    ).toBe(false);
  });

  test("NO VALUE IS EVER PRINTED: this repository is public", () => {
    const verdict = assessNonProductionDbTarget({
      NODE_ENV: "development",
      DATABASE_URL: REMOTE,
    });
    expect(verdict.reason).not.toContain("pooler.supabase.com");
    expect(verdict.reason).not.toContain("aaaabbbbccccddddeeee");
  });

  test("the client asks it BEFORE it constructs, so a refused process opens nothing", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "platform", "db", "client.ts"),
      "utf-8",
    );
    expect(source).toContain("assessNonProductionDbTarget");
    // Inside constructClient, the assertion call precedes the construction.
    // The CODE forms are matched, not the prose: this file's own header
    // discusses `new PrismaClient()` above the function, which is exactly the
    // shape of mention that fooled the door scan for five rounds.
    expect(source.search(/^\s*assertTargetAllowed\(\);$/m)).toBeGreaterThan(-1);
    expect(source.search(/^\s*return new PrismaClient\(\);$/m)).toBeGreaterThan(
      -1,
    );
    expect(source.search(/^\s*assertTargetAllowed\(\);$/m)).toBeLessThan(
      source.search(/^\s*return new PrismaClient\(\);$/m),
    );
  });

  // AND THE MODULE CONSTRUCTS NOTHING AT IMPORT, WITNESSED BY IMPORTING IT.
  // This is the behavioural half and it is the one that matters: under vitest
  // NODE_ENV is "test" and this container's ambient DATABASE_URL is a deployed
  // pooler, so against the EAGER client this import both constructed a client
  // and, with the widened predicate, threw. It now does neither.
  //
  // Measured before and after on the same tree: the eager module printed its
  // own startup line 18 times in one `npm test` run, from thirteen distinct
  // files; the lazy module prints it 0 times.
  test("importing the application client constructs NOTHING, so no test opens a target nobody named", async () => {
    // The trap-touching half below CONSTRUCTS, so the target is pinned to an
    // INVENTED local value first. Without it this test measures the ambient
    // environment rather than the module.
    const env = process.env as Record<string, string | undefined>;
    const previous = env["DATABASE_URL"];
    env["DATABASE_URL"] = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
    try {
    const clientModule = await import("../../src/platform/db/client");
    expect(clientModule.prismaHasBeenConstructed()).toBe(false);
    // AND THE BINDING IS STILL USABLE, asserted by something that TOUCHES the
    // proxy (fix round twelve, HAZARD finding HZ11-M3P12-07). This used to
    // read `typeof clientModule.prisma`, which is answered by the proxy's
    // TARGET and invokes no trap at all: the target is an empty object
    // literal, so the assertion was a statement about `{}` and passed in a
    // process where every real property access throws. Reading a property
    // goes through the trap, so it proves both halves at once, that the module
    // loaded and that the lazy binding resolves. The target here is the local
    // one pinned in beforeEach.
    expect("account" in clientModule.prisma).toBe(true);
    expect(clientModule.prismaHasBeenConstructed()).toBe(true);
    } finally {
      if (previous === undefined) {
        delete env["DATABASE_URL"];
      } else {
        env["DATABASE_URL"] = previous;
      }
    }
  });

  // The source-level half, kept beside it so a refactor that reintroduces a
  // module-scope constructor is red twice.
  test("the client module constructs NOTHING at module scope", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "platform", "db", "client.ts"),
      "utf-8",
    );
    const topLevel = source
      .split("\n")
      .filter((line) => /^\S/.test(line) && !line.startsWith("//"));
    expect(topLevel.some((line) => line.includes("new PrismaClient("))).toBe(
      false,
    );
    expect(source).toContain("const constructClient");
  });
});
