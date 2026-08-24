---
name: pulse-domain
description: The Pulse financial domain model and the DDD practice this codebase follows. Covers the pot and reserves rings, flow classification, transfer pairing, the facts versus interpretation split, source profiles, merchant resolution, the reconciliation invariant, module boundaries and where business logic is allowed to live. Read this before writing or changing anything involving accounts, imports, transactions, amounts, merchants, tags, classification, recompute, module structure or database schema. Also read it before adding a Prisma model or writing any query that aggregates money, because most bugs in this codebase are domain modelling errors that typecheck cleanly.
---

# Pulse domain

Read this fully before writing domain code. The rules here are not style preferences. Breaking them produces numbers that are wrong in ways the type system cannot catch, which is the only failure mode that matters in this product.

## 1. The three rings

Every euro sits in one of three places, and every rule below depends on knowing which.

| Ring | Accounts | Meaning |
|---|---|---|
| **Pot** | Current accounts, cards | Where income lands and spend happens. The overview is about this |
| **Reserves** | Savings, investments | Still the household's money, but not money movement. Parked, not spent |
| **Outside** | Everyone else | Merchants, employers, anyone who is not the household |

`Account.role` is `POT` or `RESERVE`. The user declares it at first sight. Never infer it, never guess it from the account name, never default it.

**CORRECTED, NOT QUIETLY REWRITTEN (DR-0030, owner, 2026-08-24).** This
paragraph used to say that reserve accounts are registered for their account
number only, that their statements are not imported in v1, and that a reserve
movement is classified entirely from the pot side. The first clause is now
only half true and the second is FALSE. It is corrected in place rather than
deleted, because this file is always in context and a reader who met the old
sentence needs to know it changed rather than to wonder whether they imagined
it.

**Pulse ACCEPTS a reserve account's own statement.** The owner's deciding
argument was the opening balance: a savings figure derived only from
transfers is a running sum from an assumed zero, and is therefore wrong by
the household's existing savings unless that account started empty. A
statement is the one document that arrives CHECKED rather than typed, because
the balance contract already makes opening plus rows equal closing a hard
per-file gate. It also carries the two things a transfer can never show: the
interest a savings account earns, which has no matching row on any pot
account, and a movement between two reserve accounts, which touches no pot
account at all.

**A reserve account's own rows are HELD.** Ingested as facts, classified by
nothing, entering no month total, offered for no naming, and NOT an
uninterpreted gap. Held is derived from the account's RING and is not a new
`Flow` member: the absence of a flow already means the row was not
interpreted, and what tells a held row from a genuinely uninterpreted one is
which ring its account sits in. Every read that can see a row with no flow
therefore carries a ring predicate, and the month view NAMES each account
that put rows in the period with whether those rows were counted or held, in
all three languages, so a reader can tell held from missing and held from
uninterpreted.

A reserve account can still be REGISTERED by its account number alone,
without a statement, and a reserve movement seen from the pot side is still
classified from the pot side. What has changed is that the reserve
statement is no longer refused.

The reserves block on the month view is a MOVEMENT IN THE MONTH and never a
balance. No figure in v1 is accumulated across months; a heading that read as
an amount held would be inventing exactly the number this decision rejected.

## 2. Facts versus interpretation

This is the spine of the codebase.

| Layer | Contents | Written by | Rebuildable |
|---|---|---|---|
| **Facts** | `Import`, `Transaction` raw fields | Import only, append only | No |
| **Declarations** | `Account.role` and label, `SourceProfile`, `MerchantRule`, `MerchantTag`, `Tag` | The user, explicitly | No |
| **Interpretation** | `Transaction.merchantId`, `Transaction.flow`, `Transaction.pairedTransactionId`, `Merchant` | The engine | Yes, entirely |
| **Projection** | The month overview | Nobody, computed per request | Yes |

**The test for any change: could you delete every interpretation value in the database and rebuild it correctly from facts plus declarations?** If not, the change is wrong.

Three rules follow, and they are absolute.

1. **Never update a raw transaction field to fix a classification.** Fix the rule, then recompute.
2. **A user correction is written as a declaration, never as a row edit.** When the user renames a counterparty, write a `MerchantRule`, do not set `merchantId` on one transaction. A correction that applies to one row teaches the system nothing and will be silently undone by the next recompute.
3. **Recompute never writes to the declarations layer.** If a code path in interpretation writes a `MerchantRule`, that is a bug, even when it looks like caching.

