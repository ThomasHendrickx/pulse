// THE TARGET INTERLOCK for the one-off merchant-rule re-derivation (M3-P12,
// criterion 12.23, hazard H12.30).
//
// WHAT IT ANSWERS, and why guard.ts does not answer it. guard.ts asks whether
// a DESTRUCTIVE command is pointed at a LOCAL host, and a hostname is a
// complete answer to that question. This one asks whether a WRITING migration
// is pointed at the ONE database an operator named, and a hostname is not a
// complete answer to that: fleet warning 5 records the session pooler as the
// only endpoint reachable from an IPv4 environment, and a pooler host is
// REGIONAL INFRASTRUCTURE SHARED BY EVERY PROJECT IN THAT REGION. A host
// match there proves the region and nothing else, so it would approve every
// project the owner has in that region. That is not theoretical in this
// fleet: the ambient DATABASE_URL in these containers belongs to a DIFFERENT
// project of the owner's, with a working password, in the same region.
//
// SO THE OPERATOR NAMES TWO THINGS and both must match: the host, and the
// PROJECT REF. Refusal is fail closed and total.
//
// WHERE THE REF LIVES, WHICH DEPENDS ON THE ENDPOINT SHAPE, and getting the
// FIELD right is not enough because the EXTRACTION is where a reader slips:
//
//   SESSION POOLER. The ref is in the USERNAME, which is the literal word
//   `postgres`, a dot, and then the ref. THE REF IS THE PART AFTER THE FIRST
//   DOT. The host is regional and carries no ref at all. Taking the part
//   BEFORE the dot yields the literal word `postgres` for every project on
//   earth, which is the mistake this comment exists to stop.
//
//   DIRECT CONNECTION. The ref is inside the HOST, which is `db`, a dot, the
//   ref, a dot, and the provider domain. THE REF IS THE SECOND
//   DOT-SEPARATED LABEL. The username is the bare word `postgres` and
//   carries no ref, so a resolver that only reads the username sees nothing
//   here and must refuse rather than pass.
//
// THE OPERATOR PASSES THE BARE REF, never a decorated field, so one argument
// is correct against either shape.
//
// THE ONE EQUIVALENCE EXCEPTION, AND IT IS FAIL CLOSED, named here so a
// refusal is not read as a mystery: WHATWG `new URL()` does not
// percent-decode `username`, while the database client's own parser does. A
// connection string carrying a PERCENT-ENCODED username is therefore seen
// here in its encoded form, its extracted ref does not equal the bare ref the
// operator passed, and this REFUSES a target the client would have opened.
// That direction costs a blocked run and a round trip; the other direction
// would cost a migration in the wrong database, which is why the asymmetry is
// accepted rather than engineered around.
//
// NO OVERRIDE FLAG, and the difference from guard.ts is deliberate rather
// than an oversight. guard.ts is local-only by default, so it needs an escape
// hatch for the deliberate remote reset. This interlock's whole content is an
// operator's assertion about which database they mean; a flag saying "yes
// really" would be a second assertion of the same thing, and the thing being
// checked cannot be its own evidence.
//
// NOTHING RESOLVED IS EVER PRINTED. No connection string, no password, no
// resolved host, no resolved ref appears in any reason this module returns.
// The connection string in this fleet carries a working password for a
// database that is not Pulse's, and a refusal reason is exactly the kind of
// string that gets pasted into a note.

// THE QUERY PARAMETERS THIS INTERLOCK UNDERSTANDS, and it refuses every
// other one (fix round three, finding CR3-M3P12-08). The rule this closes is
// the one the whole criterion rests on: THE GUARD MUST READ WHAT THE CLIENT
// WILL USE. A connection string is not two fields, it is a document, and the
// connector resolves more of it than a hostname and a username:
//
//   `?host=` NAMES A UNIX SOCKET DIRECTORY and the connector opens THAT,
//   ignoring the authority's hostname entirely. Witnessed: a string carrying
//   a correct pooler authority plus a host parameter naming a filesystem path
//   was APPROVED by the field comparison, and the shipped client then tried
//   to reach the path. That is the decorative guard criterion 12.23 exists to
//   prevent, one level down, so it is refused by name.
//
//   ANY OTHER UNKNOWN PARAMETER is refused too, rather than ignored, because
//   the interlock cannot say what it does. The four below are the ones this
//   codebase's own connection strings use.
const UNDERSTOOD_PARAMETERS: ReadonlySet<string> = new Set([
  "pgbouncer",
  "sslmode",
  "connection_limit",
  "schema",
]);

// The only database this product uses. Checked because the module's own
// question is whether the migration is pointed at the ONE database an
// operator named, and a string differing only in its database name was
// approved before this (finding CR3-M3P12-08).
const EXPECTED_DATABASE = "postgres";

export type RederiveTargetEnv = {
  // The connection the ROUTINE ITSELF would use. DIRECT_URL is deliberately
  // not checked: it is the migration endpoint and this routine runs no
  // migration, so checking it would refuse a correct run whose DIRECT_URL is
  // unset and would prove nothing about the connection actually opened.
  readonly DATABASE_URL?: string | undefined;
};

// What the operator asserted on this invocation. Both are required; both
// being absent is the ordinary case of someone running the command without
// having thought about the target, and it refuses.
export type RederiveTargetExpectation = {
  readonly host?: string | undefined;
  readonly projectRef?: string | undefined;
};

