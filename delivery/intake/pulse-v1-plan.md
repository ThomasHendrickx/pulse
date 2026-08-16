# Pulse v1: first plan

Working title. Lean scope. One input, one output, nothing else.

---

## 1. What v1 is

**Goal:** I export transactions from my current accounts and cards, drop the files in, and get one two-sided picture of the household: where the income came from, and what the money was spent on. Those accounts are one pot. Movements between them are not income and not spend, and cancel out. Savings and investment accounts are not in the pot: they are a third destination, still mine, but outside day to day money movement.

**Two rings, and the difference matters:**

| Ring | Accounts | Role |
|---|---|---|
| Pot | Current accounts, cards | Where income lands and spend happens. This is what the overview is about. |
| Reserves | Savings, investments | Still my money, not money movement. Money parked here has left the pot without being spent. |
| Outside | Everything else | Merchants, employers, anyone who is not me. |

**Definition of done:**

1. The first time an account appears in an upload, I classify it once: label, bank, ring. I am never asked again.
2. I can upload an export from each pot account and re-upload overlapping periods without creating duplicates.
3. Every movement between pot accounts is recognised, paired and excluded from both sides.
4. Every movement between the pot and reserves is recognised and routed to its own block, neither income nor spend.
5. Raw counterparty strings are resolved into merchants and income sources I recognise.
6. One screen answers: where money came from, what it went to, what went to reserves, and what moved versus the previous month.
7. The books close: income minus spend minus net to reserves equals the change in the pot. If it does not, the difference is shown, not hidden.

Point 7 is the quality bar. A finance overview that does not reconcile is a spreadsheet with better fonts.

Anything that does not serve those seven lines is not in v1.

---

## 2. Scope

| In | Out (deliberately) |
|---|---|
| CSV / XLSX upload per account | PSD2 / Ibanity bank connection |
| Idempotent import with dedup | Notifications, digests, nudges |
| Merchant resolution (rules first) | Goals, baselines, forecasting |
| Freeform tags on merchant, one primary | Multi-user, household sharing |
| One month view with comparison | Ask box / conversational query |
| Manual correction of a merchant or tag | Mobile app, native anything |
| Single user, single tenant | Multi-currency |

The two cuts worth defending:

**No bank API in v1.** PSD2 turns a weekend project into an onboarding, consent and compliance project. The CSV path proves the domain model and the insight quality, which is the actual risk. The bank connection swaps out one adapter later.

**No ask box in v1.** This one is closer, because the conversational surface is the thing that makes it Pulse and not a spreadsheet. It still waits, and the reason is not caution: questions asked over bad merchant mapping return confidently wrong answers, and that is the fastest way to stop trusting the product. Get resolution quality right first, then put a question box on top of a schema that already deserves it. Realistically v1.1, not v2.

---

## 3. Domain model (minimal)

Eight tables, no more.

| Entity | Purpose |
|---|---|
| `Household` | The tenant. Owns everything. Every other row carries `householdId`. |
| `User` | A person who signs in. Belongs to a household. |
| `Account` | One bank account or card. IBAN or card reference, label, bank, `role` (`POT`, `RESERVE`), declared by the user at first sight. |
| `Import` | One uploaded file, which is exactly one account. Source account, period covered, row counts, status. |
| `Transaction` | Booking date, value date, amount, currency, raw counterparty, counterparty account, raw description, structured reference, account, import, dedup key, `flow`. |
| `TransferLink` | Pairs the outgoing and incoming leg of one internal movement. |
| `Merchant` | Normalised counterparty, on both sides. Display name, matching keys, resolution source. |
| `Tag` | Freeform label. Nothing seeded. |
| `MerchantTag` | Many-to-many, with an `isPrimary` flag. |

**The tenant is the household, not the person.** This is the one decision here that cannot be retrofitted. If rows are keyed on `userId`, then the day your wife wants to see the same pot, every table needs re-keying and every query rewriting. Keyed on `householdId`, adding a second member is one join table and nothing else. v1 ships with exactly one user per household and does not care; the boundary is just drawn in the right place. `Membership` stays out until there is a second member.

Tenant scoping lives in the repository layer, in one place, not sprinkled through queries. Postgres RLS on top of it if you want defence in depth, but the application layer is where it is enforced and tested.

**Import is a conversation, not a parse.** The user knows what account xyz is. Inferring it is both harder and worse. So the upload flow asks, once, at first sight:

| Trigger | Question | Asked again |
|---|---|---|
| Unknown account identity in a file | What is this account: label, bank, pot or reserve | Never |
| Unknown file format | Here is the detected profile and five parsed rows, confirm or fix. Name it | Never, the profile is reused |
| Known account | Nothing | |
| Counterparty IBAN seen repeatedly in both directions, not registered | Is this one of yours, and which ring | Once, and only above a threshold |
| File period overlaps existing data | Nothing, just state what was added and what was skipped | |

