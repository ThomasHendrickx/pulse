# Pulse v1: solution architecture

Companion to `pulse-v1-plan.md`. How the thing actually works.

---

## 1. The spine

One decision shapes everything else: **separate the record from the interpretation.**

A transaction as it came out of the bank is a fact. It is written once and never touched again. Which merchant it belongs to, whether it is spend or income or an internal move, which tags apply, whether it pairs with another leg: all of that is interpretation, and interpretation is derived, disposable and rebuildable.

The rule that follows: **if you cannot delete every derived value in the database and rebuild it from the facts plus the user's declarations, the model is wrong.**

What that buys, all of it things you will want within a month of using it:

- A rules improvement applies retroactively to three years of history instead of only to new imports.
- A wrong Claude answer is fixed by correcting the rule and recomputing, not by hand-editing rows.
- The reconciliation check becomes a pure function over facts, so a failing month is a bug in interpretation, never corrupted data.
- You can throw away the whole classification approach in v2 without touching the ledger.

The cost is one extra concept and a recompute path. At household volume, recompute is a few seconds over everything, so there is no incremental invalidation machinery to build. That is the whole trade, and it is a good one.

---

## 2. Layer map

| Layer | Contents | Mutable by | Rebuildable |
|---|---|---|---|
| **Facts** | `Import`, `Transaction` (raw fields), `Account` identity | Import only, append only | No, this is the source of truth |
| **Declarations** | `Account.role` and label, `MerchantRule`, `MerchantTag`, `Tag` | The user, explicitly | No, these are decisions |
| **Interpretation** | `Transaction.merchantId`, `Transaction.flow`, `TransferLink`, `Merchant` | The engine, never the user directly | Yes, entirely |
| **Projection** | Month overview | Nobody, computed on read | Yes, per request |

The important line is between declarations and interpretation. **A recompute must never destroy a user decision.** That is why a user correction is written as a `MerchantRule`, not as an edit to a transaction: the correction lives in the declaration layer, the recompute reads it, and the same correction applies to every past and future transaction that matches. Correcting one row silently teaches the system nothing, which is the failure mode of every spreadsheet you have abandoned.

**One declaration crosses the line, and it needs handling.** The `SourceProfile` is user-declared, but it shapes the facts rather than the interpretation. A wrong profile writes wrong dates or inverted amounts into the ledger itself, and no recompute will fix that. So each transaction keeps the raw source line it was parsed from, as a plain text column. Fixing a profile then triggers a re-parse of the affected imports from stored raw lines, with no re-upload and no lost interpretation. Cheap insurance, one column, and it is the difference between a mapping mistake being an annoyance and a mapping mistake meaning you start over.

---

## 3. Runtime topology

| Concern | Choice | Why |
|---|---|---|
| App | Next.js App Router, TypeScript, one deployable | No service boundary earns its keep here |
| Host | Vercel | Already in your stack, zero ops |
| Database | Postgres on Supabase | Relational data, real constraints, RLS available |
| Access | Prisma | Same as Hemma, one mental model. Raw SQL where it is weak, see below |
| Auth | Supabase Auth, email + password | Matches the prototype, trivial in Playwright. No OAuth, no magic links in v1 |
| AI | Claude API, server side only, slice 5 | One batched call per import, not one per row |
| i18n | next-intl, catalogs in /messages/{en,nl,fr}.json | Seeded from the prototype's copy deck, EN is source |
| Design reference | Prototype committed at design/reference/ | Slice 4 layout is built against it, not from prose |
| Files | Raw source line kept on each transaction, the file itself is not stored | See below |

No queue, no worker, no cron in v1. Everything runs inside the request. The one thing that could outgrow that is the Claude pass, and it is a single batched call, so it stays inside a normal function invocation. Check your plan's function time limit before slice 5 and, if it is tight, chunk the batch rather than introducing a queue.

**Prisma specifics.** Three places where the default way of using Prisma works against decisions made elsewhere in this document.

