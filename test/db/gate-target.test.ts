import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  assertGateApiTargetIsLocal,
  assertGateDbTargetIsLocal,
  assessGateDbTarget,
  enforceGateDbTarget,
  gateDbCandidates,
  GateDbTargetRefused,
  type GateDbCandidate,
} from "../../src/platform/db/gate-target";

// M3-P12 FIX ROUND FOUR, CRITERIA finding CR4-M3P12-02.
//
// THE RULE UNDER TEST: no test, no script and no gate in this repository may
// open a database nobody named.
//
// Every connection string below is INVENTED. The local ones name the port the
// local Supabase Postgres uses and the password is the literal word; the
// remote ones are hand-typed letter runs in the shape of a pooler host, and
// none of them is or resembles a real project.

const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const LOCAL_ALT = "postgresql://postgres:postgres@localhost:54322/postgres";
const LOCAL_API = "http://127.0.0.1:54321";
const REMOTE =
  "postgresql://postgres.aaaabbbbccccddddeeee:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";
const REMOTE_API = "https://aaaabbbbccccddddeeee.supabase.co";

const named = (
  source: string,
  values: GateDbCandidate["values"],
): GateDbCandidate => ({ source, values });

const localValues = {
  DATABASE_URL: LOCAL,
  DIRECT_URL: LOCAL,
  NEXT_PUBLIC_SUPABASE_URL: LOCAL_API,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "invented-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "invented-service-key",
};