Two rules keep this from becoming a form: ask at first encounter only, and never ask something the file already answers. Nothing is asked at the second import of the same account, and nothing is asked about a merchant during upload. That principle carries into slice 3: merchant resolution asks the same way, once per merchant, and remembers.

**One file is one account.** The parser resolves the account identity from the file, and the classification question is asked per file. The guardrail that makes this assumption safe to hold: if a file turns out to contain rows from more than one account, the import fails loudly and imports nothing, rather than quietly attributing half the rows to the wrong account. A silent version of that bug would poison the pot totals in a way that is very hard to notice later. If a multi-account export ever shows up, the failure tells you, and the classification step becomes per detected account instead of per file.

**`flow` is the field the whole overview hangs on.** Five values:

| Flow | Meaning | Counted as |
|---|---|---|
| `INCOME` | Money entering the pot from outside | Income side |
| `SPEND` | Money leaving the pot to outside | Spend side |
| `INTERNAL` | Movement between two pot accounts | Neither, paired via `TransferLink` |
| `RESERVE` | Movement between the pot and a savings or investment account | Reserves block, signed |
| `UNRESOLVED` | Cannot be classified yet | Shown as a visible gap, never silently dropped |

Classification is deterministic, and it runs against sets the user declared rather than sets the system guessed:

1. Counterparty account is in the declared reserve set, so `RESERVE`, signed by direction. Out of the pot is parked, back into the pot is drawn down.
2. Counterparty account is in the declared pot set, so `INTERNAL`. This covers most of the rest.
3. Unmatched `INTERNAL` leg is still `INTERNAL`, but flagged, since it usually means an export is missing a period.
4. Otherwise, sign decides: negative is `SPEND`, positive is `INCOME`.
5. Then the corrections below.

**A consequence worth taking:** you do not need to import the savings and investment exports at all in v1. A transfer to reserves is identified from the pot side, by the counterparty IBAN. Register the reserve accounts so their IBANs are known, and leave their statements out. Importing them adds a second leg to pair, a second set of parsers, and interest and dividend lines that are income in the financial space but not income in the pot, which is exactly the ambiguity v1 should not be litigating. One less bank format, no loss of correctness.

The price is that v1 shows what you put into reserves, not what reserves are worth. That is the right trade: value tracking needs positions and prices, not transactions, and it is a different product surface.

**Four corrections that decide whether the numbers are right:**

- **Card settlement.** The monthly direct debit that pays the Mastercard is a movement to my own card account, so `INTERNAL`. The individual card transactions are the real spend. Get this wrong and every month double counts card spending. This is the single biggest trap in the model, and it is the reason the card export has to be in v1 rather than after it.
- **Reserve drawdown.** Money coming back from savings into the pot is not income. It is a negative reserve movement, and it belongs in the reserves block with a sign, not on the income side. This matters because the month you fund something big from savings, income would otherwise spike for no real reason.
- **Refunds.** Money coming back from somewhere I also spend is negative spend against that merchant, not income. Rule: incoming from a counterparty that has outgoing history is `SPEND` with a positive amount. Keeps the income side honest and small.
- **Cash withdrawals.** Money leaves the pot and its destination is unknowable from the data. Its own destination, "cash", never split or guessed.

Notes:

- `Pattern`, `Baseline` and `Goal` from the PRD are not tables in v1. Recurring is derived at read time in slice 5; it becomes a table only when detection needs to be corrected and remembered.
- Tags hang off the merchant, not the transaction. A per-transaction override can come later; it is not needed to see the picture.
- Amounts as integer cents, never floats.

**Dedup key.** Belgian bank exports carry a statement number plus a sequence number, which is a stable natural key per account. Where that is missing (card exports), fall back to a hash of `accountId + bookingDate + amount + normalisedCounterparty + reference`. Store the key, unique index it, ignore collisions on import. This has to work from the first import, not be retrofitted.

---

## 4. Architecture

Vertical slices, ports and adapters, interfaces first. Nothing exotic.

**Ports that matter:**

| Port | v1 adapters | Later |
|---|---|---|
| `StatementSource` | `KbcCsvAdapter`, `BelfiusCsvAdapter`, `MastercardCsvAdapter` | `IbanityAdapter` |
| `MerchantResolver` | `RuleResolver`, then `ClaudeResolver` (slice 4), chained | Shared merchant dictionary |
| `InsightWriter` | Server-rendered month view | Digest, push, chat |

The parser port is the one that pays for itself immediately: every bank has its own column names, date format, decimal separator and sign convention, and you will add banks forever. One adapter per bank, one fixture file per bank, one test per bank.

