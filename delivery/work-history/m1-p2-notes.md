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

## Amendment C (CR-007, tenancy analyzer)
- RED captured first: 4 new fixtures (dynamic import held, import-equals held, exported namespace default-flagged, dynamic import outside adapters) -> `npx vitest run test/schema/tenancy.test.ts`: 4 failed | 17 passed.
- Fix: (1) held-to-rule detection is now a source-text scan DB_CLIENT_IMPORT.test(sourceText), covering dynamic import and import-equals; (2) final else arm default-flags ANY exported statement kind without a positive arm (ts.canHaveModifiers + export modifier), interfaces/type aliases exempt as type-only; (3) comments in src/platform/tenancy.ts and the test header corrected LOUDLY (R-087), residue list extended (call sites, injected clients, alias modules).
- GREEN: 21 passed (21).

## Amendment D (skill section 6)
- Edited .claude/skills/pulse-domain/SKILL.md section 6: per-profile key choice, ordinal-extended hash, cross-import highest-occurrence rule, loud correction note (R-087). Committed.

## Next: schema + migration (with RLS, amendment A). RLS test written RED first.

## Schema + migration (amendment A)
- test/schema/rls.test.ts written first; RED captured: 1 failed | 2 passed (declared tables missing transactions/imports AND rls absent). Checker mechanism fixtures (missing table by name, DISABLE not fooled) green.
- prisma/schema/accounts.prisma + import.prisma written; Household back-relations added in platform.prisma. npx prisma validate OK.
- Migration 20260818154929_import_facts_and_declarations created (pinned env via scratchpad/pin.sh; ambient Hemma creds confirmed present in shell and never used). RLS ENABLE appended for all six tables incl. households/users, with the no-policies rationale in the SQL comment.
- Applied to local stack; prisma migrate status: "Database schema is up to date!".
- Live check: pg_class relrowsecurity = t for accounts, households, imports, source_profiles, transactions, users. _prisma_migrations stays f: it is not a table Prisma DECLARES (not in the DMMF), so outside amendment A's stated scope; recorded rather than silently skipped.
- Schema test suite now: all green.

## Domain layer in progress
- platform/money.ts (Cents), platform/plain-date.ts (PlainDate + db boundary converters), platform/result.ts.
- import/domain: source-profile.ts (spec union + boundary parser + specEquals canonical-JSON), parse-amount.ts (string-arithmetic cents, no floats), parse-date.ts (three formats -> PlainDate), delimited-text.ts (encoding probe, line split preserving rawLine, RFC4180-ish field split).
- Next: parse-statement.ts (generic parser behind StatementParser port), detect-profile.ts (deterministic detection), then fixtures + profile-detection tests (red first via stub-less run).

## Criterion 1.1: profile-detection tests green + red witnesses by mutation
- GREEN: npx vitest run test/domain/profile-detection.test.ts -> 24 passed (24).
- Red witnesses against the DANGEROUS STATE (hazard H1.1, two structurally different members of the sign class plus a detection member), each applied to committed code, run, captured, restored:
  - Mutation 1: indicator branch sign flipped (debit -> +) in parse-statement.ts -> 2 failed | 22 passed (card FX row and identical-rows/settlement tests red).
  - Mutation 2: debitCredit branch stops negating debit -> 1 failed | 23 passed (generic debits-negative test red).
  - Mutation 3: detected decimal style arms swapped in detect-profile.ts -> suite red at collect: "detection failed for belfius-account-a.csv: no-amount-column", Tests: no tests, exit nonzero. A misdetected style cannot even find the amount column, so the suite reddens loudly rather than passing wrong cents.
- After restores: 24 passed (24). git status clean of mutations.

## Criteria 1.2/1.3/1.4: ingest tests green + mutation red witnesses
- GREEN: npx vitest run test/application/ingest.test.ts -> 8 passed (8). Covers: A then A2 overlap (added 3, known 3, 9 rows); per-household key uniqueness incl. a second household importing the same file (6 own rows); DMMF unique [householdId,dedupKey] by name; identical-duplicates store 2 rows and re-upload adds 0/known 6; partial overlap ends at exactly 2 rows (added 2, known 1); mixed-account FAILED zero rows on upload AND confirm paths; rawLine verbatim vs both fixture files (windows-1252 and utf-8 decode).
- Mutation red witnesses (applied to committed code, captured, restored):
  - ordinal removed from hash key (the skill's OLD recipe): 3 failed | 5 passed (identical-rows, partial-overlap, and rawLine multiset collapse). This is PR-001's defect reproduced red.
  - mixed check defanged (>1 -> >99): 2 failed | 6 passed (both criterion 1.3 tests).
  - rawLine sliced: 1 failed | 7 passed.
- After restores: 8 passed, git status clean (delivery notes only).

## SCOPE ESCALATION (say it the moment you find it, brief clause phase-scope)
The phase's files-to-touch lists src/modules/accounts/, src/modules/import/, prisma/, and the four test paths. Step 7 (upload UI) and criterion 1.5 (Playwright flow over real routes) REQUIRE files outside that list:
- src/app/(app)/import/page.tsx and src/app/(app)/import/[id]/page.tsx (thin routes; pulse-frontend mandates thin app/ routes composing module UI, so the UI cannot live only under src/modules)
- src/app/globals.css (import screen classes, tokens only)
- messages/en.json, nl.json, fr.json (no user-facing string may be hardcoded; new import keys)
- vitest.config.ts (the "@" path alias so tests resolve domain imports; mechanical)
- src/platform/{money,plain-date,result}.ts and src/platform/ui/amount.tsx (shared primitives pulse-typescript mandates; platform is the only legal home)
Amendment items A-D touch their own files by orchestrator declaration (migration+test, auth-status, tenancy test/comment, skill file).
ACTION NEEDED FROM ORCHESTRATOR: amend the phase declaration on the base branch to include these paths before the scope gate runs. Proceeding, because the alternative (no routes, no catalogs) fails criteria 1.5 and the frontend skill's own rules; every extra path above is load-bearing for a phase step, none is scope creep.