| Concern | What to do |
|---|---|
| One `schema.prisma` undermines vertical slicing | Use the schema folder layout, one file per module, so the module owning a table also owns its schema |
| Tenancy filtering by hand in every method | A Prisma client extension that injects `householdId` into every query is a better choke point than discipline. Repositories still take the context explicitly, the extension is the backstop, same relationship as RLS |
| Bulk work | Prisma is weak at set-based operations. Recompute over thousands of rows and the overview aggregations both want raw SQL. Use it deliberately in the repository, not reluctantly |

Two smaller ones. `createMany` with duplicate skipping maps directly onto the ingest idempotency rule, so dedup is one insert rather than a read-then-write loop. And on a pooled connection, migrations need the direct connection string while runtime uses the pooled one, which is the single most common way this setup breaks on first deploy.

---

## 4. Module structure

Vertical slices. Each module owns its tables, exposes an interface, and knows nothing about the internals of its neighbours.

```
src/
  modules/
    accounts/      declare and classify accounts
    import/        parse, dedup, persist facts
    ledger/        flow classification, transfer pairing, recompute
    merchants/     resolution chain, rules, tags
    overview/      the month projection
  platform/
    db/            connection, schema, migrations
    auth/          session, household context
    ui/            design system, primitives
```

Each module, same shape:

```
modules/<name>/
  domain/          pure functions and types, zero imports from outside the module
  application/     use cases, depend on ports only
  adapters/        db repository, llm client, file parsers
  ui/              server components, actions
```

**Dependency rule:** `domain` imports nothing. `application` imports `domain` and port interfaces. `adapters` implement ports. UI calls application. Cross-module calls go through the neighbour's published application interface, never its repository and never its tables. One Postgres does not mean one blob of queries.

The ports that matter:

| Port | Owner | v1 adapters | Later |
|---|---|---|---|
| `StatementParser` | import | one generic `DelimitedFileParser`, driven by a `SourceProfile` | `IbanityParser` |
| `MerchantResolver` | merchants | `RuleResolver`, `ClaudeResolver`, composed as a chain | shared dictionary |
| `TransactionRepository` | import | Drizzle | |
| `Clock` | platform | system | fixed clock in tests |

**There are no per-bank parsers.** One generic delimited-file parser, driven by a `SourceProfile` the user declares once and names ("KBC current account export"). The profile is a declaration, so it lives in the declarations layer next to `Account.role`, is reusable across accounts at the same bank, and is never touched by a recompute.

A profile is not just column roles. The per-bank pain is almost entirely in how values are written, so the profile carries all of it:

| Field | Examples |
|---|---|
| Delimiter, encoding | `;` with Windows-1252, `,` with UTF-8 |
| Header row index | Preamble junk above the header is common |
| Date format | `DD/MM/YYYY`, `YYYY-MM-DD`, `DD.MM.YY` |
| Decimal style | `1.234,56` or `1234.56` |
| Amount representation | One signed column, or a debit and credit column pair, or an amount plus a separate D/C indicator |
| Column roles | booking date, value date, amount, counterparty name, counterparty account, description, reference, statement and sequence number |

The amount representation is the field that a naive column mapping would miss, and it is the one that silently inverts every sign in a history.

**Detect, propose, confirm.** Deterministic detection reads the first lines and infers almost all of the profile: delimiter by frequency, decimal style by pattern, date format by parsing candidates against every row, amount representation by column shape. Claude is a fallback for the ones detection cannot call, never the first move. Then the user sees five parsed rows rendered as they will be stored, and confirms. That preview is the trust moment, and it is what makes it safe to hand the format question to the user at all.

This is the same chain shape as merchant resolution: deterministic first, LLM in the long tail, user confirms, and the confirmed answer is stored as data so neither runs again for that source.

---

## 5. The import pipeline

Six stages. The user is in the middle of it, on purpose.

