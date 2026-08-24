import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
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
  // named", and it now SCANS instead of naming one file (fix round five,
  // CRITERIA finding CR5-M3P12-08). The assertion above states a universal
  // and checked a single hard-coded path, so a second spec opening a client
  // would not have reddened it, and a Supabase admin client was not covered
  // at all though one exists and writes. This walks every file under test/
  // and scripts/ and requires each door to be guarded by the interlock that
  // matches it.
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "node_modules" ? [] : walk(full);
      }
      return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });

  test("EVERY door in test/ and scripts/ is guarded, whatever kind of client opens it", () => {
    const files = [
      ...walk(join(projectRoot, "test")),
      ...walk(join(projectRoot, "scripts")),
    ];
    // The scan is only worth what it covers, so it says how much it read.
    expect(files.length).toBeGreaterThan(30);

    // PROSE IS NOT A DOOR. This tree talks about `new PrismaClient()` in
    // comments and in test titles more often than it calls it, so the scan
    // reads CODE: line comments are dropped and quoted spans are blanked
    // before the patterns are applied. Without this the scanner reports the
    // sentence explaining the guard as a violation of it.
    const codeOnly = (source: string): string =>
      source
        .split("\n")
        .map((line) => line.replace(/\/\/.*$/, ""))
        .join("\n")
        .replace(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g, '""');

    const unguardedPrisma: string[] = [];
    const unguardedAdmin: string[] = [];
    for (const file of files) {
      const raw = readFileSync(file, "utf-8");
      const source = codeOnly(raw);
      // This file NAMES both interlocks in order to test them, and the
      // scanner would otherwise read itself as a door.
      if (file.endsWith(join("test", "db", "gate-target.test.ts"))) {
        continue;
      }
      if (
        /new\s+PrismaClient\s*\(/.test(source) &&
        !raw.includes("assertGateDbTargetIsLocal")
      ) {
        unguardedPrisma.push(file);
      }
      if (
        /SUPABASE_SERVICE_ROLE_KEY/.test(source) &&
        /createClient\s*\(/.test(source) &&
        !raw.includes("assertGateApiTargetIsLocal")
      ) {
        unguardedAdmin.push(file);
      }
    }
    expect({ unguardedPrisma, unguardedAdmin }).toEqual({
      unguardedPrisma: [],
      unguardedAdmin: [],
    });
  });
});
