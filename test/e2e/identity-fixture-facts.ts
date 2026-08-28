// The identity fixture's own invented values, re-exported for the e2e
// project. The Playwright project compiles test/e2e/ only, and the fixture
// generator imports from src/ through the "@/" alias that the e2e tsconfig
// does not resolve, so the values are restated HERE rather than imported
// from test/fixtures/generate-pdf-fixtures.ts.
//
// THEY ARE PINNED AGAINST THAT GENERATOR by a fast-gate test
// (test/domain/identity-on-review.test.ts asserts this file agrees with it),
// so a change to the fixture reddens rather than silently diverging.
// Every value is INVENTED and listed with its provenance in
// test/fixtures/allowed-identifiers.txt.

export const ACCOUNT_NAMESPACE = "account:";

export const IDENTITY_FIXTURE_ACCOUNTS = {
  own: "BE31111122223333",
  counterparty1: "BE78222233334444",
} as const;
