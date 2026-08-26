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

// FIX ROUND THREE, finding CR3-M3P12-08. THE GUARD MUST READ WHAT THE CLIENT
// WILL USE. A connection string is a document, not two fields, and the
// connector resolves more of it than the authority: a `host` query parameter
// names a unix socket directory and the client opens THAT, ignoring the
// hostname the interlock was comparing. A guard that reads a different field
// from the one the client connects through is the decorative guard criterion
// 12.23 exists to prevent, one level down.
describe("CRITERION 12.23: the endpoint is the whole string, not the authority", () => {
  const HOST = "aws-0-eu-central-1.pooler.supabase.com";
  const REF = "aaaabbbbccccddddeeee";
  const correct = `postgresql://postgres.${REF}:pw@${HOST}:5432/postgres`;
  const check = (url: string) =>
    assessRederiveTarget({ DATABASE_URL: url }, { host: HOST, projectRef: REF });

  test("the control: a plain correct string is ALLOWED, so the refusals below are refusals", () => {
    expect(check(correct).allowed).toBe(true);
  });

  // THE ASSERTION THAT FAILS A RESOLVER READING THE HOSTNAME WHILE THE CLIENT
  // OPENS A SOCKET. Both strings carry the same authority, the same username
  // and the same ref, so every field comparison this interlock made before
  // this round returns the same answer for both. Only a guard that reads the
  // query the client reads can tell them apart.
  test("a host QUERY PARAMETER is refused, though its authority is byte-identical to an approved string", () => {
    const socketPath = `${correct}?host=/tmp/not-a-socket-dir`;
    const parsedApproved = new URL(correct);
    const parsedAttack = new URL(socketPath);
    expect(parsedAttack.hostname).toBe(parsedApproved.hostname);
    expect(parsedAttack.username).toBe(parsedApproved.username);
    expect(check(correct).allowed).toBe(true);
    expect(check(socketPath).allowed).toBe(false);
  });

  test("a DIFFERENT DATABASE NAME is refused, though host and ref both match", () => {
    expect(check(`postgresql://postgres.${REF}:pw@${HOST}:5432/some_other_db`).allowed).toBe(
      false,
    );
    expect(check(`postgresql://postgres.${REF}:pw@${HOST}:5432/postgres`).allowed).toBe(true);
  });

  // CRITERIA FINDING CR4-M3P12-04. The four admitted names were checked by NAME
  // alone, and one of them decides which data a write lands on. A hostile
  // schema value was ALLOWED by every earlier version of this function.
  test("an ADMITTED parameter whose value moves the write is refused on its VALUE: schema", () => {
    expect(check(`${correct}?schema=someone_elses_schema`).allowed).toBe(false);
    expect(check(`${correct}?schema=public`).allowed).toBe(true);
    expect(check(correct).allowed).toBe(true);
  });

  test("a DUPLICATED schema parameter is refused on the occurrence the first read would miss", () => {
    expect(check(`${correct}?schema=public&schema=someone_elses_schema`).allowed).toBe(
      false,
    );
  });

  // THE DELIBERATE OTHER HALF OF THAT SPLIT: these three change HOW the
  // connection is made and not WHERE it lands, so their values stay free.
  // Pinned so the distinction is a decision and not an omission.
  test("an admitted parameter whose value does NOT move the write keeps its value free", () => {
    expect(check(`${correct}?sslmode=disable`).allowed).toBe(true);
    expect(check(`${correct}?connection_limit=1`).allowed).toBe(true);
    expect(check(`${correct}?pgbouncer=true`).allowed).toBe(true);
  });

  // HAZARD FINDING CR4-M3P12-02. Three otherwise identical strings differing
  // only in port were all approved with the SAME reason text before this
  // round: the interlock never read parsed.port and the expectation had no
  // field for it.
  // DECIDED IN FIX ROUND FIVE, hazard finding HAZ5-2. This test used to
  // assert that BOTH 5432 and 6543 pass unnamed, which pinned the very
  // ambiguity the port check was raised to close: an operator running the
  // migration exactly as documented, with the two required arguments, got a
  // transaction-pooled connection with no signal. Unnamed now means 5432.
  test("AN UNNAMED PORT MUST BE 5432, and every other port is refused including the transaction pooler", () => {
    expect(check(`postgresql://postgres.${REF}:pw@${HOST}:5432/postgres`).allowed).toBe(
      true,
    );
    expect(check(`postgresql://postgres.${REF}:pw@${HOST}:6543/postgres`).allowed).toBe(
      false,
    );
    expect(check(`postgresql://postgres.${REF}:pw@${HOST}:9999/postgres`).allowed).toBe(
      false,
    );
  });

  // CRITERIA finding CR5-M3P12-09. A portless string was refused with advice
  // that could not work: --expect-port compared against an empty string and
  // refused again, so the shape was unapprovable and the sentence was false
  // about the program printing it.
  test("AN ABSENT PORT is the connector's default, and --expect-port can still name it", () => {
    const portless = `postgresql://postgres.${REF}:pw@${HOST}/postgres`;
    expect(check(portless).allowed).toBe(true);
    expect(
      assessRederiveTarget(
        { DATABASE_URL: portless },
        { host: HOST, projectRef: REF, port: "5432" },
      ).allowed,
    ).toBe(true);
    expect(
      assessRederiveTarget(
        { DATABASE_URL: portless },
        { host: HOST, projectRef: REF, port: "6543" },
      ).allowed,
    ).toBe(false);
  });

  test("the transaction pooler is reachable by NAMING it, which is the whole point of the flag", () => {
    expect(
      assessRederiveTarget(
        { DATABASE_URL: `postgresql://postgres.${REF}:pw@${HOST}:6543/postgres` },
        { host: HOST, projectRef: REF, port: "6543" },
      ).allowed,
    ).toBe(true);
  });

  test("a NAMED port is compared exactly, so a pooling-mode mismatch is refused too", () => {
    const withPort = (url: string, port: string) =>
      assessRederiveTarget(
        { DATABASE_URL: url },
        { host: HOST, projectRef: REF, port },
      );
    expect(
      withPort(`postgresql://postgres.${REF}:pw@${HOST}:6543/postgres`, "5432").allowed,
    ).toBe(false);
    expect(
      withPort(`postgresql://postgres.${REF}:pw@${HOST}:5432/postgres`, "5432").allowed,
    ).toBe(true);
    // And naming an unusual port deliberately is how an operator reaches one.
    expect(
      withPort(`postgresql://postgres.${REF}:pw@${HOST}:9999/postgres`, "9999").allowed,
    ).toBe(true);
  });

  test("a query parameter this interlock does not understand is refused rather than ignored", () => {
    expect(check(`${correct}?options=-c%20search_path%3Dsomething`).allowed).toBe(false);
    expect(check(`${correct}?whatever=1`).allowed).toBe(false);
  });

  test("the parameters this codebase actually uses are still ALLOWED, so the refusal is not a blanket one", () => {
    expect(check(`${correct}?pgbouncer=true`).allowed).toBe(true);
    expect(check(`${correct}?sslmode=require&connection_limit=1`).allowed).toBe(true);
    expect(check(`${correct}?schema=public`).allowed).toBe(true);
  });

  test("no refusal on these paths prints the connection string or anything inside it", () => {
    const secret = "s3cr3tpassw0rd";
    const url = `postgresql://postgres.${REF}:${secret}@${HOST}:5432/other?host=/tmp/x&options=y`;
    const verdict = assessRederiveTarget(
      { DATABASE_URL: url },
      { host: HOST, projectRef: REF },
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).not.toContain(secret);
    expect(verdict.reason).not.toContain("/tmp/x");
    expect(verdict.reason).not.toContain("options");
    expect(verdict.reason).not.toContain("postgresql://");
  });
});

