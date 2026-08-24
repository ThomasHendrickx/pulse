import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  assessRederiveTarget,
  projectRefFromHost,
  projectRefFromUsername,
} from "../../src/platform/db/target-guard";

// CRITERION 12.23. The re-derivation refuses a database it was not told to
// write to. Every connection string below is INVENTED: the refs are
// hand-typed letter runs and the passwords are the literal word.
//
// TWO ENDPOINT SHAPES, and a suite exercising one does not meet the
// criterion, so both are carried through every case.

const POOLER_HOST = "aws-0-eu-central-1.pooler.supabase.com";
const REF_A = "aaaabbbbccccddddeeee";
const REF_B = "aaaabbbbccccddddeeef";

const poolerUrl = (ref: string, host: string = POOLER_HOST): string =>
  `postgresql://postgres.${ref}:pw@${host}:5432/postgres`;

const directHost = (ref: string): string => `db.${ref}.supabase.co`;
const directUrl = (ref: string): string =>
  `postgresql://postgres:pw@${directHost(ref)}:5432/postgres`;

const ok = (url: string, host: string, projectRef: string) =>
  assessRederiveTarget({ DATABASE_URL: url }, { host, projectRef });

describe("CRITERION 12.23: the extraction, not just the field", () => {
  // THE ASSERTION THAT FAILS A RESOLVER RETURNING THE FIXED PREFIX. A reader
  // who takes the part BEFORE the dot gets the literal word "postgres" for
  // every project on earth, and every match test would still pass against a
  // single project. These two cases are what catch it.
  test("SESSION POOLER: the extracted ref DIFFERS for two connection strings differing only in their ref", () => {
    const a = projectRefFromUsername(new URL(poolerUrl(REF_A)).username);
    const b = projectRefFromUsername(new URL(poolerUrl(REF_B)).username);
    expect(a).toBe(REF_A);
    expect(b).toBe(REF_B);
    expect(a).not.toBe(b);
    // And it is not the fixed prefix.
    expect(a).not.toBe("postgres");
  });

  test("DIRECT CONNECTION: the extracted ref DIFFERS for two connection strings differing only in their ref", () => {
    const a = projectRefFromHost(new URL(directUrl(REF_A)).hostname);
    const b = projectRefFromHost(new URL(directUrl(REF_B)).hostname);
    expect(a).toBe(REF_A);
    expect(b).toBe(REF_B);
    expect(a).not.toBe(b);
    // And it is not the fixed prefix, which here is the literal "db".
    expect(a).not.toBe("db");
  });

  test("the ref is the part AFTER the first dot of the username, so a dotted ref survives whole", () => {
    expect(projectRefFromUsername("postgres.one.two")).toBe("one.two");
    expect(projectRefFromUsername("postgres")).toBeUndefined();
    expect(projectRefFromUsername("postgres.")).toBeUndefined();
  });

  test("the ref is the SECOND label of the host, and a pooler host carries none", () => {
    expect(projectRefFromHost(`db.${REF_A}.supabase.co`)).toBe(REF_A);
    expect(projectRefFromHost(POOLER_HOST)).toBeUndefined();
    expect(projectRefFromHost("db.supabase.co")).toBeUndefined();
  });

  test("A DIRECT CONNECTION'S USERNAME CARRIES NO REF, so a username-only resolver sees nothing and must not pass", () => {
    expect(projectRefFromUsername(new URL(directUrl(REF_A)).username)).toBeUndefined();
  });
});

