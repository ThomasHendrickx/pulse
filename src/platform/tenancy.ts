// The tenancy backbone. The tenant is the household, never the user.
// The household context is resolved ONCE at the server action or route
// boundary (src/platform/auth/context.ts) and passed explicitly into use
// cases and repositories. No ambient context, no globals, no session reads
// inside a query builder. Every exported repository function in
// src/modules/**/adapters must declare a parameter of type HouseholdContext;
// test/schema/tenancy.test.ts enforces that statically.

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type HouseholdId = Brand<string, "HouseholdId">;
export type UserId = Brand<string, "UserId">;

export const householdId = (value: string): HouseholdId => value as HouseholdId;
export const userId = (value: string): UserId => value as UserId;

export type HouseholdContext = {
  readonly householdId: HouseholdId;
  readonly userId: UserId;
};
