// WHAT A POSTGRES CONNECTION STRING CAN CARRY BESIDES AN AUTHORITY, in ONE
// place (M3-P12 fix round five, CRITERIA finding CR5-M3P12-03).
//
// WHY THIS FILE EXISTS. Fix round three established, with a witness, that a
// connection string is a document rather than two fields: a string whose
// hostname and username were byte-identical to an approved one could redirect
// the client elsewhere through a query parameter, and the re-derivation's
// interlock was taught to refuse that by name. Fix round four then added a
// SECOND interlock, for the Playwright gate, which decides "is this a local
// stack" from the hostname alone and consults no parameter at all. Two guards
// in one tree disagreeing about the same attack is worse than either being
// wrong on its own, because the tree looks defended and the reader has to
// find out which half is real.
//
// So the rules live here and both interlocks call them. This is the same move
// LOCAL_DB_HOSTS already made, for the same reason: one list, not two that
// agree until somebody edits one.
//
// THE THREE RULES, and each is about WHERE a write lands rather than how the
// connection is made:
//
//   `?host=` NAMES A UNIX SOCKET DIRECTORY and the connector opens THAT,
//   ignoring the authority's hostname entirely. Witnessed in fix round three
//   against the shipped client.
//
//   ANY PARAMETER THIS MODULE DOES NOT UNDERSTAND is refused rather than
//   ignored, because it cannot say what the client would do with it. The four
//   admitted names are the ones this codebase's own connection strings use.
//
//   `schema=` selects the search path, so an approved project, host and
//   database can still be entered at a schema nobody named. Every occurrence
//   is checked, not the first: a duplicated parameter is resolved by the
//   connector and not by us, and reading one of two values is how a
//   comparison gets walked past. `pgbouncer`, `sslmode` and `connection_limit`
//   change HOW the connection is made and not WHERE it lands, so their values
//   are deliberately free; that distinction is the point of the split.
//
// NO VALUE IS EVER PRINTED in a refusal. This repository is public.

export type ConnectionQueryVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

const UNDERSTOOD_PARAMETERS: ReadonlySet<string> = new Set([
  "pgbouncer",
  "sslmode",
  "connection_limit",
  "schema",
]);

// The one admitted parameter whose value decides which data a write lands on.
const EXPECTED_SCHEMA = "public";

export const assessConnectionQuery = (
  parsed: URL,
): ConnectionQueryVerdict => {
  if (parsed.searchParams.has("host")) {
    return {
      allowed: false,
      reason:
        "the resolved connection carries a host query parameter, which makes the endpoint a socket path rather than the host in the string. Refusing: a guard that compares the host cannot check a connection that does not use it.",
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
  if (
    parsed.searchParams
      .getAll("schema")
      .some((value) => value !== EXPECTED_SCHEMA)
  ) {
    return {
      allowed: false,
      reason: `the resolved connection names a schema other than "${EXPECTED_SCHEMA}", which is where this product's tables live. Refusing: an approved project, host and database can still be entered at a schema nobody named.`,
    };
  }
  return { allowed: true };
};