export type RederiveTargetVerdict =
  | { readonly allowed: true; readonly reason: string }
  | { readonly allowed: false; readonly reason: string };

// `postgres.<ref>` on a session pooler. The ref is everything after the FIRST
// dot, so a ref that itself contains a dot survives intact. A bare
// `postgres`, which is what a direct connection carries, yields undefined.
export const projectRefFromUsername = (username: string): string | undefined => {
  const firstDot = username.indexOf(".");
  if (firstDot === -1) {
    return undefined;
  }
  const ref = username.slice(firstDot + 1);
  return ref === "" ? undefined : ref;
};

// `db.<ref>.<provider domain>` on a direct connection. The ref is the SECOND
// dot-separated label. A pooler host, which has no `db.` prefix, yields
// undefined.
// FOUR LABELS AT LEAST, not three, and the reason is a case the first draft
// got wrong and a test caught: `db.supabase.co` is three labels whose second
// is the START OF THE PROVIDER DOMAIN, and reading it as a ref would hand
// back `supabase` for a host that carries no ref at all. The real shape is
// `db`, the ref, and a provider domain of at least two labels.
export const projectRefFromHost = (hostname: string): string | undefined => {
  const labels = hostname.toLowerCase().split(".");
  if (labels.length < 4 || labels[0] !== "db") {
    return undefined;
  }
  const ref = labels[1];
  return ref === undefined || ref === "" ? undefined : ref;
};

const normaliseHost = (hostname: string): string =>
  hostname.replace(/^\[|\]$/g, "").toLowerCase();

export const assessRederiveTarget = (
  env: RederiveTargetEnv,
  expectation: RederiveTargetExpectation,
): RederiveTargetVerdict => {
  const expectedHost = expectation.host;
  if (expectedHost === undefined || expectedHost.trim() === "") {
    return {
      allowed: false,
      reason:
        "no target host was given. This command rewrites every merchant rule of a household and then recomputes; it will not run against a database nobody named. Pass --expect-host and --expect-ref.",
    };
  }
  const expectedRef = expectation.projectRef;
  if (expectedRef === undefined || expectedRef.trim() === "") {
    return {
      allowed: false,
      reason:
        "no target project ref was given. A host match alone is not enough: the session pooler host is regional infrastructure shared by every project in that region. Pass --expect-ref with the bare project ref.",
    };
  }

  const url = env.DATABASE_URL;
  if (url === undefined || url === "") {
    return {
      allowed: false,
      reason:
        "DATABASE_URL is not set, so there is no target to check. Refusing.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      allowed: false,
      reason:
        "DATABASE_URL did not parse as a connection URL, so its target cannot be established. Refusing.",
    };
  }

  // REFUSE WHAT THE INTERLOCK CANNOT ACCOUNT FOR, before comparing anything,
  // because a parameter can move the endpoint out from under the comparison.
  if (parsed.searchParams.has("host")) {
    return {
      allowed: false,
      reason:
        "the resolved connection carries a host query parameter, which makes the endpoint a socket path rather than the host given on the command line. Refusing: this interlock compares the host, and a connection that does not use it cannot be checked that way.",
    };
  }
  for (const [name] of parsed.searchParams) {
    if (!UNDERSTOOD_PARAMETERS.has(name)) {
      return {
        allowed: false,
        reason:
          "the resolved connection carries a query parameter this interlock does not understand, so it cannot account for what the client would do with it. Refusing. The parameter name is deliberately not printed here.",
      };
    }
  }

  // THE DATABASE NAME, which is the third thing that decides which data a
  // write lands on and was not compared at all before this round.
  const database = parsed.pathname.replace(/^\//, "");
  if (database !== EXPECTED_DATABASE) {
    return {
      allowed: false,
      reason: `the resolved connection names a database other than "${EXPECTED_DATABASE}", which is the only database this product uses. Refusing.`,
    };
  }

  if (normaliseHost(parsed.hostname) !== normaliseHost(expectedHost)) {
    return {
      allowed: false,
      reason:
        "the resolved connection's host is not the host given on the command line. Refusing. The resolved value is deliberately not printed here.",
    };
  }

  const usernameRef = projectRefFromUsername(parsed.username);
  const hostRef = projectRefFromHost(parsed.hostname);
  if (usernameRef === undefined && hostRef === undefined) {
    return {
      allowed: false,
      reason:
        "the resolved connection carries no project ref in its username and none in its host, so it matches neither endpoint shape this interlock understands. Refusing as unparseable.",
    };
  }

  const wanted = expectedRef.trim();
  if (usernameRef !== undefined && usernameRef !== wanted) {
    return {
      allowed: false,
      reason:
        "the project ref in the resolved connection's username is not the ref given on the command line. Refusing. The resolved value is deliberately not printed here.",
    };
  }
  if (hostRef !== undefined && hostRef !== wanted) {
    return {
      allowed: false,
      reason:
        "the project ref in the resolved connection's host is not the ref given on the command line. Refusing. The resolved value is deliberately not printed here.",
    };
  }

  // THE CONFIRMATION NAMES WHAT THE OPERATOR GAVE, never anything resolved.
  return {
    allowed: true,
    reason: `target confirmed against the host and project ref given on the command line (ref ${wanted})`,
  };
};
