// READ-ONLY detection of canonical account-number collisions (M3-P18,
// criterion 18.5; review findings P14-001 and P17-009, and the round-2
// review findings R2-M3P18-01 and R2-M3P18-02 carried into the
// implementer's brief).
//
// WHAT IT ANSWERS. The canonical backfill migration
// (prisma/schema/migrations/20260827120000_canonical_account_iban_backfill)
// leaves untouched every pair of Account rows in one household that would
// share one canonical form, because rewriting either member makes the
// unique index fire mid-deploy or silently decides which row future
// imports land on. The migration runs under `npx prisma migrate deploy`,
// which surfaces no output this repository may point at, so THE NAMING
// LIVES HERE: one run of this script lists every such group, by row id
// and NOTHING ELSE. The post-deploy check for the parked merge is one run
// of this script against the deployed target, AND THAT RUN IS NOT
// OPTIONAL (M3-P18 fix round, hazard finding HZ-M3P18-04): with the
// savings-ring refusal removed under DR-0030, a rings-disagreeing pair
// no longer surfaces as a named refusal at upload. Its statements land
// deterministically on the member whose stored form equals the canonical
// probe and, where that member sits in the savings ring, they are
// silently HELD: counted nowhere, flagged as no gap (the uninterpreted
// count is pot-scoped by design), visible only as a held block naming
// the savings-ring registration under the other row's label. This
// script's output is the one signal that names such a pair, so it is run
// after the backfill deploys, not merely available.
//
// THE SELECTION IS A GROUPING, NOT A NOT-CANONICAL FILTER (finding
// R2-M3P18-01): it groups ALL of a household's rows by the canonical form
// of their stored number and emits every group of two or more. That is
// the only selection that emits BOTH members of a pair whose compact
// member is already stored canonically; "rows whose stored form is not
// canonical" can never emit a complete pair.
//
// OUTPUT CONTRACT. One line per collision group on stdout: the group's
// row ids, space separated, ordered. NO account number, no label, no
// household name reaches stdout or stderr: this repository is public and
// row ids identify without disclosing. Operator prose goes to stderr.
//
// READ-ONLY AND ITS AUTHORITY, stated per the destructive-authority
// clause: this command DESTROYS NOTHING and refuses nothing but its
// database target; it issues exactly one SELECT. It therefore does not
// join the destructiveCommands registry (this repository has none; the
// db guard's contract note in src/platform/db/guard.ts is the sibling
// record for destructive entry points).
//
// GUARD WIRING (finding R2-M3P18-02): the SURVIVING contract of
// criterion 12.23 ONLY. The target is resolved through
// src/platform/db/resolve-env.ts (resolveClientDbUrl: process.env only,
// exactly what `new PrismaClient()` will open), and admission is
// assessNonProductionDbTarget from src/platform/db/guard.ts with its
// PULSE_ALLOW_REMOTE_DB_IN_DEV hatch. NOTHING is imported from
// target-guard.ts, runtime-target.ts, gate-target.ts or
// connection-string.ts: those modules were withdrawn by decision D-62 and
// no longer exist; the rederive precedent is cited for this script's
// read-only shape and committed home, not for its (pre-withdrawal)
// interlock wiring. The deliberate deployed run is:
//
//   PULSE_ALLOW_REMOTE_DB_IN_DEV=1 DATABASE_URL=<target> \
//     npx tsx scripts/detect-account-collisions.ts
//
// Exit codes: 0 the run completed (collision lines, possibly none, are
// the answer); 2 the target was refused; 1 the query failed.

import { PrismaClient } from "@prisma/client";
import { ACCOUNT_NUMBER_SQL_WHITESPACE_CLASS } from "../src/platform/account-number";
import { assessNonProductionDbTarget } from "../src/platform/db/guard";
import { resolveClientDbUrl } from "../src/platform/db/resolve-env";

export type CollisionGroup = {
  // Row ids of one household's accounts sharing one canonical form,
  // ordered. Always two or more.
  readonly ids: readonly string[];
};