describe("the gate's target must be named, and must be local", () => {
  test("THE CONTROL: a source that names a complete local stack is allowed, so the refusals below are refusals", () => {
    const verdict = assessGateDbTarget([named("the test", localValues)]);
    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) {
      expect(verdict.pinned.DATABASE_URL).toBe(LOCAL);
      expect(verdict.pinned.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("invented-anon-key");
      expect(verdict.source).toBe("the test");
    }
  });

  test("NOBODY NAMED ONE: an empty candidate list refuses rather than defaulting", () => {
    expect(assessGateDbTarget([]).allowed).toBe(false);
  });

  test("every source silent on DATABASE_URL refuses; a candidate is not completed from another", () => {
    expect(
      assessGateDbTarget([
        named("first", {}),
        named("second", { DIRECT_URL: LOCAL, NEXT_PUBLIC_SUPABASE_URL: LOCAL_API }),
      ]).allowed,
    ).toBe(false);
  });

  // THE WITNESSED HOLE ITSELF. Before this round the Playwright gate opened
  // whatever DATABASE_URL the container carried, and in this fleet that is a
  // deployed pooler belonging to a different project with a working password.
  test("A DEPLOYED TARGET IS REFUSED, and there is no flag that changes that", () => {
    const verdict = assessGateDbTarget([
      named("a shell", { ...localValues, DATABASE_URL: REMOTE }),
    ]);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("DATABASE_URL");
  });

  test("a deployed DIRECT_URL beside a local DATABASE_URL is refused too", () => {
    expect(
      assessGateDbTarget([named("a shell", { ...localValues, DIRECT_URL: REMOTE })])
        .allowed,
    ).toBe(false);
  });

  test("a deployed SUPABASE URL beside a local database is refused: an API is a door to a database", () => {
    expect(
      assessGateDbTarget([
        named("a shell", { ...localValues, NEXT_PUBLIC_SUPABASE_URL: REMOTE_API }),
      ]).allowed,
    ).toBe(false);
  });

  test("a HALF-NAMED target is refused rather than completed from the environment", () => {
    for (const missing of [
      "DIRECT_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
    ] as const) {
      const values = { ...localValues, [missing]: undefined };
      const verdict = assessGateDbTarget([named("a shell", values)]);
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toContain(missing);
    }
  });

  test("an empty string is not a name", () => {
    expect(
      assessGateDbTarget([named("a shell", { ...localValues, DATABASE_URL: "   " })])
        .allowed,
    ).toBe(false);
  });

  // CRITERIA finding CR5-M3P12-03. The sibling interlock has refused a host
  // query parameter by name since fix round three, with a witness recorded
  // above it, and this one read the hostname and nothing else. A string whose
  // authority is the local stack and whose query redirects the connector was
  // approved here and refused one module over.
  test("A HOST QUERY PARAMETER is refused, though the authority IS the local stack", () => {
    const redirected = `${LOCAL}?host=/tmp/not-a-socket-dir`;
    expect(new URL(redirected).hostname).toBe(new URL(LOCAL).hostname);
    expect(
      assessGateDbTarget([named("a shell", { ...localValues, DATABASE_URL: LOCAL })])
        .allowed,
    ).toBe(true);
    expect(
      assessGateDbTarget([
        named("a shell", { ...localValues, DATABASE_URL: redirected }),
      ]).allowed,
    ).toBe(false);
  });

  test("the SAME parameter rules apply to DIRECT_URL, and to nothing that is not a connection string", () => {
    expect(
      assessGateDbTarget([
        named("a shell", { ...localValues, DIRECT_URL: `${LOCAL}?options=-c` }),
      ]).allowed,
    ).toBe(false);
    expect(
      assessGateDbTarget([
        named("a shell", { ...localValues, DATABASE_URL: `${LOCAL}?schema=someone_else` }),
      ]).allowed,
    ).toBe(false);
    // The Supabase API URL is an http URL: a connector's parameters mean
    // nothing there, so its query is not policed and its host still is.
    expect(
      assessGateDbTarget([
        named("a shell", {
          ...localValues,
          NEXT_PUBLIC_SUPABASE_URL: `${LOCAL_API}?anything=1`,
        }),
      ]).allowed,
    ).toBe(true);
  });

  test("the spec-facing assertion refuses the same redirect", () => {
    expect(() =>
      assertGateDbTargetIsLocal({ DATABASE_URL: `${LOCAL}?host=/tmp/x` }),
    ).toThrow(GateDbTargetRefused);
  });

  test("an unparseable value refuses rather than being read as a host", () => {
    expect(
      assessGateDbTarget([
        named("a shell", { ...localValues, DATABASE_URL: "not-a-url" }),
      ]).allowed,
    ).toBe(false);
  });

  test("the loopback names the destructive guard accepts are the names this one accepts", () => {
    expect(
      assessGateDbTarget([
        named("a shell", { ...localValues, DATABASE_URL: LOCAL_ALT, DIRECT_URL: LOCAL_ALT }),
      ]).allowed,
    ).toBe(true);
  });

  // THE ORDER IS A DECISION AND FAILING THROUGH IT WOULD BE A HOLE. A source
  // that names a target has DECIDED the target; if what it named is wrong the
  // run is refused, not silently handed to the next source.
  test("THE FIRST SOURCE THAT NAMES A DATABASE DECIDES, and a wrong name refuses instead of falling through", () => {
    const verdict = assessGateDbTarget([
      named("the deliberate pin", { ...localValues, DATABASE_URL: REMOTE }),
      named("the .env file", localValues),
    ]);
    expect(verdict.allowed).toBe(false);
  });

  test("a source that names NOTHING is skipped, so the next source decides", () => {
    const verdict = assessGateDbTarget([
      named("the deliberate pin", {}),
      named("the .env file", localValues),
    ]);
    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) {
      expect(verdict.source).toBe("the .env file");
    }
  });

  // CRITERIA finding CR5-M3P12-07. The keys travelled only where the naming
  // source carried them, so a PULSE_GATE_* pin naming the three endpoints
  // left an ambient, possibly foreign, key beside them, which is the mixture
  // the module's own comment says it prevents.
  test("A NAME THE SOURCE DOES NOT CARRY IS REMOVED, not left ambient", () => {
    const env: Record<string, string | undefined> = {
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "an-ambient-key-from-somewhere-else",
      SUPABASE_SERVICE_ROLE_KEY: "an-ambient-service-key",
      PULSE_GATE_DATABASE_URL: LOCAL,
      PULSE_GATE_SUPABASE_URL: LOCAL_API,
    };
    enforceGateDbTarget(env);
    expect(env["DATABASE_URL"]).toBe(LOCAL);
    expect(env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]).toBeUndefined();
    expect(env["SUPABASE_SERVICE_ROLE_KEY"]).toBeUndefined();
  });

  test("NO VALUE IS EVER PRINTED: this repository is public", () => {
    const verdict = assessGateDbTarget([
      named("a shell", { ...localValues, DATABASE_URL: REMOTE }),
    ]);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).not.toContain("pooler.supabase.com");
    expect(verdict.reason).not.toContain("aaaabbbbccccddddeeee");
    expect(verdict.reason).not.toContain("pw");
  });
});

