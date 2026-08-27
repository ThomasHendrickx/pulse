# M3-P18 running notes (incremental beacon; the schema-valid work history is m3-p18.yaml, written from these captures)

Started 2026-08-27. Worktree /home/user/wt-m3p18, branch
claude/m3-p18-savings-held-and-migration, base origin/main dee3d32.

## Environment facts established before any edit

- Fleet mandated reading: /home/user/pulse-fleet/gate-registry.yaml read (it is
  the tiphys kernel's own registry, not Pulse's; Pulse's gates are the CLAUDE.md
  commands). No file named tuition/mechanism-index.yaml and no gates.manifest.json
  exists anywhere under /home/user/pulse-fleet outside node_modules (find run,
  zero hits). Mechanism lookup obligation therefore recorded as "the index does
  not exist in this fleet checkout"; the mechanisms this phase touches (db guard,
  canonical account number, migration folder) are looked up in the source instead.
- No local Postgres in this container, no Docker. Ambient DATABASE_URL points at
  a deployed pooler for a DIFFERENT project. Every db command in this phase is
  pinned to an invented localhost URL; database-connected specs are authored,
  not executed here. Recorded per capture below.

## Verification-first captures (step 1)

(appended as each capture is taken)
### Capture A: the savings refusal arm (static, at dee3d32)

    $ grep -n 'account-in-savings-ring' src/modules/import/application/confirm-import.ts
    32:        | "account-in-savings-ring";
    121:      return { kind: "rejected", reason: "account-in-savings-ring" };

Full consumer sweep (six code sites plus three catalogues), same command the
round-2 review ran:

    $ grep -rn "account-in-savings-ring\|AccountInSavingsRing" --include="*.ts" --include="*.tsx" --include="*.json" . | grep -v node_modules | grep -v "^\./delivery"
    src/modules/import/ui/actions.ts:109, :110 (routing)
    src/modules/import/ui/status-keys.ts:16 (whitelist)
    src/modules/import/ui/import-status-line.tsx:16 (SETUP_LINKED membership, set opens at :14)
    src/modules/import/application/confirm-import.ts:32 (union), :121 (refusal arm)
    messages/en.json:166, messages/nl.json:166, messages/fr.json:166 (importAccountInSavingsRing)

### Capture B: the canonical-probe-against-stored-string lookup (static)

src/modules/accounts/adapters/account-repository.ts:107-118: findAccountByIban
canonicalises the PROBE (canonicalAccountNumber(iban)) and exact-matches the
stored `iban` column. Stored rows written by M3-P14's own paths are canonical
(canonicalIban at :34-35, used by createAccount/createAccounts); a pre-P14 row
holds whatever the import path wrote verbatim (parse-statement.ts optionalText
stores the cell as printed), so a spaced stored rendering never matches.

### Capture C: the already-registered check comparing typed canonical against stored raw (static)

src/modules/accounts/application/register-accounts.ts:45-54: the known set is
built from `account.iban` AS STORED; the typed side arrives CANONICAL from
validateAccountRegistration (account-registration.ts stores the validated row's
iban canonical). A stored spaced rendering therefore never collides with the
same account typed canonically, and the unique index at
prisma/schema/accounts.prisma (`@@unique([householdId, iban])`) compares stored
strings too.

### Capture D: the null-flow occurrence sweep (criterion 18.3's three arms, at dee3d32)

    $ grep -rniE 'flow"? +is +(not +)?null' src/
    src/modules/overview/adapters/overview-repository.ts:245  (changeInPot, IS NOT NULL: not a test for an ABSENT flow)
    src/modules/overview/adapters/overview-repository.ts:256  (uninterpretedCount, IS NULL)  <- read 1
    src/modules/overview/adapters/overview-repository.ts:257  (rowCount, IS NOT NULL: not a test for an absent flow)
    src/modules/overview/adapters/overview-repository.ts:306  (listGapRows CASE, IS NULL)    <- read 2
    src/modules/overview/adapters/overview-repository.ts:321  (listGapRows WHERE, IS NULL)   <- read 2

    $ grep -rniE '(coalesce|case)[^\n]*flow' src/ | grep -iv 'cash\|workflow'
    (no COALESCE/CASE-to-sentinel form over the flow column)

    $ grep -rnE 'flow: *(null|\{ *equals: *null|\{ *in:)' src/
    src/modules/merchants/adapters/merchant-repository.ts:325: flow: { in: ["INCOME", "SPEND"] }
    (an in-list carrying NO null: not a test for an absent flow)

So exactly TWO reads test for an absent flow in a database query: the
uninterpreted COUNT (overview-repository.ts:256) and listGapRows (:306 CASE,
:321 WHERE). No third occurrence.

### Capture E: interpretation window is built from pot account ids alone (static)

src/modules/ledger/application/interpret-window.ts:34-40: windowedAccountIds
and cardAccountIds both derive from deriveDeclaredSets(accounts) which adds
only role !== "RESERVE" accounts to potAccountIds
(ledger-transaction.ts:67-82); listPotTransactions filters accountId IN that
set. A savings-ring account's rows are therefore never loaded and keep flow
NULL by construction, under interpret-for-import and recompute alike.

### Environment-limited captures (recorded, not run: no local Postgres, no Docker in this container)