### The one exception, handled explicitly

`SourceProfile` is a declaration but it shapes the **facts**, because it decides how a raw line is parsed. A wrong profile writes wrong dates or inverted amounts into the ledger, and no recompute fixes that.

So every `Transaction` stores `rawLine`, the source text it was parsed from. Fixing a profile triggers a **re-parse** of affected imports from stored raw lines. Re-parse and recompute are different operations. Do not conflate them.

## 3. Flow

`Transaction.flow` is the field the whole overview hangs on.

| Value | Meaning | Counted as |
|---|---|---|
| `INCOME` | Entering the pot from outside | Income side |
| `SPEND` | Leaving the pot to outside | Spend side |
| `INTERNAL` | Between two pot accounts | Neither, excluded from both |
| `RESERVE` | Between the pot and a reserve account | Reserves block, signed |
| `UNRESOLVED` | Cannot be classified | Shown as a visible gap |

Classification order, deterministic, against user-declared sets:

1. Counterparty account is in the declared reserve set, so `RESERVE`, signed by direction.
2. Counterparty account is in the declared pot set, so `INTERNAL`.
3. Otherwise sign decides: negative is `SPEND`, positive is `INCOME`.
4. Then apply the corrections below.

**`UNRESOLVED` is never silently dropped or defaulted to `SPEND`.** A gap the user can see is safe. A gap absorbed into a total is the failure this product exists to avoid.

### The four corrections

These are the actual bugs. Each has a named test.

| Correction | Rule | What breaks without it |
|---|---|---|
| **Card settlement** | The direct debit paying a card is `INTERNAL`, because the card is a pot account. The card's own line items are the spend | Every month double counts card spending |
| **Reserve drawdown** | Money from a reserve account into the pot is a signed `RESERVE` movement, never `INCOME` | Income spikes by thousands the month something is funded from savings |
| **Refunds** | Incoming from a counterparty with outgoing history is `SPEND` with a positive amount, never `INCOME` | The income side fills with noise and merchant totals overstate |
| **Cash withdrawals** | Own destination, "cash". Never split, never guessed at | Invented data |

## 4. Transfer pairing

The only algorithm here with real edge cases. It must be deterministic, order-independent and idempotent.

A candidate pair requires all of:

1. Both legs in pot accounts of the same household, different accounts.
2. Amounts exactly opposite.
3. Booking dates within a tolerance window, default 4 days.
4. Each leg's counterparty account matches the other leg's account.

Where several candidates fit: match by smallest date difference, then by lowest transaction id. Never by insertion order, never by whatever the database returns first. **Re-running pairing over the same data must produce an identical set of pairs.**

**Interpretation runs over a period window across all pot accounts, not over the rows just imported.** The second leg of a transfer usually arrives in a different file. Scope pairing to the import and unmatched legs stay wrong forever; scope it to the window and they heal on the next upload.

An unmatched leg whose counterparty is a declared pot account stays `INTERNAL` and excluded, and is surfaced in the reconciliation panel. It is a known state, not an error.

Reserve movements are never paired. The other leg is not imported.

## 5. Source profiles

There are no per-bank parsers. One generic delimited-file parser driven by a `SourceProfile` the user declares once and names.

A profile carries format, not just column positions:

| Field | Why it exists |
|---|---|
| Delimiter, encoding | `;` with Windows-1252 is common in Belgium |
| Header row index | Preamble junk above the header is common |
| Date format | `DD/MM/YYYY`, `YYYY-MM-DD`, `DD.MM.YY` |
| Decimal style | `1.234,56` or `1234.56` |
| Amount representation | One signed column, or a debit and credit column pair, or an amount plus a D/C indicator |
| Column roles | booking date, value date, amount, counterparty name, counterparty account, description, reference, statement and sequence number |

**Amount representation is the field a naive column mapping misses, and it silently inverts every sign in a history.** Treat it as required, never inferred without confirmation.