```
file
  -> parse          StatementParser, in memory, no writes
  -> identify       account identity from the file
  -> declare        [user] first sight only: label, bank, ring
  -> ingest         dedup keys, insert facts, idempotent
  -> interpret      resolve merchants, classify flow, pair transfers
  -> project        month view on next read
```

`Import` carries an explicit status so a half-finished upload is never ambiguous:

| Status | Meaning |
|---|---|
| `PARSED` | Rows read, nothing written to the ledger |
| `AWAITING_DECLARATION` | Unknown account, waiting on the user |
| `INGESTED` | Facts written, dedup applied |
| `INTERPRETED` | Derived values current |
| `FAILED` | Nothing written, reason recorded |

**Nothing reaches the ledger before the account is known.** Parse and identify happen first, the question is asked against parsed data, and ingestion runs only after the answer. That ordering is what makes the classification question feel like part of the upload instead of a settings screen you have to visit first.

**Idempotency** sits in ingest, not in the UI. Every row gets its dedup key, the key is uniquely indexed per household, and insert ignores conflicts. Re-uploading an overlapping file is a normal, boring operation that reports how many rows were added and how many were already known. Mixed-account files fail the whole import and write nothing.

**Interpretation runs over a window, not over the import.** This is the subtle one. Pairing a transfer needs both legs, and the second leg often arrives in a different file uploaded ten minutes later. So interpretation is not scoped to the rows just ingested: it re-runs over the affected period across all pot accounts. Cheap at this scale, and it means an unmatched leg heals itself on the next upload instead of staying wrong forever.

**Recompute** is the same interpretation step with no import attached, over everything. One internal action, one button in a dev-only screen. Run it after any rules change.

---

## 6. Transfer pairing

The only algorithm in v1 with real edge cases. Deterministic, order-independent, idempotent.

Candidate pair, all conditions:

1. Both legs in pot accounts of the same household, different accounts.
2. Amounts exactly opposite.
3. Booking dates within a tolerance window (start at 4 days, bank timing is not tight).
4. Each leg's counterparty account matches the other leg's account.

Where several candidates fit, match by smallest date difference, then by lowest transaction id, so the outcome never depends on insertion order. Re-running produces the same pairs or the identical set, which is what makes recompute safe.

An outgoing leg whose counterparty is a declared pot account but which finds no partner stays `INTERNAL` and unmatched. It is excluded from both sides regardless, because the money did not leave the pot, and it is surfaced in the reconciliation panel as "waiting for the other side". Almost always it means one account's export stops earlier than another's.

Reserve movements are not paired at all, because the reserve statements are not imported. Classification from the pot side is sufficient and complete.

---

## 7. Merchant resolution

A chain of resolvers behind one port. First confident answer wins.

| Order | Resolver | Source | Confidence |
|---|---|---|---|
| 1 | Exact match on normalised counterparty string | `MerchantRule` | certain |
| 2 | Prefix and pattern match | `MerchantRule` | certain |
| 3 | Claude, batched, slice 5 | LLM | scored |
| 4 | Unresolved | | none |

Normalisation before any matching: uppercase, strip payment terminal noise, strip city and date fragments, collapse whitespace. Half of what looks like a hard matching problem is dirty strings that normalise to the same thing.

The Claude call takes the full list of unresolved distinct strings for an import and returns proposed merchant names with confidence. Distinct strings, not transactions: thirty new merchants across four hundred rows is one call with thirty items. Anything below threshold lands in the review queue rather than in the numbers.

**Every accepted answer becomes a `MerchantRule`.** That is what makes the second month nearly free, and it is why the LLM stays in the long tail rather than becoming a dependency. Resolution quality strictly improves and never regresses to a paid API call for something already learned.

---

## 8. Read model

Computed on read. Postgres group-by over a household's transactions, no materialised view, no cache.