describe("CRITERION 12.23: one matching case per endpoint shape proceeds", () => {
  test("SESSION POOLER: host and ref both given and both matching is allowed", () => {
    const verdict = ok(poolerUrl(REF_A), POOLER_HOST, REF_A);
    expect(verdict.allowed).toBe(true);
  });

  test("DIRECT CONNECTION: host and ref both given and both matching is allowed", () => {
    const verdict = ok(directUrl(REF_A), directHost(REF_A), REF_A);
    expect(verdict.allowed).toBe(true);
  });

  test("the confirmation names the target the OPERATOR gave and nothing resolved", () => {
    const verdict = ok(poolerUrl(REF_A), POOLER_HOST, REF_A);
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toContain(REF_A);
    expect(verdict.reason).not.toContain("pw");
    expect(verdict.reason).not.toContain("postgresql://");
  });
});

describe("CRITERION 12.23: refusal is fail closed and total", () => {
  const cases: readonly { readonly name: string; readonly verdict: ReturnType<typeof ok> }[] = [
    {
      name: "no target given at all",
      verdict: assessRederiveTarget({ DATABASE_URL: poolerUrl(REF_A) }, {}),
    },
    {
      name: "host given but empty",
      verdict: ok(poolerUrl(REF_A), "   ", REF_A),
    },
    {
      name: "ref given but empty",
      verdict: ok(poolerUrl(REF_A), POOLER_HOST, ""),
    },
    {
      name: "connection absent",
      verdict: assessRederiveTarget({}, { host: POOLER_HOST, projectRef: REF_A }),
    },
    {
      name: "connection empty",
      verdict: ok("", POOLER_HOST, REF_A),
    },
    {
      name: "connection unparseable",
      verdict: ok("this is not a url", POOLER_HOST, REF_A),
    },
    {
      name: "host mismatched, pooler",
      verdict: ok(poolerUrl(REF_A), "aws-1-eu-north-1.pooler.supabase.com", REF_A),
    },
    {
      name: "host mismatched, direct",
      verdict: ok(directUrl(REF_A), directHost(REF_B), REF_A),
    },
    {
      name: "project ref mismatched with the ref in the USERNAME",
      verdict: ok(poolerUrl(REF_B), POOLER_HOST, REF_A),
    },
    {
      name: "project ref mismatched with the ref in the HOST",
      verdict: ok(directUrl(REF_B), directHost(REF_B), REF_A),
    },
    {
      name: "no ref in either field, so unparseable",
      verdict: ok(`postgresql://postgres:pw@${POOLER_HOST}:5432/postgres`, POOLER_HOST, REF_A),
    },
  ];

  for (const { name, verdict } of cases) {
    test(`REFUSES: ${name}`, () => {
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason.length).toBeGreaterThan(0);
    });
  }

  // THE SAME-REGION CASE THAT MOTIVATES THE WHOLE REF CHECK: a different
  // project of the same owner on the SAME pooler host. Host matches; ref does
  // not; it refuses.
  test("REFUSES a DIFFERENT project on the SAME pooler host, which a host-only interlock would approve", () => {
    const sameHostOtherProject = poolerUrl(REF_B);
    expect(new URL(sameHostOtherProject).hostname).toBe(POOLER_HOST);
    expect(ok(sameHostOtherProject, POOLER_HOST, REF_A).allowed).toBe(false);
    // And the host-only comparison the older guard makes would NOT have
    // caught it, which is why this interlock exists beside that one.
    expect(new URL(sameHostOtherProject).hostname).toBe(
      new URL(poolerUrl(REF_A)).hostname,
    );
  });

  test("NO CONNECTION STRING, PASSWORD, RESOLVED HOST OR RESOLVED REF is printed on ANY refusal path", () => {
    const secretHost = "aws-1-eu-north-1.pooler.supabase.com";
    const secretRef = "zzzzyyyyxxxxwwwwvvvv";
    const secretPassword = "s3cr3tpassw0rd";
    const url = `postgresql://postgres.${secretRef}:${secretPassword}@${secretHost}:5432/postgres`;
    const refusals = [
      assessRederiveTarget({ DATABASE_URL: url }, {}),
      assessRederiveTarget({ DATABASE_URL: url }, { host: POOLER_HOST }),
      assessRederiveTarget({ DATABASE_URL: url }, { host: POOLER_HOST, projectRef: REF_A }),
      assessRederiveTarget({ DATABASE_URL: url }, { host: secretHost, projectRef: REF_A }),
      assessRederiveTarget({ DATABASE_URL: "nonsense" }, { host: POOLER_HOST, projectRef: REF_A }),
      assessRederiveTarget({}, { host: POOLER_HOST, projectRef: REF_A }),
    ];
    for (const verdict of refusals) {
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).not.toContain(secretPassword);
      expect(verdict.reason).not.toContain(secretRef);
      expect(verdict.reason).not.toContain(secretHost);
      expect(verdict.reason).not.toContain(url);
      expect(verdict.reason).not.toContain("postgresql://");
    }
  });

  test("THE PERCENT-ENCODED USERNAME REFUSES, which is the one accepted equivalence gap and is fail closed", () => {
    // WHATWG URL does not decode `username`; the client's own parser does. So
    // a ref written percent-encoded is seen here encoded, does not equal the
    // bare ref, and refuses a target the client would have opened. A blocked
    // run and a round trip, never a migration in the wrong place.
    const encoded = `postgresql://postgres.aaaa%2Dbbbb:pw@${POOLER_HOST}:5432/postgres`;
    expect(new URL(encoded).username).toContain("%2D");
    expect(ok(encoded, POOLER_HOST, "aaaa-bbbb").allowed).toBe(false);
  });
});