// The grouping, over the SAME SQL mirror of canonicalAccountNumber the
// migration uses: uppercase, every character of the ONE shared
// whitespace class removed. CORRECTED IN THE M3-P18 FIX ROUND (hazard
// finding HZ-M3P18-01, clause R-087), superseded wording quoted: this
// comment used to read "every [[:space:]] removed; the POSIX class on
// purpose", and that class retains U+00A0, U+202F and U+FEFF where
// JavaScript's \s strips them, so a pair the application layer treats as
// ONE account (an NBSP-spaced rendering beside its compact twin) was two
// unrelated rows to this grouping and the post-deploy check reported no
// collision. CORRECTED AGAIN IN FIX ROUND TWO: the first correction kept
// the POSIX class and bolted the missing escapes onto it, which left this
// grouping's membership owned by the DEPLOYED CLUSTER'S ctype rather than
// by the committed text, so the groups this script emits could differ
// between the cluster a test reaches and the cluster an operator runs it
// against. The class now enumerates code points and names no POSIX class
// (the rule, and the measurements behind it, are at
// src/platform/account-number.ts), and a fast-gate test asserts this
// script's comment-stripped code carries no POSIX class in any spelling.
//
// The class comes from ACCOUNT_NUMBER_SQL_WHITESPACE_CLASS at the
// mechanism's definition, passed as a BIND PARAMETER (a regexp pattern is
// an ordinary string argument, so binding is safe and keeps exactly one
// copy in importable code). The canonical form itself is grouped on and
// never selected, so no account-shaped value can reach the output.
export const detectAccountCollisions = async (
  client: PrismaClient,
): Promise<readonly CollisionGroup[]> => {
  const rows = await client.$queryRaw<readonly { ids: readonly string[] }[]>`
    SELECT array_agg(a."id"::text ORDER BY a."id") AS "ids"
    FROM "accounts" a
    WHERE a."iban" IS NOT NULL
    GROUP BY a."householdId", upper(regexp_replace(a."iban", ${ACCOUNT_NUMBER_SQL_WHITESPACE_CLASS}, '', 'g'))
    HAVING count(*) > 1
    ORDER BY 1
  `;
  return rows.map((row) => ({ ids: row.ids }));
};

// One line per group, row ids space separated: the exact stdout contract
// criterion 18.5 asserts. Exported so the slow-gate spec pins the format
// it asserts against the function that produces it.
export const formatCollisionGroups = (
  groups: readonly CollisionGroup[],
): string => groups.map((group) => group.ids.join(" ")).join("\n");

const main = async (): Promise<number> => {
  const verdict = assessNonProductionDbTarget({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    PULSE_ALLOW_REMOTE_DB_IN_DEV: process.env.PULSE_ALLOW_REMOTE_DB_IN_DEV,
  });
  if (!verdict.allowed) {
    console.error(`detect-account-collisions: ${verdict.reason}`);
    return 2;
  }
  // THE STRING THE CLIENT WILL OPEN, not the one the Prisma CLI would
  // resolve: new PrismaClient() reads process.env only, so the guard
  // above and this construction read the same value by construction.
  const databaseUrl = resolveClientDbUrl();
  const client =
    databaseUrl === undefined
      ? new PrismaClient()
      : new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const groups = await detectAccountCollisions(client);
    if (groups.length > 0) {
      console.log(formatCollisionGroups(groups));
    }
    console.error(
      `detect-account-collisions: ${groups.length} collision group(s). Each stdout line is one group's row ids; the stored numbers are deliberately not printed.`,
    );
    return 0;
  } finally {
    await client.$disconnect();
  }
};

// RUN ONLY WHEN THIS FILE IS THE ENTRY POINT, the same seam as
// scripts/rederive-merchant-rules.ts: the query and formatter are exported
// for the slow-gate spec, and importing them must not start a run against
// the importing process's environment.
const invokedDirectly =
  process.argv[1] !== undefined &&
  /detect-account-collisions\.[cm]?ts$/.test(process.argv[1]);

if (invokedDirectly) {
  void main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      // The message is deliberately not printed: a database error can
      // quote a failing row, and this repository is public. Kind and code
      // are what an operator needs to decide whether to re-run.
      const kind = error instanceof Error ? error.constructor.name : typeof error;
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "none";
      console.error(
        `detect-account-collisions: the run failed. error kind ${kind}, code ${code}. The run is read-only; nothing was written.`,
      );
      process.exitCode = 1;
    },
  );
}
