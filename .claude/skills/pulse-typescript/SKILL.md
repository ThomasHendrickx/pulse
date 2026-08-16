---
name: pulse-typescript
description: TypeScript conventions for Pulse: how money, dates and identifiers are typed, branded types, discriminated unions for results and errors, where validation happens, how to avoid any and unsafe casts, naming, module exports, and how tests are structured across the fast gate and the Playwright gate. Read this before writing or changing any TypeScript, defining a type or interface, handling an error, parsing external input, or adding a test. Pay particular attention before typing anything that holds an amount or a date, because Pulse has strict rules there that prevent a whole class of silent financial bugs.
---

# Pulse TypeScript

## 1. Money

**Amounts are integer cents, always, as a branded type.**

```ts
export type Cents = number & { readonly __brand: "Cents" };

export const cents = (n: number): Cents => {
  if (!Number.isInteger(n)) throw new Error(`Amount must be integer cents, got ${n}`);
  return n as Cents;
};
```

Rules:

- Never a float for money. Never `parseFloat` on an amount and store the result.
- Never `Prisma.Decimal` in domain code. Convert at the repository boundary.
- Arithmetic on `Cents` only. A function taking `number` where it means an amount is a bug.
- Conversion to a display string happens only in the rendering layer, and only through the shared formatter.
- Sign convention: negative is money leaving the pot, positive is money entering. This holds everywhere, including inside `RESERVE` movements, where negative means parked and positive means drawn down.

## 2. Dates

Two distinct concepts, never interchangeable:

- **Business dates** (booking date, value date, the month being viewed) are calendar dates with no time and no zone. Type them as a branded `PlainDate` string in `YYYY-MM-DD`, not as `Date`.
- **Instants** (created at, imported at) are true timestamps and use `Date`.

Never construct a business date from a `Date` via the local timezone. A booking date parsed as a `Date` in Brussels and read back in UTC shifts a transaction into the previous month, which silently moves money between reporting periods.

Never call `new Date()` in domain code. Take the `Clock` port. Tests use a fixed clock.

## 3. Identifiers

Branded per entity, so an account id cannot be passed where a transaction id is expected.

```ts
type Brand<T, B extends string> = T & { readonly __brand: B };
export type HouseholdId = Brand<string, "HouseholdId">;
export type AccountId = Brand<string, "AccountId">;
export type TransactionId = Brand<string, "TransactionId">;
```

This matters more than usual here because `householdId` is threaded through every signature, and a mixed-up id is a cross-tenant read.

## 4. Types over comments

Make illegal states unrepresentable rather than documenting that they must not happen.

- Discriminated unions for anything with modes. `SourceProfile["amountRepresentation"]` is a union of `{ kind: "signed", column }`, `{ kind: "debitCredit", debitColumn, creditColumn }`, `{ kind: "indicator", amountColumn, indicatorColumn, debitValue }`. Not three optional fields.
- `Transaction["flow"]` is a union, never a string.
- Exhaustive switches with a `never` default:

```ts
const assertNever = (x: never): never => {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
};
```

An exhaustive switch is how the compiler tells you every place that needs updating when a flow value is added.

## 5. Errors and results

**Expected failures are values, unexpected failures are exceptions.**

```ts
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

Expected, so a `Result`: a file that fails to parse, a profile that produces unparseable dates, an import containing more than one account, a merchant that cannot be resolved, books that do not reconcile.

Unexpected, so throw: a missing environment variable, a broken database connection, a violated invariant that indicates a bug.

Error types are unions of tagged objects with the data needed to render a message, not strings. The UI decides the wording, in three languages. An error carrying an English sentence cannot be translated.

## 6. External input

Everything crossing a boundary is validated at the boundary with a schema, then flows inward as a domain type. Boundaries are: uploaded files, form and server action input, the Claude API response, environment variables.

- Never `as` to assert the shape of external data. Parse it.
- Domain functions receive validated domain types and never re-validate.
- `any` is banned. `unknown` at a boundary followed by parsing is correct.
- Non-null assertion `!` is banned except in tests.

Environment variables are parsed once at startup into a typed config object. No `process.env` anywhere else.

## 7. Structure and naming

- Named exports only, except Next.js pages and layouts which must be default exports.
- One concept per file. A module's `domain` folder is many small pure files.
- `index.ts` in `application/` is the module's published interface. Other modules import only from there. Nothing else in a module is importable across module boundaries.
- Names say what a thing is in domain language: `classifyFlow`, `pairInternalTransfers`, `normaliseCounterparty`, `resolveSourceProfile`. Not `processData`, `handleItems`, `utils`.
- No `utils.ts`. If a function has no home, the module boundaries are wrong.
- British or American spelling: pick American in code identifiers for consistency with library ecosystems, and stay consistent.

## 8. Tests

Two gates, and knowing which one a test belongs in matters.

**Fast gate**, `npm test`, runs every iteration, seconds:

- Pure domain unit tests. No database, no HTTP, no mocks of things you own.
- Property tests for the reconciliation invariant over generated datasets.
- Profile detection tests over synthetic files covering each delimiter, date format, decimal style and amount representation.

**Slow gate**, `npm run test:e2e`, runs at slice completion:

- Playwright golden journey: sign in, upload a file, declare the account, confirm the detected profile, upload a second account's file containing the other leg of a transfer, open the month view, assert the totals and that reconciliation reads zero.

Rules:

- Test behaviour, not implementation. A test that breaks when a function is renamed but nothing changed is a liability.
- Never mock a module you own to make its test pass. Use the real domain function.
- The Claude resolver is a fake adapter behind its port in every test. No test ever calls the API.
- Determinism is mandatory: fixed clock, seeded household, committed synthetic fixtures, database reset per run. A flaky test in an agent loop costs many wasted iterations.
- Each of the four flow corrections (card settlement, reserve drawdown, refunds, cash withdrawals) has its own named test. These are the bugs that matter.

## 9. Compiler settings

`strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`. `npm run typecheck` is `tsc --noEmit` and must pass with zero errors. Never suppress with `@ts-expect-error` without a comment naming the reason and a follow-up.
