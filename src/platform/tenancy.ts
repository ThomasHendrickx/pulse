// The tenancy backbone. The tenant is the household, never the user.
// The household context is resolved ONCE at the server action or route
// boundary (src/platform/auth/context.ts) and passed explicitly into use
// cases and repositories. No ambient context, no globals, no session reads
// inside a query builder.
//
// WHAT THE STATIC GATE ENFORCES, exactly (test/schema/tenancy.test.ts,
// fail closed since fix round 1): a file under src/modules that imports the
// database client (@prisma/client or platform/db/client) must live in an
// adapters/ directory, and in such files, plus any adapters file whose name
// contains "repositor", every exported value must be a function declaring a
// parameter typed exactly HouseholdContext; export shapes the analyzer
// cannot positively verify (object literals, wrapped factories, classes,
// enums, default exports, re-exports) are violations. NOT enforced
// statically: call sites, and a repository that receives its database
// client by injection from a file whose name does not say repository; those
// stay review territory. This paragraph corrects an earlier version that
// claimed blanket enforcement while the analyzer inspected only two export
// shapes (finding CR-003 of the M1-P1 clean-room reviews); the earlier
// sentence overstated the gate and is replaced rather than silently
// deleted.

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type HouseholdId = Brand<string, "HouseholdId">;
export type UserId = Brand<string, "UserId">;

export const householdId = (value: string): HouseholdId => value as HouseholdId;
export const userId = (value: string): UserId => value as UserId;

export type HouseholdContext = {
  readonly householdId: HouseholdId;
  readonly userId: UserId;
};
