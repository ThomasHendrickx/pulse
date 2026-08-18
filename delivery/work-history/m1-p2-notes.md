# M1-P2 import: working notes

Incremental log. Appended as work happens.

## Session start
- Read implementer brief (implementer-brief-m1-p2.md) and notes/export-format-facts.md.
- Next: read CLAUDE.md skills, delivery/plan/pulse-v1.yaml, inspect worktree state.

## Reading done (in order)
- implementer-brief-m1-p2.md (full rendered phase, 7 steps, 6 criteria, 3 hazards, migration decl, warnings 1-5)
- schemas/work-history.schema.json + report.schema.json defs (gateResult/claim/fixRound shapes noted)
- tuition/mechanism-index.yaml: consulted. Entries are kernel-process mechanisms (claim files, leases, logs, watchdogs, parsing reporter output, generated-artifact drift). None covers CSV parsing, dedup keys, Prisma migrations or RLS. Applicable rows: "asserting a CI step is wired" (assert behaviour not text; witnesses for a class redden under two structurally different members) and "assert by name never by count" (env warning); both applied to the RLS-migration test design (derive table names from DMMF, per-name assertions). Recording per mechanism-lookup clause: no entry for the mechanisms this phase builds.
- gate-registry.yaml gate list came rendered in the brief. Local product gates: npm run typecheck / lint / test / test:e2e.
- CLAUDE.md + all three skills read in full.
- delivery/plan/pulse-v1.yaml read in full incl. report-code-disagreement entries for M1-P2 (natural key per-format only; skill section 6 recipe collapses legit duplicates, correction escalated to orchestrator -> now carried to me as amendment D).
- notes/export-format-facts.md read (Belfius account: stmt+seq key holds; KBC card: no seq, FX sub-lines, legit identical duplicate rows, settlement row).
- M1-P1 work history + review (CR-006/CR-007 findings quoted with concrete fixes).

## Design decisions (before code)
- Schema: accounts.prisma (Account: label, bank, role POT|RESERVE, iban, unique(householdId,iban)); import.prisma (SourceProfile with Json spec column; Import with status enum + rawContent bytes + counts; Transaction raw fact columns + rawLine + dedupKey + unique(householdId,dedupKey) + flow enum nullable populated by M1-P3).
- SourceProfile parsing spec stored as ONE Json column `spec`, validated at the repository boundary into a discriminated-union domain type. Reason: a DB column named amountRepresentation would trip the DMMF money-name gate (/amount/i must be Int/BigInt), and splitting the union across nullable columns re-creates the three-optional-fields shape pulse-typescript forbids.
- Ingest tests (criteria 1.2-1.4) run against an in-memory fake of the import repository port implementing insert-ignore on (householdId, dedupKey). Fast gate has no database (pulse-typescript section 8). The REAL unique index is asserted by name over the DMMF in the schema tests; the migration SQL RLS test covers the migration side.
- Account identity: from the accountIban column role when the profile has one (Belfius shape); card profiles carry none, so the account is bound to the confirmed SourceProfile (accountId on SourceProfile). Re-upload recognition: detected spec equality against stored profiles per household; account via iban lookup or profile binding; both known -> ingest with no questions (criterion 1.5).
- Statuses: Import row is created at upload (PARSED or AWAITING_DECLARATION); mixed-account file -> FAILED with zero Transaction rows (check is pre-write, in memory); confirm/ingest -> INGESTED. INTERPRETED is M1-P3's.
- Cents/PlainDate branded types land in src/platform/money.ts and src/platform/plain-date.ts (platform primitives, same standing as Clock/HouseholdContext); module domain imports them type-first. Recorded as a decision since "domain imports nothing outside the module" reads strictly; platform primitives are the codebase's shared language (Clock port already is one).

## Next
- npm ci, docker/supabase check (background) while amendments B/C/D land first as small commits.

## Amendment B (CR-006, auth-status whitelist)
- Extracted whitelist to src/app/(auth)/status-keys.ts VERBATIM (still `in`), wrote test/app/auth-status.test.ts.
- RED captured: `npx vitest run test/app/auth-status.test.ts` -> 1 failed | 3 passed; failing assert isKnownStatus("constructor") toBe(false) at test line 14 (the `in` operator admits prototype keys).
- Fix: Object.hasOwn(STATUS_KEYS, value). GREEN: 4 passed (output pasted next).