The following step-1 captures require the local stack and CANNOT run here.
Ambient DATABASE_URL in this container points at a deployed pooler for a
DIFFERENT project of the owner's; nothing in this phase was run against it.
A capable container must run, from the repo root, with local-stack env
pinned (DATABASE_URL/DIRECT_URL at 127.0.0.1):

  1. Baseline refusal of the non-canonical stored account's statement
     (account-not-registered today) and the second-row trap at setup:
     covered by the new specs in test/e2e/import.spec.ts (savings
     acceptance) and test/e2e/month-view.spec.ts, plus the migration spec's
     before-arm; command: npm run test:e2e.
  2. The full MonthFigures baseline of the seeded household: hand-derived
     from the harness constants and pinned inside
     test/e2e/seed-pre-phase-household.ts (income +250000, spend -8647,
     changeInPot +241353, rowCount 2, NULL-flow rows t3 pot / t4 savings);
     asserted by the port-sweep spec.
  3. report-code-disagreement, verified false: whether the OWNER'S deployed
     rows actually carry a non-canonical rendering cannot be read from this
     tree; the backfill is therefore proven a no-op over already-canonical
     rows by the migration spec's fourth arm, and the post-deploy check for
     the parked merge is ONE run of scripts/detect-account-collisions.ts
     against the deployed target (operator command recorded in the script
     header).

## Step 3: accept the savings statement (DR-0030)

RED WITNESS (clause R-037a), captured before the fix:

    $ npx vitest run test/application/savings-held.test.ts   # at the unfixed code
    FAIL  ... the statement is ingested, not refused, and its rows keep no flow
    AssertionError: expected 'rejected' to be 'ingested'
    Tests  1 failed | 2 passed (3)

After removing the refusal root and branch (union, arm, routing, whitelist,
SETUP_LINKED, three catalogues) the same test is green.

Static sweep test test/domain/savings-decision.test.ts shown RED against the
dangerous states by stashing the fix per class:
  - stash src/modules/import + messages + SKILL.md: the two 18.1 sweeps fail
    (refusal reason still wired; superseded skill sentences present), exit 1.
  - stash overview-repository.ts: the two 18.3 arms fail (absent-flow reads
    unscoped; held read absent), exit 1.
Both stashes popped; tree restored (git status clean of unexpected changes).

Registry pins legitimately grown by the change, updated by name rather than
count-only (test/domain/merchant-review.test.ts): COUNTERPARTY_TEXT_SQL now
used 3 times (held read added); descriptor-surface walk finds 14 sites (held
row text MASKED, held heading = declared account label added to the exclusion
table with its reason).

fr.json carried a DUPLICATE key nameRefusedUnidentifiable (an accent-less
copy at :127 shadowed by an accented one at :168; JSON parse semantics made
the accented one the effective value). Rewriting the catalogue through
JSON.parse/stringify collapsed the pair to the single effective value. No
behaviour change; recorded as a loud correction (R-087).

Full fast gate after step 3: 49 files, 669 tests, 0 failed (output below at
gate time).

## Steps 5 and 6: the backfill, the detection script, the canonical duplicate check

Migration authored at
prisma/schema/migrations/20260827120000_canonical_account_iban_backfill/migration.sql:
one UPDATE of "accounts" only, the SQL mirror expression
upper(regexp_replace(iban, '[[:space:]]', '', 'g')), the NOT EXISTS collision
exclusion FIRST, IS DISTINCT FROM for idempotence, iban IS NOT NULL so a card
row is untouched. No validation anywhere in it (P14-006, P17-004).

scripts/detect-account-collisions.ts: GROUP BY (householdId, canonical form)
HAVING count(*) > 1, array_agg of row ids, one line per group, ids only
(R2-M3P18-01). Guard wiring is the surviving contract only: resolveClientDbUrl
via resolve-env.ts, assessNonProductionDbTarget with the
PULSE_ALLOW_REMOTE_DB_IN_DEV hatch, and no import resolves to target-guard,
runtime-target, gate-target or connection-string (R2-M3P18-02); pinned by
test/domain/canonical-backfill.test.ts. The post-deploy check for the parked
merge is:

    PULSE_ALLOW_REMOTE_DB_IN_DEV=1 DATABASE_URL=<deployed target> \
      npx tsx scripts/detect-account-collisions.ts

RED WITNESS for the typed duplicate check (criterion 18.5, clause R-037a),
captured before the register-accounts fix:

    $ npx vitest run test/application/account-setup.test.ts   # unfixed check
    x the typed duplicate check compares canonical forms (criterion 18.5) >
      a typed row whose canonical form matches a non-canonically stored
      account is refused, and no second row is created
    Tests  1 failed | 15 passed (16)

The failing arm is the DANGEROUS member (non-canonical stored beside canonical
typed: before the fix a second row was created). The reverse member (canonical
stored, spaced typed) was already green because validation canonicalises the
typed side; recorded as such rather than claimed as a second red.

After the fix (known set over canonical forms): 16 passed. The consumer
enumeration in test/domain/account-number.test.ts and the sibling list at
src/platform/account-number.ts grew the new consumer and the two new SQL
mirror sites BY NAME (clause mechanism-sibling).

Slow-gate specs AUTHORED here, runnable only where a local Postgres exists:
  - test/e2e/canonical-backfill.spec.ts: executes the COMMITTED migration.sql
    over the harness household (18.4 arms one to four, 18.5 migration half,
    detection script output contract, the door-opens browser journey with the
    August baseline byte-compare, and the retype-trap refusal).
  - test/e2e/held-and-gap-rows.spec.ts: the criterion 18.3 port sweep over
    the REAL repository, every port method called, the listing-alone
    assertion included, with a parsed-port completeness pin.
  - test/e2e/month-view.spec.ts gains the criterion 18.2 held-block test
    (five assertions, three locales); test/e2e/accounts.spec.ts's refusal
    test is REWRITTEN into the DR-0030 acceptance test.
Command a capable container must run: npm run test:e2e (local stack pinned,
docker Postgres up, per CLAUDE.md).

Fast gate after steps 5 and 6: 50 files, 678 tests, 0 failed, 0 skipped
reported by vitest; tsc exit 0; eslint exit 0.