The month overview is four queries: income grouped by merchant, spend grouped by primary tag then merchant, reserve movements grouped by account, and the reconciliation figures. Add the same four for the previous month for comparison. At household volume this is milliseconds, and every complication you skip here is a staleness bug you never write.

Revisit only if a single household passes roughly a hundred thousand transactions, which is decades away.

The reconciliation panel is not a debug feature, it ships in the view: income, spend, net to reserves, computed change in pot, and the difference. When the difference is not zero it names the cause, which is nearly always unmatched internal legs or an account whose export has a gap.

---

## 9. Tenancy

`householdId` is a non-null column on every table except `Household` itself.

The household context is resolved once, at the server action or route boundary, from the session. It is then passed explicitly into use cases and repositories as an argument. No ambient context, no global, no reading the session deep in a query builder. Interface-first, so a use case's signature makes it obvious it operates within a tenant.

Repositories are the single choke point: every query in a repository takes the context and filters on it. That is one place to review and one place to test.

Postgres RLS on top as a backstop, not as the mechanism. If RLS is the only thing stopping a cross-tenant read, a missing policy on one new table is a silent data leak. If it is the second line, it catches your mistake instead of being your plan.

---

## 10. Testing

Two gates, because an orchestration agent loops against the fast one and closes a slice against the slow one.

**Fast gate, runs every iteration, seconds:**

| Test | What it protects | Shape |
|---|---|---|
| Profile detection | Delimiter, date format, decimal style, amount representation | Pure, synthetic files |
| Interpretation units | Flow rules, pairing, corrections | Pure functions, in-memory, no DB |
| Reconciliation invariant | The whole model | Property test: for any generated dataset, income minus spend minus reserves equals change in pot |

**Slow gate, runs at slice completion:**

| Test | What it protects |
|---|---|
| Playwright golden journey | That the wiring, the UI and the numbers agree |

**Write the golden journey first.** Sign in, upload file A, declare the account and confirm the detected profile, upload file B from a second account containing the other leg of a transfer, open the month view, assert the totals and that reconciliation shows zero. That single test is the executable version of the acceptance criteria, and it is much harder for an agent to satisfy dishonestly than a unit test it also wrote. It is the strongest spec artifact in the project.

**But keep the reconciliation invariant out of Playwright.** It is a pure function over data, and running it through a browser makes it slow and destroys failure localisation. When an agent sees a red E2E saying "totals wrong" it learns almost nothing about whether parse, dedup, classify or pair is broken. The fast gate is where iteration speed and diagnosis come from; the E2E is where honesty comes from.

For determinism, which matters more with an agent than with a human: fixture files are synthetic and committed, the clock is injected and fixed, the household is seeded, and each run resets a local Docker Postgres with `prisma migrate reset`. The Claude resolver is a fake adapter behind its port in every test, which is the first place the ports actually earn their keep.

Anonymised real exports get added to the profile detection fixtures as they arrive. They are test input, not build input, so none of this waits on them.

---

## 11. Decisions

| Decision | Verdict |
|---|---|
| Facts and interpretation | Separated, interpretation fully rebuildable |
| User corrections | Written as rules in the declaration layer, never as row edits |
| Recompute | Full rebuild, no incremental invalidation |
| Deployment | Single Next.js app, no services |
| Background work | None in v1, everything in request |
| Claude calls | One batched call per import, distinct strings only, slice 5 |
| Interpretation scope | Period window across accounts, not the imported rows |
| Pairing determinism | Tie-break by date difference then id |
| Read model | Computed on read, no materialisation |
| Tenancy enforcement | Repository layer, RLS as backstop |
| Uploaded files | Parsed in memory, not stored |

---

## 12. Deliberately absent

No queue. No cron. No event bus. No CQRS write and read split. No microservices. No caching layer. No shared platform package extracted from Hemma yet. No per-transaction override table.

Each of these has a trigger that would make it correct, and none of those triggers is a household with a few thousand transactions a year and one user. Add them when the trigger fires, not in anticipation of it.