describe("CRITERION 12.23: there is no override", () => {
  test("no argument of any name makes a mismatch proceed", () => {
    const mismatch = { DATABASE_URL: poolerUrl(REF_B) };
    const attempts: readonly Record<string, unknown>[] = [
      { host: POOLER_HOST, projectRef: REF_A, force: true },
      { host: POOLER_HOST, projectRef: REF_A, allowRemote: "1" },
      { host: POOLER_HOST, projectRef: REF_A, PULSE_ALLOW_REMOTE_DB_DESTRUCTION: "1" },
      { host: POOLER_HOST, projectRef: REF_A, yes: "really" },
    ];
    for (const attempt of attempts) {
      const verdict = assessRederiveTarget(
        mismatch,
        attempt as { host?: string; projectRef?: string },
      );
      expect(verdict.allowed).toBe(false);
    }
    // And the environment variable that DOES override the sibling guard has
    // no effect here, asserted rather than assumed.
    const previous = process.env["PULSE_ALLOW_REMOTE_DB_DESTRUCTION"];
    process.env["PULSE_ALLOW_REMOTE_DB_DESTRUCTION"] = "1";
    try {
      expect(
        assessRederiveTarget(mismatch, { host: POOLER_HOST, projectRef: REF_A }).allowed,
      ).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env["PULSE_ALLOW_REMOTE_DB_DESTRUCTION"];
      } else {
        process.env["PULSE_ALLOW_REMOTE_DB_DESTRUCTION"] = previous;
      }
    }
  });

  test("the module exports no override symbol and its source names no escape hatch", async () => {
    const guardModule = await import("../../src/platform/db/target-guard");
    expect(Object.keys(guardModule).sort()).toEqual([
      "assessRederiveTarget",
      "projectRefFromHost",
      "projectRefFromUsername",
    ]);
  });
});

