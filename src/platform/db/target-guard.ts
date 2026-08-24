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

// THE QUERY THIS INTERLOCK REFUSES lives in ./connection-string and is
// shared with the gate interlock (fix round five, CRITERIA finding
// CR5-M3P12-03). It used to live here, and the gate guard added in fix round
// four did not have it, so two guards in one tree disagreed about the same
// attack. Nothing about the rules changed in the move.

// The only database this product uses. Checked because the module's own
// question is whether the migration is pointed at the ONE database an
// operator named, and a string differing only in its database name was
// approved before this (finding CR3-M3P12-08).
import { assessConnectionQuery } from "./connection-string";

const EXPECTED_DATABASE = "postgres";

// THE PORT THIS INTERLOCK ADMITS WITHOUT BEING TOLD (fix round four, hazard
// finding CR4-M3P12-02; DECIDED in fix round five, hazard finding HAZ5-2).
//
// Round four added a port comparison and then admitted BOTH 5432 and 6543
// when the operator named neither, which left untouched the exact ambiguity
// the finding was raised to force a decision on. This is the decision.
//
// UNNAMED, THE PORT MUST BE 5432. That is the session-pooler and direct
// endpoint: one client connection is one server connection for as long as the
// client holds it. This routine's write path is an interactive multi
// statement transaction issued through applyRuleWrites, and criterion 12.7's
// whole guarantee, that a blocked or failed run leaves the table as it found
// it, rests on that transaction being atomic.
//
// 6543 IS REACHABLE, BY NAMING IT. `.env.example` documents 6543 as this
// product's own deployed DATABASE_URL, so a deployment where that is the
// right endpoint is expected rather than hypothetical, and an operator who
// means to migrate over the transaction pooler passes --expect-port 6543 and
// gets it. What they no longer get is that connection SILENTLY, from an
// invocation that named only the two required arguments. The whole module is
// built on refusing what it cannot account for, and "which pooling mode am I
// in" is not something a host and a project ref can answer.
const DEFAULT_PORT = "5432";

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
  // OPTIONAL, unlike the two above, and the asymmetry is deliberate. An
  // unnamed port is not an unchecked one: it must be one of the two this
  // product uses, so the arbitrary port is refused either way. Naming it
  // narrows the check to an exact match, which is what an operator who cares
  // about pooling mode wants. Making it a third REQUIRED argument would
  // change the invocation criterion 12.23 documents, for a field that cannot
  // reach a different project on its own.
  readonly port?: string | undefined;
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
  const query = assessConnectionQuery(parsed);
  if (!query.allowed) {
    return { allowed: false, reason: query.reason };
  }

  // THE PORT, the last field of the endpoint the client resolves. An ABSENT
  // port is the connector's own default and is read as that (fix round five,
  // CRITERIA finding CR5-M3P12-09): before this, a portless string was
  // unapprovable and the refusal told the operator to pass --expect-port,
  // which then refused again because the exact comparison could not match an
  // empty string. A refusal that advises something that cannot work is worse
  // than a refusal that says the shape is not allowed.
  const port = parsed.port === "" ? DEFAULT_PORT : parsed.port;
  if (expectation.port !== undefined && expectation.port !== "") {
    if (port !== expectation.port) {
      return {
        allowed: false,
        reason:
          "the resolved connection's port is not the port given on the command line. Refusing. The resolved value is deliberately not printed here.",
      };
    }
  } else if (port !== DEFAULT_PORT) {
    return {
      allowed: false,
      reason: `the resolved connection is not on port ${DEFAULT_PORT}, and no port was given on the command line. Refusing: ${DEFAULT_PORT} is the endpoint where one client connection is one server connection, which is what this routine's single interactive transaction depends on. Pass --expect-port to name a different one deliberately.`,
    };
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