describe("the ambient DATABASE_URL is not a source", () => {
  // THE POINT OF THE WHOLE FILE. The variable this fleet's containers carry
  // is exactly the variable nobody named for this purpose, so the resolver
  // does not consult it. It is OVERWRITTEN instead.
  test("a container carrying a deployed DATABASE_URL contributes no candidate", () => {
    const candidates = gateDbCandidates(
      { DATABASE_URL: REMOTE, DIRECT_URL: REMOTE, NEXT_PUBLIC_SUPABASE_URL: REMOTE_API },
      () => undefined,
    );
    for (const candidate of candidates) {
      expect(candidate.values.DATABASE_URL).toBeUndefined();
    }
    expect(assessGateDbTarget(candidates).allowed).toBe(false);
  });

  test("the PULSE_GATE_* names are consulted, and they are the ones that exist only to name this", () => {
    const candidates = gateDbCandidates(
      {
        DATABASE_URL: REMOTE,
        PULSE_GATE_DATABASE_URL: LOCAL,
        PULSE_GATE_SUPABASE_URL: LOCAL_API,
      },
      () => undefined,
    );
    const verdict = assessGateDbTarget(candidates);
    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) {
      expect(verdict.pinned.DATABASE_URL).toBe(LOCAL);
      // DIRECT_URL falls back to the same pin rather than to the ambient one.
      expect(verdict.pinned.DIRECT_URL).toBe(LOCAL);
    }
  });

  test("the .env file is read directly, not through a loader that declines to override", () => {
    const fromDotEnv = (name: string): string | undefined =>
      ({
        DATABASE_URL: LOCAL,
        DIRECT_URL: LOCAL,
        NEXT_PUBLIC_SUPABASE_URL: LOCAL_API,
      })[name];
    const verdict = assessGateDbTarget(
      gateDbCandidates({ DATABASE_URL: REMOTE }, fromDotEnv),
    );
    expect(verdict.allowed).toBe(true);
  });
});

describe("enforcement: the refusal aborts, and the approval OVERWRITES", () => {
  test("a refused target THROWS, which is what aborts a run before a server starts", () => {
    expect(() =>
      enforceGateDbTarget({ PULSE_GATE_DATABASE_URL: REMOTE }),
    ).toThrow(GateDbTargetRefused);
  });

  // THE ASSERTION THAT FAILS A CONFIG THAT ONLY CHECKS. Next's loader does not
  // override a shell variable, so reading .env and leaving process.env alone
  // is not a pin: the servers and the workers would still open the ambient
  // target. This is what makes the pin real.
  test("an approved target REPLACES a deployed value the environment already carried", () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: REMOTE,
      DIRECT_URL: REMOTE,
      NEXT_PUBLIC_SUPABASE_URL: REMOTE_API,
      PULSE_GATE_DATABASE_URL: LOCAL,
      PULSE_GATE_SUPABASE_URL: LOCAL_API,
    };
    enforceGateDbTarget(env);
    expect(env["DATABASE_URL"]).toBe(LOCAL);
    expect(env["DIRECT_URL"]).toBe(LOCAL);
    expect(env["NEXT_PUBLIC_SUPABASE_URL"]).toBe(LOCAL_API);
  });
});

describe("a test that opens a client of its own refuses for itself", () => {
  test("it reads DATABASE_URL, which is exactly what new PrismaClient() reads", () => {
    expect(() => assertGateDbTargetIsLocal({ DATABASE_URL: LOCAL })).not.toThrow();
    expect(() => assertGateDbTargetIsLocal({ DATABASE_URL: REMOTE })).toThrow(
      GateDbTargetRefused,
    );
    expect(() => assertGateDbTargetIsLocal({})).toThrow(GateDbTargetRefused);
  });

  // THE CALLERS STOPPED BEING ONLY TESTS in fix round eight, so the refusal
  // stopped saying "this test". A refusal that misnames its cause sends the
  // reader looking in the wrong file.
  test("the refusal NAMES ITS CALLER, and still names a test when nobody says otherwise", () => {
    expect(() =>
      assertGateDbTargetIsLocal({ DATABASE_URL: REMOTE }, "prisma/seed.ts"),
    ).toThrow(/prisma\/seed\.ts opens a database client of its own/);
    expect(() =>
      assertGateApiTargetIsLocal({ NEXT_PUBLIC_SUPABASE_URL: REMOTE_API }, "prisma/seed.ts"),
    ).toThrow(/prisma\/seed\.ts opens a Supabase admin client of its own/);
    expect(() => assertGateDbTargetIsLocal({ DATABASE_URL: REMOTE })).toThrow(
      /this test opens a database client of its own/,
    );
  });

  // AND THE VALUE IS STILL NEVER PRINTED, on the path that now interpolates.
  test("naming the caller did not start printing the target", () => {
    for (const opener of ["prisma/seed.ts", "this test"]) {
      try {
        assertGateDbTargetIsLocal({ DATABASE_URL: REMOTE }, opener);
        throw new Error("expected a refusal");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain(REMOTE);
        expect(message).not.toContain("pooler.supabase.com");
      }
      try {
        assertGateApiTargetIsLocal({ NEXT_PUBLIC_SUPABASE_URL: REMOTE_API }, opener);
        throw new Error("expected a refusal");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain(REMOTE_API);
      }
    }
  });
});

