# Pulse v1: acceptance criteria per slice

Intake for the Tiphys plan-writer. Each criterion is written in the shape the
plan schema wants (id plus a criterion an agent can execute and judge by exit
code or a concrete assertion), so phases can lift them verbatim. Hazard
classes name the known traps; every one maps to a fast-gate test that must
exist by name.

Conventions used below: `npm test` is the fast gate (Vitest, in-process, no
network, Docker Postgres via `npm run db:reset` where a repository is
involved). `npm run test:e2e` is Playwright against `npm run dev` with a
seeded household. All test files named here must exist at the stated paths.

---

## Slice 0: skeleton

Acceptance:
- id: "0.1"
  criterion: npm ci && npm run typecheck && npm run lint && npm test exit 0 on a clean clone.
- id: "0.2"
  criterion: npm run db:reset exits 0 against local supabase start, applying all migrations; prisma migrate status reports no pending migrations.
- id: "0.3"
  criterion: Playwright test/e2e/auth.spec.ts passes; it signs up with email and password, signs out, signs in again, and asserts an authenticated household context renders.
- id: "0.4"
  criterion: Every Prisma model except Household carries a non-null householdId, asserted by test/schema/tenancy.test.ts reading the DMMF.

Hazards:
- H0.1: Session read inside a repository. Addressed by review plus test/schema/tenancy.test.ts asserting repository signatures take HouseholdId.

## Slice 1: import

Acceptance:
- id: "1.1"
  criterion: test/domain/profile-detection.test.ts passes, covering delimiter (`;` and `,`), encoding (UTF-8 and Windows-1252), header row offset, date formats DD/MM/YYYY and YYYY-MM-DD and DD.MM.YY, decimal styles 1.234,56 and 1234.56, and all three amount representations (signed column, debit and credit pair, amount plus D/C indicator) against committed synthetic fixtures in test/fixtures/.
- id: "1.2"
  criterion: test/application/ingest.test.ts asserts that importing fixture A then re-importing an overlapping fixture A2 adds exactly the non-overlapping rows and reports added versus already-known counts; dedup keys are unique per household.
- id: "1.3"
  criterion: A fixture containing rows from two accounts fails the import with status FAILED and zero rows written, asserted in test/application/ingest.test.ts.
- id: "1.4"
  criterion: Every stored Transaction carries rawLine equal to its source line, asserted in test/application/ingest.test.ts.
- id: "1.5"
  criterion: Playwright test/e2e/import.spec.ts uploads a first file, is asked to declare the account (label, bank, ring) and confirm the detected profile over a five-row preview, completes, re-uploads the same file, and asserts zero new rows and no questions asked.

Hazards:
- H1.1: Amount representation misdetected, inverting signs. Addressed by criterion 1.1's D/C fixtures and criterion 2.4.
- H1.2: Silent partial import of a mixed file. Addressed by criterion 1.3.

## Slice 2: one pot

Acceptance:
- id: "2.1"
  criterion: test/domain/classify-flow.test.ts covers all five flow values and the declared-set precedence (reserve set before pot set before sign).
- id: "2.2"
  criterion: test/domain/pair-transfers.test.ts asserts pairing is deterministic and order-independent, shuffling insertion order and asserting an identical pair set, including the tie-break by date distance then id.
- id: "2.3"
  criterion: The four corrections each have a named passing test in test/domain/corrections.test.ts, one describe block per correction (card settlement, reserve drawdown, refund, cash withdrawal).
- id: "2.4"
  criterion: test/property/reconciliation.test.ts passes: a property test over generated datasets (fast-check) asserting income minus spend minus net-to-reserves equals change in pot, exactly, in integer cents, across at least 500 generated cases.
- id: "2.5"
  criterion: An unmatched internal leg is excluded from both sides and surfaced, asserted in test/domain/pair-transfers.test.ts; interpretation re-run over the period window after a second file heals it, asserted in test/application/interpret.test.ts.

Hazards:
- H2.1: Card settlement double count. Addressed by criterion 2.3.
- H2.2: Reserve drawdown counted as income. Addressed by criterion 2.3.
- H2.3: Pairing depends on insertion order. Addressed by criterion 2.2.

## Slice 3: merchants and sources

Acceptance:
- id: "3.1"
  criterion: test/domain/normalise-counterparty.test.ts covers uppercase, terminal noise, city and date fragments, whitespace collapse.
- id: "3.2"
  criterion: test/application/resolve-merchants.test.ts asserts a manual assignment writes a MerchantRule, and that recompute applies it to all past matching transactions; no code path in interpretation writes a MerchantRule, asserted by construction (the interpret use case has no rule repository dependency).
- id: "3.3"
  criterion: Playwright test/e2e/merchants.spec.ts names an unresolved counterparty and asserts the month view regroups it without totals changing.

Hazards:
- H3.1: A correction stored as a row edit, silently undone by recompute. Addressed by criterion 3.2.

## Slice 4: two-sided month view

Acceptance:
- id: "4.1"
  criterion: Playwright test/e2e/golden-journey.spec.ts passes end to end; sign in, upload account A's fixture, declare and confirm, upload account B's fixture containing the other transfer leg, open the month view, assert income, spend, reserves and pot-change totals against the fixture's known values, and assert the reconciliation line reads zero difference.
- id: "4.2"
  criterion: The partial current month renders the in-progress state and no comparison, asserted in test/e2e/month-view.spec.ts with a fixed clock mid-month.
- id: "4.3"
  criterion: With a deliberately gapped fixture, the view shows the unexplained difference in the alarm treatment and names unmatched legs, asserted in test/e2e/month-view.spec.ts.
- id: "4.4"
  criterion: All three locales render the month view without truncation or layout overflow, asserted per locale in test/e2e/month-view.spec.ts; message catalogs for en, nl, fr load via next-intl and no user-facing string is hardcoded (lint rule or grep gate on modules/**/ui).
- id: "4.5"
  criterion: A grep gate asserts no literal oklch(, no hex colour, and no px font-size inside modules/**/ui components; tokens only.

Hazards:
- H4.1: Partial month reads as a spending collapse. Addressed by criterion 4.2.
- H4.2: Hidden unknowns making totals lie. Addressed by criterion 4.3.

## Slice 5: Claude fallback and review queue

Acceptance:
- id: "5.1"
  criterion: test/application/resolve-claude.test.ts runs against a fake adapter only; asserts one batched call per import carrying distinct unresolved strings, threshold routing to the review queue, and accepted answers persisted as MerchantRules. A repo-wide grep gate asserts no test imports the real Claude adapter.

## Slice 6: recurring, committed versus discretionary

Acceptance:
- id: "6.1"
  criterion: test/domain/recurring.test.ts asserts detection (same merchant, three or more occurrences, interval and amount within tolerance) is deterministic and explainable, with fixtures for monthly salary, quarterly bill, and a false-positive case that must not match.

---

## Definition of done, per phase

typecheck, lint and the fast gate green every iteration; the phase's named
tests exist at the stated paths and pass; the slow gate green before the
phase branch merges; work history written before the PR.
