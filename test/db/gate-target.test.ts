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

  // BOTH SPECS THAT OPEN A DOOR SKIP IN DEPLOY-VERIFY (fix round nine,
  // CRITERIA finding CR7-M3P12-05). The admin-client spec asserted a local
  // target after a skip that fires only on an ABSENT key, and deploy-verify
  // carries a present deployed one, so the assertion turned a spec that should
  // skip into a red stage. Nothing in the fast gate could see that, so this
  // pins the ordering in the source.
  test("the spec that opens a Supabase admin client skips in deploy-verify BEFORE it asserts a local target", () => {
    const spec = read("test", "e2e", "auth.spec.ts");
    expect(spec).toContain("PLAYWRIGHT_BASE_URL");
    expect(spec.indexOf("PLAYWRIGHT_BASE_URL")).toBeLessThan(
      spec.indexOf("assertGateApiTargetIsLocal()"),
    );
  });

  // THIS TEST READ RAW TEXT TOO, and it is repaired rather than deleted (fix
  // round ten). Its second operand, "prisma.household.create", no longer
  // exists in that spec: the client is constructed in beforeAll behind the
  // assertion, so the writes go through an accessor. The general ordering
  // assertion below now covers what this one was reaching for; what stays here
  // is the file-specific claim, checked against CODE.
  test("the one spec that opens a Prisma client guards before it constructs it", () => {
    const spec = codeOnly(read("test", "e2e", "merchant-rule-write.spec.ts"));
    expect(/\bassertGateDbTargetIsLocal\s*\(/.test(spec)).toBe(true);
    expect(/new\s+PrismaClient\s*\(/.test(spec)).toBe(true);
    expect(spec.search(/\bassertGateDbTargetIsLocal\s*\(/)).toBeLessThan(
      spec.search(/new\s+PrismaClient\s*\(/),
    );
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
  const SOURCE_EXTENSION = /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/;

  const gitFileList = (...args: string[]): string[] =>
    execFileSync("git", args, {
      cwd: projectRoot,
      encoding: "utf-8",
      maxBuffer: 32 * 1024 * 1024,
    })
      .split("\0")
      .filter((name) => name !== "" && SOURCE_EXTENSION.test(name));

  const trackedSourceFiles = (): string[] => gitFileList("ls-files", "-z");

  // THE WORKING TREE, WHICH IS WIDER THAN THE INDEX. --others lists files git
  // does not track and --exclude-standard drops the ignored ones, so
  // node_modules and build output stay out while an operator's unstaged
  // scratch script is read. De-duplicated because a path can legitimately
  // appear in neither list twice but the concatenation is cheap to make safe.
  const scannedSourceFiles = (): string[] => [
    ...new Set([
      ...gitFileList("ls-files", "-z"),
      ...gitFileList("ls-files", "-z", "--others", "--exclude-standard"),
    ]),
  ];

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
        "the APPLICATION's own runtime Prisma client, and the one door that may legitimately open PRODUCTION, which is why it cannot call the gate assertion: that assertion refuses everything that is not the local stack. THE PREVIOUS REASON HERE WAS FALSE IN TWO CLAUSES and is quoted rather than deleted (clause R-087). It said 'No test and no script CONSTRUCTS it', and one npm test run printed this module's own startup line fourteen times from thirteen distinct files while scripts/rederive-merchant-rules.ts constructed it transitively at import, before its own interlock had spoken. It said the module 'carries its own interlock instead, assessDevServerDbTarget', and that predicate returned allowed for every NODE_ENV that is not exactly 'development', so under vitest and under tsx it checked nothing. WHAT IS TRUE NOW, and it is a change to the module rather than to this sentence: construction is LAZY, so importing this module constructs nothing and no test and no script reaches a client by importing an adapter; and the interlock it carries is assessNonProductionDbTarget, which runs AT CONSTRUCTION and refuses a non-local target in every context that is not production unless an in-process interlock has already named and approved that exact target. So the exemption is a different guard rather than no guard, and that is now true of every context rather than only of next dev.",
    },
    {
      path: "src/middleware.ts",
      reason:
        "APPLICATION RUNTIME, an anon-key Supabase client, and not a gate door. It runs only inside the Next.js request path, it carries the ANON key rather than a service-role key, so it reads and writes only what row-level security permits for the signed-in user, and it opens whichever project NEXT_PUBLIC_SUPABASE_URL names, which in production is the deployed project this application is. Under the gate that variable is not ambient: enforceGateDbTarget assigns all five pinned names in playwright.config.ts before either web server starts, so the gate's own runs reach the local stack by a mechanism rather than by luck. Calling the gate assertion here would refuse production, exactly as it would in the Prisma client above.",
    },
    {
      path: "src/platform/auth/supabase-server.ts",
      reason:
        "APPLICATION RUNTIME, the same anon-key server client as the middleware above and exempt for the same reasons: request-scoped, anon key rather than service-role, bound to the project the deployed application IS, and pinned to the local stack under the gate by enforceGateDbTarget rather than by whatever the shell holds. It is listed separately rather than folded into one entry because the staleness test checks each path, so a file that stops being a door is retired on its own.",
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

  // CODE IS NOT TEXT, AND THIS IS THE HALF THE SCAN GOT RIGHT ON ONE SIDE AND
  // WRONG ON THE OTHER (fix round ten, CRITERIA finding CR9-M3P12-01 and
  // HAZARD finding CR9-M3P12-HZ-03).
  //
  // WHAT WAS HERE AND WHY IT WAS FALSE, quoted rather than deleted (clause
  // R-087). The scan decided whether a file IS a door from `codeOnly(raw)`,
  // under a header that said "PROSE IS NOT A DOOR ... the scan reads CODE",
  // and then decided whether that door was GUARDED from `raw.includes(name)`.
  // A mention of the guard's name ANYWHERE satisfied it: an import line, a
  // comment, a string. A reviewer deleted both real assertion CALLS from
  // prisma/seed.ts, left the import and the comment, and the entire fast gate
  // stayed green. The ordering test beside it was worse: both of its indexOf
  // operands resolved to prose, so moving the assertion to AFTER the
  // constructor changed nothing.
  //
  // SO BOTH SIDES NOW READ THE SAME CODE-ONLY TEXT, and the guarded side
  // requires a CALL rather than a mention. The stripper is a one-pass scanner
  // over the source's own lexical states rather than a stack of regexes,
  // because the two failure directions are opposite and a regex cannot be
  // safe in both: over-stripping HIDES A DOOR, under-stripping INVENTS A
  // GUARD, and the old line-comments-then-quotes ordering could do either
  // depending on which construct nested inside which.
  //
  // IT ALSO STRIPS BLOCK COMMENTS, which the old one never did, so the same
  // trick with /* */ no longer works on either side.
  //
  // Positions are preserved: every stripped character is replaced by a space
  // rather than removed, so an index into the code-only text is an index into
  // the original file and the ordering assertion below means what it says.
  const codeOnly = (source: string): string => {
    const out: string[] = [];
    let i = 0;
    const blank = (n: number): void => {
      for (let k = 0; k < n; k += 1) {
        out.push(source[i + k] === "\n" ? "\n" : " ");
      }
      i += n;
    };
    while (i < source.length) {
      const two = source.slice(i, i + 2);
      if (two === "//") {
        const nl = source.indexOf("\n", i);
        blank((nl === -1 ? source.length : nl) - i);
        continue;
      }
      if (two === "/*") {
        const close = source.indexOf("*/", i + 2);
        blank((close === -1 ? source.length : close + 2) - i);
        continue;
      }
      const ch = source[i] as string;
      if (ch === '"' || ch === "'" || ch === "`") {
        let j = i + 1;
        while (j < source.length) {
          if (source[j] === "\\") {
            j += 2;
            continue;
          }
          if (source[j] === ch) {
            j += 1;
            break;
          }
          // An unterminated single-quoted or double-quoted literal ends at the
          // newline; a template literal legitimately spans lines.
          if (ch !== "`" && source[j] === "\n") {
            break;
          }
          j += 1;
        }
        out.push(ch);
        i += 1;
        blank(j - i - 1);
        if (i < source.length && source[i] === ch) {
          out.push(ch);
          i += 1;
        }
        continue;
      }
      out.push(ch);
      i += 1;
    }
    return out.join("");
  };

  type DoorKind = "prisma" | "supabase-admin" | "supabase-anon";

  // THE DOOR PATTERNS AND THE GUARD CALL THAT ANSWERS EACH ONE, in one table
  // so a fourth kind is a row rather than a third copy of the loop.
  //
  // THE THIRD KIND IS NEW (fix round ten, CRITERIA finding CR9-M3P12-04). An
  // anon-key Supabase client built with createServerClient or
  // createBrowserClient opens whatever project NEXT_PUBLIC_SUPABASE_URL names
  // and matched neither of the two original patterns, so the scan's title said
  // EVERY door while its definition covered two kinds of door. Widening the
  // definition is the honest direction; the two application files that match
  // it are allow-listed below with their reason, and the staleness test keeps
  // both entries honest.
  const DOOR_KINDS: ReadonlyArray<{
    readonly kind: DoorKind;
    readonly constructs: RegExp;
    readonly requires?: RegExp;
    readonly guard: string;
  }> = [
    {
      kind: "prisma",
      constructs: /new\s+PrismaClient\s*\(/,
      guard: "assertGateDbTargetIsLocal",
    },
    {
      kind: "supabase-admin",
      constructs: /createClient\s*\(/,
      requires: /SUPABASE_SERVICE_ROLE_KEY/,
      guard: "assertGateApiTargetIsLocal",
    },
    {
      kind: "supabase-anon",
      constructs: /create(Server|Browser)Client\s*\(/,
      guard: "assertGateApiTargetIsLocal",
    },
  ];

  type Door = {
    readonly path: string;
    readonly kind: DoorKind;
    readonly guarded: boolean;
    // Whether the guard CALL precedes the construction, in code-only
    // positions. Undefined where the door is not guarded at all.
    readonly guardsBeforeConstructing: boolean | undefined;
  };

  // PURE, over code-only text, so every one of the shapes this round was shown
  // green on can be driven from a string in the regression test below rather
  // than only by editing a real file.
  const doorsInSource = (
    path: string,
    source: string,
  ): Door[] => {
    const doors: Door[] = [];
    for (const entry of DOOR_KINDS) {
      if (entry.requires !== undefined && !entry.requires.test(source)) {
        continue;
      }
      const construction = entry.constructs.exec(source);
      if (construction === null) {
        continue;
      }
      // A CALL, not a mention. `new RegExp` rather than a literal so the one
      // guard name in the table above is the only place it is written.
      const call = new RegExp(`\\b${entry.guard}\\s*\\(`).exec(source);
      doors.push({
        path,
        kind: entry.kind,
        guarded: call !== null,
        guardsBeforeConstructing:
          call === null ? undefined : call.index < construction.index,
      });
    }
    return doors;
  };

  const scanDoors = (files: readonly string[] = trackedSourceFiles()): Door[] =>
    files.flatMap((path) =>
      doorsInSource(path, codeOnly(readFileSync(join(projectRoot, path), "utf-8"))),
    );

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
    const unguarded = scanDoors(trackedSourceFiles())
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
    const doors = scanDoors(["prisma/seed.ts"]);
    expect(doors.map((door) => door.kind).sort()).toEqual([
      "prisma",
      "supabase-admin",
    ]);
    for (const door of doors) {
      expect(door.guarded).toBe(true);
      expect(door.guardsBeforeConstructing).toBe(true);
    }
  });

  // ORDER IS THE WHOLE POINT, AND IT IS NOW ASSERTED OF EVERY DOOR RATHER THAN
  // OF ONE FILE (fix round ten, HAZARD finding CR9-M3P12-HZ-03). The only
  // ordering assertion in the tree named prisma/seed.ts by path, so a second
  // door whose guard ran after its constructor was green. A guard that runs
  // after the thing it guards is not a guard.
  test("EVERY guarded door calls its guard BEFORE it constructs its client", () => {
    const exempt = new Set(ALLOWED_UNGUARDED.map((entry) => entry.path));
    const late = scanDoors()
      .filter(
        (door) =>
          !exempt.has(door.path) && door.guardsBeforeConstructing === false,
      )
      .map((door) => `${door.path} (${door.kind})`);
    expect(late).toEqual([]);
  });

  // THE SHAPES THIS SCAN WAS SHOWN GREEN ON, driven from strings so they stay
  // red forever rather than only until somebody edits the file they were found
  // in. Every one of these was witnessed passing the previous implementation.
  describe("the shapes that used to pass", () => {
    const PRISMA_DOOR = "const client = new PrismaClient();";

    test("a guard named only in an IMPORT does not guard anything", () => {
      const source = codeOnly(
        `import { assertGateDbTargetIsLocal } from "@/platform/db/gate-target";\n${PRISMA_DOOR}\n`,
      );
      const doors = doorsInSource("probe.ts", source);
      expect(doors).toHaveLength(1);
      expect(doors[0]!.guarded).toBe(false);
    });

    test("a guard named only in a LINE COMMENT does not guard anything", () => {
      const source = codeOnly(
        `// assertGateDbTargetIsLocal() runs somewhere else, honest\n${PRISMA_DOOR}\n`,
      );
      expect(doorsInSource("probe.ts", source)[0]!.guarded).toBe(false);
    });

    test("a guard named only in a BLOCK COMMENT does not guard anything", () => {
      const source = codeOnly(
        `/*\n  assertGateDbTargetIsLocal();\n*/\n${PRISMA_DOOR}\n`,
      );
      expect(doorsInSource("probe.ts", source)[0]!.guarded).toBe(false);
    });

    test("a guard named only in a STRING does not guard anything", () => {
      const source = codeOnly(
        `const why = "assertGateDbTargetIsLocal()";\n${PRISMA_DOOR}\n`,
      );
      expect(doorsInSource("probe.ts", source)[0]!.guarded).toBe(false);
    });

    test("a door hidden inside a BLOCK COMMENT is not a door", () => {
      const source = codeOnly(`/*\n${PRISMA_DOOR}\n*/\nconst x = 1;\n`);
      expect(doorsInSource("probe.ts", source)).toEqual([]);
    });

    test("a guard CALLED AFTER the constructor is guarded but out of order", () => {
      const source = codeOnly(
        `${PRISMA_DOOR}\nassertGateDbTargetIsLocal();\n`,
      );
      const door = doorsInSource("probe.ts", source)[0]!;
      expect(door.guarded).toBe(true);
      expect(door.guardsBeforeConstructing).toBe(false);
    });

    // THE CONTROLS, so all seven refusals above are refusals and not a
    // predicate that now refuses everything.
    test("THE CONTROL: a real call before a real constructor is guarded and in order", () => {
      const source = codeOnly(
        `import { assertGateDbTargetIsLocal } from "@/platform/db/gate-target";\nassertGateDbTargetIsLocal();\n${PRISMA_DOOR}\n`,
      );
      const door = doorsInSource("probe.ts", source)[0]!;
      expect(door.guarded).toBe(true);
      expect(door.guardsBeforeConstructing).toBe(true);
    });

    test("THE CONTROL: a bare door with no mention at all is an unguarded door", () => {
      const door = doorsInSource("probe.ts", codeOnly(`${PRISMA_DOOR}\n`))[0]!;
      expect(door.guarded).toBe(false);
    });

    test("THE CONTROL: the admin and anon kinds are recognised and told apart", () => {
      const admin = doorsInSource(
        "probe.ts",
        codeOnly(
          `const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\nconst a = createClient(u, k);\n`,
        ),
      );
      expect(admin.map((door) => door.kind)).toEqual(["supabase-admin"]);
      const anon = doorsInSource(
        "probe.ts",
        codeOnly(`const c = createServerClient(u, k, o);\n`),
      );
      expect(anon.map((door) => door.kind)).toEqual(["supabase-anon"]);
    });
  });

  // WHAT THE DENOMINATOR STILL COULD NOT SEE, closed (fix round ten, CRITERIA
  // finding CR9-M3P12-03 and HAZARD finding CR9-M3P12-HZ-04). git ls-files
  // reads the INDEX, so a file staged in the same commit IS scanned; what was
  // invisible is a file that exists on disk and has never been staged, which
  // is exactly the shape of an operator's own one-off script, and the fast
  // gate is normally run BEFORE git add, which is the moment the author most
  // wants to be told.
  test("an UNTRACKED door on disk is seen too: the denominator is the working tree, not only the index", () => {
    const files = scannedSourceFiles();
    const tracked = trackedSourceFiles();
    expect(files.length).toBeGreaterThanOrEqual(tracked.length);
    const exempt = new Set(ALLOWED_UNGUARDED.map((entry) => entry.path));
    const unguarded = scanDoors(files)
      .filter((door) => !door.guarded && !exempt.has(door.path))
      .map((door) => `${door.path} (${door.kind})`);
    expect(unguarded).toEqual([]);
  });
});