// FIX ROUND THREE, finding CR3-M3P12-03. The interlock resolves the string
// the CLIENT will open, not the one the Prisma CLI would.
describe("CRITERION 12.23: the interlock resolves what the client resolves", () => {
  test("resolveClientDbUrl reads process.env only, which is what new PrismaClient() reads", async () => {
    const { resolveClientDbUrl } = await import("../../src/platform/db/resolve-env");
    const previous = process.env["DATABASE_URL"];
    try {
      process.env["DATABASE_URL"] = "postgresql://u:p@h:5432/postgres";
      expect(resolveClientDbUrl()).toBe("postgresql://u:p@h:5432/postgres");
      process.env["DATABASE_URL"] = "";
      expect(resolveClientDbUrl()).toBeUndefined();
      delete process.env["DATABASE_URL"];
      expect(resolveClientDbUrl()).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete process.env["DATABASE_URL"];
      } else {
        process.env["DATABASE_URL"] = previous;
      }
    }
  });

  test("the script hands the interlock the CLIENT's reading, not the CLI's", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "scripts", "rederive-merchant-rules.ts"),
      "utf8",
    );
    expect(source).toContain("resolveClientDbUrl()");
    expect(source).not.toContain('resolveDbEnv("DATABASE_URL")');
  });

  test("nothing in the tree loads dotenv, which is why the client's reading is process.env only", () => {
    const client = readFileSync(
      join(__dirname, "..", "..", "src", "platform", "db", "client.ts"),
      "utf8",
    );
    expect(client).not.toContain("dotenv");
    expect(client).not.toContain("loadEnvFile");
  });
});

// FIX ROUND TEN, HAZARD finding CR9-M3P12-HZ-02.
//
// THE HEADER CLAIMED "Before this command reads or writes ANYTHING", and a
// reviewer captured the application client's own startup line printing BEFORE
// the interlock's refusal, because the import graph constructed a client at
// module scope. The claim is now true rather than narrowed, because the client
// is lazy; this is the test that keeps it true, and it executes the shipped
// command rather than reading it.
describe("a refused run constructs no client at all, not merely no query", () => {
  const repositoryRoot = join(__dirname, "..", "..");

  test("the FIRST line of a refused run is the refusal, and no client announces itself", () => {
    const result = spawnSync(
      "npx",
      [
        "tsx",
        "scripts/rederive-merchant-rules.ts",
        "--household",
        "00000000-0000-4000-8000-000000000001",
        "--expect-host",
        "aws-0-eu-west-9.pooler.supabase.com",
        "--expect-ref",
        "qqqqppppoooonnnnmmmm",
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          // INVENTED, and deliberately a shape the interlock will refuse: the
          // host and the ref both differ from the ones named above.
          DATABASE_URL:
            "postgresql://postgres.zzzzyyyyxxxxwwwwvvvv:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
          DIRECT_URL:
            "postgresql://postgres.zzzzyyyyxxxxwwwwvvvv:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
        },
      },
    );
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).toBe(3);
    // THE ORDERING CLAIM, executed. The client prints one line the moment it
    // is constructed, so its absence is the evidence that none was.
    expect(output).not.toContain("[pulse:db]");
    expect(output.trimStart().startsWith("rederive-merchant-rules:")).toBe(true);
  }, 60_000);
});
