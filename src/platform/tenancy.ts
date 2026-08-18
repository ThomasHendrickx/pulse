// The tenancy backbone. The tenant is the household, never the user.
// The household context is resolved ONCE at the server action or route
// boundary (src/platform/auth/context.ts) and passed explicitly into use
// cases and repositories. No ambient context, no globals, no session reads
// inside a query builder.
//
// WHAT THE STATIC GATE ENFORCES, exactly (test/schema/tenancy.test.ts,
// fail closed since fix round 1, widened for finding CR-007): a file under
// src/modules whose SOURCE TEXT names the database client module
// (@prisma/client or platform/db/client), through any form including
// dynamic import and import-equals, must live in an adapters/ directory;
// in such files, plus any adapters file whose name contains "repositor",
// every exported value must be a function declaring a parameter typed
// exactly HouseholdContext, and every exported statement kind the analyzer
// has no positive arm for (object literals, wrapped factories, classes,
// enums, namespaces, default exports, re-exports, exported import-equals,
// future syntax) is a violation by default. NOT enforced statically: call
// sites; a repository that receives its database client by injection from
// a file whose name does not say repository; and client access laundered
// through an alias module whose own specifier does not name the client.
// Those stay review territory. This paragraph has been corrected twice
// rather than silently rewritten: the original claimed blanket enforcement
// while the analyzer inspected only two export shapes (finding CR-003 of
// the M1-P1 clean-room reviews), and the first correction still claimed
// unverifiable shapes were violations while dynamic import, import-equals
// and exported namespaces escaped unseen (finding CR-007).

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type HouseholdId = Brand<string, "HouseholdId">;
export type UserId = Brand<string, "UserId">;

export const householdId = (value: string): HouseholdId => value as HouseholdId;
export const userId = (value: string): UserId => value as UserId;

export type HouseholdContext = {
  readonly householdId: HouseholdId;
  readonly userId: UserId;
};