// THE WIRING, pinned in the source. A predicate nothing calls is the same
// hole with a test suite in front of it, and the two call sites are in files
// no other test reads: the Playwright config and one spec.
describe("the mechanism is actually installed", () => {
  const projectRoot = join(__dirname, "..", "..");
  const read = (...parts: string[]): string =>
    readFileSync(join(projectRoot, ...parts), "utf-8");

  test("playwright.config.ts enforces the target at MODULE SCOPE, before any server or worker", () => {
    const config = read("playwright.config.ts");
    expect(config).toContain('from "./src/platform/db/gate-target"');
    expect(config).toContain("enforceGateDbTarget()");
    // Ahead of the webServer block, which is what makes it early enough.
    expect(config.indexOf("enforceGateDbTarget()")).toBeLessThan(
      config.indexOf("webServer"),
    );
    // And the pinned values reach both servers rather than only process.env.
    expect(config.split("...gateDb").length - 1).toBe(2);
  });

  test("the one spec that opens a client of its own refuses for itself and skips in deploy-verify", () => {
    const spec = read("test", "e2e", "merchant-rule-write.spec.ts");
    expect(spec).toContain("assertGateDbTargetIsLocal()");
    expect(spec).toContain("PLAYWRIGHT_BASE_URL");
    expect(spec).toContain("test.skip(");
  });

  test("the one spec that opens a Prisma client guards before it writes", () => {
    const spec = read("test", "e2e", "merchant-rule-write.spec.ts");
    expect(spec).toContain("new PrismaClient()");
    expect(
      spec.indexOf("assertGateDbTargetIsLocal") < spec.indexOf("prisma.household.create"),
    ).toBe(true);
  });

  // THE STANDING ANSWER to "can anything still reach a database nobody
  // named".
  //
  // ITS DENOMINATOR IS NOW A DEFINITION AND NOT A LOCATION (fix round eight,
  // CRITERIA finding CR7-M3P12-01). It used to walk two hard-coded roots,
  // test/ and scripts/, while its title claimed EVERY door. THAT CLAIM WAS
  // FALSE THE DAY IT SHIPPED, and this comment says so in place rather than
  // deleting the sentence (clause R-087): prisma/seed.ts opens a Prisma
  // client AND a Supabase service-role admin client, it is older than the
  // scan, it sits one level from the repository root, and the scan never read
  // it. An inclusion list silently excludes everything it does not name, so
  // the walk is replaced by the TRACKED TREE and the exclusions are named
  // out loud below, each with a reason.
  //
  // A door is a FILE THAT CONSTRUCTS A CLIENT, which is an identity, rather
  // than a file that lives where doors have historically been written, which
  // is a shape. Matching the shape is the standing error this repository has
  // now recorded sixteen times.
  const trackedSourceFiles = (): string[] =>
    execFileSync("git", ["ls-files", "-z"], {
      cwd: projectRoot,
      encoding: "utf-8",
      maxBuffer: 32 * 1024 * 1024,
    })
      .split("\0")
      .filter((name) => name !== "" && /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/.test(name));

  // THE EXCLUSIONS, each one a path and a reason. Nothing else is exempt, and
  // a test below refuses an entry that has stopped being a door, so this list
  // cannot quietly grow into a second inclusion list.
  const ALLOWED_UNGUARDED: ReadonlyArray<{
    readonly path: string;
    readonly reason: string;
  }> = [
    {
      path: "src/platform/db/client.ts",
      reason:
        "the APPLICATION's own runtime client, not a gate door: it is the single PrismaClient the Next.js server holds, it is never invoked by a test or a script, and it carries its own interlock instead, assessDevServerDbTarget in ./guard, which refuses a non-production server pointed at a deployed database. Calling the gate interlock here would refuse production, which is the one target this client legitimately opens.",
    },
  ];

  // A SECOND EXCLUSION WAS REMOVED RATHER THAN CARRIED OVER, and this note is
  // here instead of a silent deletion (clause R-087). The two-directory walk
  // skipped test/db/gate-target.test.ts by path, on the stated ground that
  // "this file NAMES both interlocks in order to test them". That ground was
  // already false when it was written: this file names them only inside
  // string literals and comments, both of which codeOnly blanks, so the
  // scanner never saw it as a door and the skip protected nothing. The
  // staleness test below is what surfaced it, which is the point of having a
  // staleness test.

  const codeOnly = (source: string): string =>
    source
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n")
      .replace(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g, '""');

  type Door = {
    readonly path: string;
    readonly kind: "prisma" | "supabase-admin";
    readonly guarded: boolean;
  };

  // PROSE IS NOT A DOOR. This tree talks about `new PrismaClient()` in
  // comments and in test titles more often than it calls it, so the scan
  // reads CODE: line comments are dropped and quoted spans are blanked before
  // the patterns are applied.
  const scanDoors = (): Door[] => {
    const doors: Door[] = [];
    for (const path of trackedSourceFiles()) {
      const raw = readFileSync(join(projectRoot, path), "utf-8");
      const source = codeOnly(raw);
      if (/new\s+PrismaClient\s*\(/.test(source)) {
        doors.push({
          path,
          kind: "prisma",
          guarded: raw.includes("assertGateDbTargetIsLocal"),
        });
      }
      if (
        /SUPABASE_SERVICE_ROLE_KEY/.test(source) &&
        /createClient\s*\(/.test(source)
      ) {
        doors.push({
          path,
          kind: "supabase-admin",
          guarded: raw.includes("assertGateApiTargetIsLocal"),
        });
      }
    }
    return doors;
  };

  test("the scan's denominator is the TRACKED TREE, not a list of directories", () => {
    const files = trackedSourceFiles();
    // The scan is only worth what it reads, so it says how much it read.
    expect(files.length).toBeGreaterThan(100);
    // THE ANCHOR THAT WOULD HAVE FAILED THE OLD DENOMINATOR: a door one level
    // from the repository root, in neither walked directory. If this file
    // stops being read, the scan has narrowed again.
    expect(files).toContain("prisma/seed.ts");
    // And the two roots the old walk knew about are still inside it.
    expect(files.some((name) => name.startsWith("test/"))).toBe(true);
    expect(files.some((name) => name.startsWith("scripts/"))).toBe(true);
  });

  test("EVERY door in the tracked tree is guarded, whatever kind of client opens it and wherever it sits", () => {
    const exempt = new Set(ALLOWED_UNGUARDED.map((entry) => entry.path));
    const unguarded = scanDoors()
      .filter((door) => !door.guarded && !exempt.has(door.path))
      .map((door) => `${door.path} (${door.kind})`);
    expect(unguarded).toEqual([]);
  });

  test("the allow list carries no stale entry: every exemption is still a door", () => {
    const doors = scanDoors();
    for (const entry of ALLOWED_UNGUARDED) {
      expect(entry.reason.length).toBeGreaterThan(60);
      expect(doors.some((door) => door.path === entry.path)).toBe(true);
    }
  });

  test("prisma/seed.ts, the door the old two-directory walk could not see, is guarded on BOTH of its clients", () => {
    const seed = read("prisma", "seed.ts");
    expect(seed).toContain("assertGateDbTargetIsLocal");
    expect(seed).toContain("assertGateApiTargetIsLocal");
    // Order is the whole point: refuse before a client exists.
    expect(seed.indexOf("assertGateDbTargetIsLocal")).toBeLessThan(
      seed.indexOf("new PrismaClient()"),
    );
    expect(seed.indexOf("assertGateApiTargetIsLocal")).toBeLessThan(
      seed.indexOf("createClient("),
    );
  });
});