**Stack:** Next.js (App Router) + TypeScript, Postgres on Supabase, Drizzle or Prisma, Vercel, Claude API for the long tail only. npm.

**On the shared platform.** The earlier stance was to extract the reusable platform pieces out of Hemma and start Pulse on top of them. My recommendation is to not do that yet. Extraction before the second product exists means designing an abstraction against one real consumer, and it puts a refactor of a live product on the critical path of an unbuilt one. Copy the two or three things you want (design tokens, i18n setup, the release pattern), keep them dumb, and extract properly once Pulse is running and you can see which seams actually repeat. The many-agent architecture stands; the platform layer is just not a v1 deliverable.

---

## 5. Delivery slices

| # | Slice | Value delivered | Done when |
|---|---|---|---|
| 0 | Skeleton | none | App deployed, DB connected, auth working, one household with one user |
| 1 | Import | Data is in, safely | Upload a KBC export, unknown account classified once, rows land, re-upload adds nothing |
| 2 | One pot | The numbers stop lying | Internal transfers paired and excluded, reserve movements routed out, card settlement handled, reconciliation identity holds |
| 3 | Merchants and sources (rules + manual) | Names are readable | Every counted transaction has a merchant or income source, unknowns assignable in one click |
| 4 | **Two-sided month view** | **First real value** | One screen: income by source, spend by destination, net to reserves, versus previous month |
| 5 | Claude fallback + review queue | Resolution stops being manual work | Unknown counterparties resolved above threshold, rest queued for triage |
| 6 | Recurring + committed vs discretionary | The insight that beats a spreadsheet | Subscriptions and fixed costs listed without being told about them |

Slices 0 to 4 are the walking skeleton. Ship them, use them for one real month, then decide whether 5 and 6 still look right.

Slice 2 moved ahead of merchant resolution on purpose. Pretty names on wrong totals are worse than raw strings on right totals, and the whole point of the outcome is a picture of one pot rather than a stack of account statements. It also forces the reconciliation check to exist before anything is displayed, which is where the bugs actually are.

Slice 3 is intentionally allowed to be crude: exact and prefix matching on a normalised counterparty string, plus manual assignment that is remembered. Second import onwards, most rows resolve for free. That is enough to reach slice 4 without touching an LLM. Income sources go through the same resolver, they are just a much shorter list (salary, allowances, refunds, interest), which is why they are worth resolving properly from day one.

Recurring detection in slice 5 stays deterministic: same merchant, three or more occurrences, interval within tolerance, amount within tolerance. No AI needed, and it is explainable, which matters when it is wrong.

---

## 6. Decisions taken

| Decision | Verdict |
|---|---|
| Tenancy | Multi-tenant from the start, `householdId` on every row, scoping in the repository layer |
| Tenant boundary | Household, not user. `Membership` deferred until there is a second member |
| Auth | Real auth from slice 0, single sign-in method, nothing else |
| Account classification | Declared by the user at first sight, never inferred |
| File to account | One file is one account. Mixed files fail the import loudly, nothing partial |
| Parsing | No per-bank parsers. One generic parser driven by a named `SourceProfile` the user declares once, detected and previewed before confirming |
| Input for v1 | File upload only, one file per pot account, including the card. Reserve accounts registered, not imported |
| Ledger scope | Pot accounts are one pot, no per-account views in v1 |
| Savings and investments | Own ring outside the pot, movements shown as a signed reserves block |
| Investment value | Out of scope for v1, transactions only, no positions or prices |
| Internal transfers | Detected via own IBAN sets, paired within the pot, excluded from both sides |
| Refunds | Negative spend on the merchant, never income |
| Reserve drawdown | Negative reserve movement, never income |
| Cash withdrawals | Their own spend destination, not split |
| Reporting period | Calendar month, compared to the previous calendar month |
| Current month | Shown as in progress, never compared to a full month |
| Reconciliation | Income minus spend minus net to reserves equals change in pot, shown on screen |
| Dedup | Natural key from the export, hash fallback, from day one |
| Categorisation | Rules only until slice 5 |
| Tags | Freeform, on merchant, one primary, nothing seeded |
| Platform extraction from Hemma | Deferred, copy instead |
| Ask box | v1.1, right after resolution is trustworthy |
| Name | Stays "Pulse" as working title, decide before anything public |

---

## 7. Still open

Only one, and it is not blocking: **whether slice 0 ships an invite flow for a second household member.** The tenant boundary is drawn for it either way, so this is purely about scope. My call is no, and add `Membership` when someone actually needs it.

Everything else is decided. Slice 0 can start.

One thing to hold onto when you get to slice 4: the current month is always partial. Comparing eleven days of August against a full July makes every category look like a collapse. Either mark the month as in progress and compare only closed months, or compare like for like on day count. The first is simpler and honest, so that is what the plan assumes.