Flow: detect deterministically from the first lines, propose, show five parsed rows as they will be stored, user confirms. Claude proposes only what detection cannot call. The confirmed profile is stored, so neither runs again for that source.

## 6. Dedup

Belgian current-account exports carry a statement number plus a sequence number, a stable natural key per account. Card exports carry no per-row sequence, so the key choice is a per-SourceProfile property: natural key where the profile has one, content hash otherwise. The hash is over `accountId + bookingDate + amount + normalisedCounterparty + reference` PLUS the occurrence ordinal of the row among identical-content rows within the same file. The ordinal is not optional: two legitimate identical rows (same day, same amount, same merchant, observed in a real card statement) collapse into one under duplicate skipping without it, silently dropping a fact row while the books still close. With it, re-uploading the same file maps each row to the same key and adds nothing, and across overlapping imports the insert-ignore keeps, per identical tuple, the highest occurrence count seen. (This paragraph previously taught the ordinal-free hash; that recipe was refuted by a real statement and is corrected here rather than silently rewritten. See finding PR-001 and the owner's v0.2 addendum section 5.)

Store the key, unique index it per household, insert with duplicates skipped. Re-uploading an overlapping file is a normal operation that reports rows added and rows already known. Never a read-then-write loop.

One file is one account. A file containing rows from more than one account fails the whole import and writes nothing.

## 7. Merchant resolution

A chain behind one port, first confident answer wins:

1. Exact match on normalised counterparty string, from `MerchantRule`.
2. Prefix and pattern match, from `MerchantRule`.
3. Claude, batched, slice 5 onward.
4. Unresolved.

Normalise before matching: uppercase, strip payment terminal noise, strip city and date fragments, collapse whitespace. Much of what looks like a matching problem is dirty strings that normalise identically.

The Claude call takes **distinct unresolved strings** for an import, not transactions. Thirty new merchants across four hundred rows is one call with thirty items. Below-threshold answers go to the review queue, never into the numbers.

Every accepted answer becomes a `MerchantRule`. That is what makes the second month nearly free.

Tags hang off the merchant, not the transaction, many-to-many with one `isPrimary`.

## 8. The reconciliation invariant

```
income - spend - netToReserves === changeInPot
```

Exact, in integer cents, zero tolerance. This is the highest-leverage test in the project: it catches double counting, sign errors, the card settlement trap and broken pairing in one assertion.

It is a **property test over generated datasets** in the fast gate. Never implement it as a browser test.

When it fails at runtime, the overview shows the difference and names the likely cause. It is not hidden, and it is not rounded away.

## 9. DDD practice here

Vertical slices. Modules: `accounts`, `import`, `ledger`, `merchants`, `overview`, plus `platform`.

```
modules/<name>/
  domain/          pure functions and types, imports nothing outside the module
  application/     use cases, depend on port interfaces only
  adapters/        Prisma repository, LLM client, file parsers
  ui/              server components, server actions
```

**Dependency rule:** `domain` imports nothing. `application` imports `domain` and ports. `adapters` implement ports. UI calls application. Cross-module calls go through the neighbour's published application interface, never its repository and never its tables. One Postgres does not mean one blob of queries.

**Business logic lives in `domain` as pure functions.** Classification, pairing, normalisation, the reconciliation calculation: all pure, all testable without a database. If a rule needs a database to test, it is in the wrong place.

Ports that exist: `StatementParser`, `MerchantResolver`, `TransactionRepository`, `Clock`. Do not invent more ports speculatively. A port earns its place when there is a second adapter or a test fake.

Prisma specifics:

- Schema folder layout, one file per module, so the module owning a table owns its schema.
- A Prisma client extension injecting `householdId` is the backstop. Repositories still take the household context as an explicit argument. Never read the session inside a repository.
- Prisma is weak at set-based work. Recompute and the overview aggregations use raw SQL inside the repository, deliberately.

## 10. Tenancy

`householdId` is non-null on every table except `Household`.

The household context is resolved once at the server action or route boundary and passed explicitly into use cases and repositories. No ambient context, no globals, no session reads deep in a query builder.

Postgres RLS is a backstop, not the mechanism. If RLS is the only thing preventing a cross-tenant read, one missing policy on a new table is a silent data leak.

The tenant is the household, not the user. Never key a table on `userId`.