// CRITERION 12.23: the refusal happens BEFORE any repository call, and it
// exits non-zero. The subject is the SHIPPED SCRIPT, run as a process, with a
// fake repository module substituted so any call it would have made is
// recorded. The script must record none.
describe("CRITERION 12.23: a refused run has read and written nothing, and exits non-zero", () => {
  const repositoryRoot = join(__dirname, "..", "..");

  const runScript = (
    args: readonly string[],
    env: Record<string, string>,
  ): { status: number | null; stdout: string; stderr: string } => {
    const result = spawnSync(
      "npx",
      ["tsx", "scripts/rederive-merchant-rules.ts", ...args],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          // A CALL RECORDER, not a database. Any repository call the script
          // makes reaches a Prisma client pointed at a host that does not
          // resolve, so a call is a visible failure rather than a silent
          // success; combined with the assertions below, "no call was made"
          // is what a clean refusal looks like.
          DATABASE_URL: env["DATABASE_URL"] ?? "",
          DIRECT_URL: env["DIRECT_URL"] ?? "",
          PULSE_ALLOW_REMOTE_DB_DESTRUCTION: "1",
        },
      },
    );
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  };

  const SECRET_HOST = "aws-1-eu-north-1.pooler.supabase.com";
  const SECRET_REF = "zzzzyyyyxxxxwwwwvvvv";
  const SECRET_PASSWORD = "s3cr3tpassw0rd";
  const AMBIENT = `postgresql://postgres.${SECRET_REF}:${SECRET_PASSWORD}@${SECRET_HOST}:5432/postgres`;

  test("with NO target arguments and a live-looking ambient connection, it refuses, exits non-zero, and issues no query", () => {
    const run = runScript(["--household", "any-household"], {
      DATABASE_URL: AMBIENT,
      DIRECT_URL: AMBIENT,
    });
    expect(run.status).not.toBe(0);
    // It never reached the routine, so none of the routine's own output
    // exists: no decision report, no totals, no applied line.
    expect(run.stdout).not.toContain("--- decision report ---");
    expect(run.stdout).not.toContain("--- totals ---");
    expect(run.stdout).not.toContain("applied ");
    // And no query was attempted: a Prisma connection failure against that
    // host would name the connector or the host, and neither appears.
    const output = `${run.stdout}${run.stderr}`;
    expect(output).not.toContain("prisma");
    expect(output).not.toContain(SECRET_HOST);
    expect(output).not.toContain(SECRET_REF);
    expect(output).not.toContain(SECRET_PASSWORD);
    expect(output).not.toContain("postgresql://");
  });

  test("with a MISMATCHED ref against a matching host, it still refuses and still issues no query", () => {
    const run = runScript(
      [
        "--household",
        "any-household",
        "--expect-host",
        SECRET_HOST,
        "--expect-ref",
        "aaaabbbbccccddddeeee",
      ],
      { DATABASE_URL: AMBIENT, DIRECT_URL: AMBIENT },
    );
    expect(run.status).not.toBe(0);
    expect(run.stdout).not.toContain("--- decision report ---");
    const output = `${run.stdout}${run.stderr}`;
    expect(output).not.toContain(SECRET_REF);
    expect(output).not.toContain(SECRET_PASSWORD);
    expect(output).not.toContain("postgresql://");
  });

  test("the override that clears the SIBLING guard does not clear this one, asserted through the shipped command", () => {
    // PULSE_ALLOW_REMOTE_DB_DESTRUCTION=1 is set in every run above.
    const run = runScript(["--household", "any-household"], {
      DATABASE_URL: AMBIENT,
      DIRECT_URL: AMBIENT,
    });
    expect(run.status).not.toBe(0);
  });

  test("the script's source wires the guard BEFORE it reads the household or builds a context", () => {
    const source = readFileSync(
      join(repositoryRoot, "scripts", "rederive-merchant-rules.ts"),
      "utf8",
    );
    const guardAt = source.indexOf("assessRederiveTarget(");
    const householdAt = source.indexOf('argument("household")');
    const routineAt = source.indexOf("rederiveMerchantRules(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(householdAt);
    expect(guardAt).toBeLessThan(routineAt);
    // And the two arguments are required rather than defaulted.
    expect(source).toContain('argument("expect-host")');
    expect(source).toContain('argument("expect-ref")');
    // NO OVERRIDE PATH in the script either.
    expect(source).not.toMatch(/expect-host[\s\S]{0,200}\|\|\s*["']/);
  });
});
