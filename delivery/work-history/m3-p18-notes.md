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
     covered by the rewritten acceptance test in test/e2e/accounts.spec.ts
     and the criterion 18.2 test in test/e2e/month-view.spec.ts, plus the
     refusal-baseline before-arm of test/e2e/canonical-backfill.spec.ts;
     command: npm run test:e2e. CORRECTED IN THE FIX ROUND (finding
     CR-M3P18-05, clause R-087): this entry used to point the savings
     acceptance at test/e2e/import.spec.ts, a file this phase never
     touched; the false pointer is corrected in place rather than deleted.
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

## Environment upgrade discovered at gate time: a bare Postgres 16 exists here

The container has /usr/lib/postgresql/16 (server binaries) although no Docker
daemon and no Supabase auth service. A throwaway cluster was started as the
postgres system user on 127.0.0.1:54322 (trust auth, data dir
/var/lib/postgresql/pulse-pgdata) and used for three captured runs:

1. `npx prisma migrate deploy` with DATABASE_URL/DIRECT_URL pinned to
   127.0.0.1:54322: ALL SEVEN migrations applied cleanly on a fresh database,
   the canonical backfill included. Exit 0.
2. A temporary witness script (untracked, deleted after the run; its full
   output is recorded below verbatim) executed the NON-BROWSER arms of
   criteria 18.3, 18.4 and 18.5 against that database using the committed
   harness, the committed migration.sql text and the real repository and
   application code: 42 assertions, all ok, exit 0. Highlights: the ring
   scoping counts the pot gap and never the savings row; listGapRows returns
   no savings row (the listing-alone assertion); the held read returns the
   savings row with the typed label; the committed SQL expression agreed with
   canonicalAccountNumber over every seeded rendering; the collision pair
   stayed byte identical over TWO runs; the checksum-failing number was
   backfilled canonical; the canonical control household was untouched; the
   canonical probe missed the spaced row before the migration and matched it
   after; the typed canonical twin was refused by the REAL adapter with no
   second row; the detection script printed exactly the pair's two row ids
   and no account-shaped string.
3. `npx playwright test held-and-gap-rows --project=chromium` with the same
   pinned env plus invented NEXT_PUBLIC_SUPABASE values: 1 passed (52.8s),
   exit 0. This spec drives no browser, so the missing auth service does not
   reach it; the criterion 18.3 port sweep is therefore FORMALLY witnessed in
   this container.

STILL ENVIRONMENT-LIMITED, precisely: every spec that drives the BROWSER
(sign-up needs the Supabase auth service, which is Docker-based and absent):
test/e2e/canonical-backfill.spec.ts (its browser arms; its SQL arms were
witnessed by run 2), the criterion 18.2 held-block test in
test/e2e/month-view.spec.ts, the rewritten acceptance test in
test/e2e/accounts.spec.ts, and the full `npm run test:e2e` gate. Command a
capable container must run, from the repo root, with the local supabase
stack up and DATABASE_URL/DIRECT_URL/NEXT_PUBLIC_SUPABASE_* pinned to it:

    npm run test:e2e

The slice does not close until that passes somewhere.

## Claim-grep run (clause claim-grep), over the final work history

    $ grep -nEi 'cannot be|impossible|needs a|is covered|catches|would catch|recovers|anyway|always|never|no way to' delivery/work-history/m3-p18.yaml
    25, 39, 46: hits inside the VERBATIM prompt block (quotations of the
        dispatch, which schema rule R-052a forbids rewording); the
        dispatch's "cannot be executed here" is corrected by the captured
        runs under gate-evidence and claims C2/C3.
    395: "never the savings row" inside claim C2's captured OUTPUT, which
        is the passing spec's own title, adjacent to the executed command
        and its exit code.
    The whitespace-flattened re-run found the same hits plus "needs a"
    inside claim M3P18-C6, which is an open question by kind.

Work history validated: npx --prefix /home/user/pulse-fleet tiphys validate
--type work-history delivery/work-history/m3-p18.yaml, exit 0.

## FIX ROUND ONE (2026-08-27, after clean-room verdicts m3-p18-criteria.yaml 107eaf6 and m3-p18-hazard.yaml 983ae4e)

### HZ-M3P18-01 (high): the SQL class was not the mirror it claimed to be

RED, captured against the local cluster BEFORE any edit (commands and full
output in this session, summarised verbatim):

    SELECT length(regexp_replace(chr(code), '[[:space:]]', '', 'g')) ...
      codes 160 (U+00A0), 8239 (U+202F), 65279 (U+FEFF): sql_keeps = 1
      (the class retains them); node String.replace(/\s/g,""): js_keeps = 0
      for all three.
    An NBSP-spaced rendering beside its compact twin, run through the
    COMMITTED migration statement: the NBSP row stayed non-canonical
    (len 19), and the COMMITTED grouping scoped to that household returned
    0 collision groups while deriveDeclaredSets and the register check
    treat the two rows as one account.

FIX: one shared class, ACCOUNT_NUMBER_SQL_WHITESPACE_CLASS in
src/platform/account-number.ts: the POSIX class unioned with U+00A0,
U+1680, U+2000..U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF as
visible ARE escapes (U+200B deliberately absent: JS \s does not match it).
Wired: inlined in the migration (edited IN PLACE: at fix time the file
existed only on this unmerged branch and had been applied to throwaway
review clusters only, so no deployed database carries the superseded
statement); bound as a parameter in the detection grouping and in all
three reserves-join sites (binding is what makes the template-literal
escape lesson moot). The three false mirror sentences (migration comment,
account-number.ts sibling note, the reserves-join paragraph) corrected
loudly with the superseded wording quoted. The harness gained the
divergent renderings: an NBSP-spaced row beside its compact twin (a
SECOND collision pair, BE70910000000006) and a U+202F-spaced row behind a
leading BOM (BE43910000000007), both invented (bodies continue the
91-run, check digits computed), listed with provenance, written in source
as visible escapes so no raw invisible byte enters the tree.

GREEN, captured after the edits against the same cluster:

    The escape-form class probe: codes 9,10,13,32,160,5760,8192,8202,
    8232,8233,8239,12288,65279 all stripped; 48,65,117,8203 all kept;
    byte-for-byte the JS \s answer over the same probe set.
    The corrected committed migration over an NBSP household: the NBSP
    pair left byte identical AS A COLLISION (both runs), the
    BOM-plus-U+202F row canonicalised to its compact form (len 16), second
    run byte-stable.
    The corrected detection CLI: emits the NBSP pair's two row ids as one
    line (previously invisible), exit 0, nothing account-shaped on stdout.
    witness-fixround.mts (temporary, deleted): 17 checks over the updated
    harness through the corrected committed artifacts, all ok, exit 0,
    including the full fact-column byte compare and idempotency.
    npx playwright test held-and-gap-rows --project=chromium at the fixed
    head: 1 passed (35.4s), exit 0 (the reserves join's bound-parameter
    form exercised through the real repository).
    Fast gate: the new class-equivalence test DERIVES the JS \s set by
    sweeping every Unicode code point and asserts the class enumerates it
    exactly; the migration pin asserts byte equality with the platform
    constant PER OCCURRENCE, extracting every regexp_replace pattern
    literal from the comment-stripped SQL and asserting exactly four,
    each byte-equal; and both the migration and the script are pinned
    free of the bare POSIX class. CORRECTED IN ROUND TWO (finding
    HZ2-M3P18-01, clause R-087): this sentence used to read "the
    migration pin now asserts byte equality between the inlined class
    and the platform constant", which was true of one occurrence and
    false of the artifact, since the pin was a single containment any
    one of the three a-side occurrences satisfied while the migration
    carries four; the reviewer witnessed a copy mutated in the collision
    comparison staying green under that pin and firing the unique index
    on the NBSP twin pair.

### HZ-M3P18-02 (high): the ring freeze now interacts with acceptance

The freeze (D-51/DR-0031) is the OWNER'S and stands untouched:
hasImportedRows stays flow-agnostic, no ring-change path is added. The
in-contract half delivered: the stale justifying sentence at
change-account-ring.ts (which still cited "savings statements are not
imported in v1") is corrected loudly with the superseded wording quoted
and the new interaction stated; the held block's note now names the CAUSE
in all three catalogues ("held because this account is registered in the
savings ring"), so the state is legible on the one surface this phase
owns. THE CONSEQUENCE AWAITING AN OWNER RECORD, stated here for the
orchestrator because this implementer does not edit the plan (R-007): the
plan's PARKED ring-change entry must carry it. One confirmed upload onto
a mis-ringed account now closes the only ring correction the product has
(the account acquires own rows; the guard refuses forever); a household
that answered a spending account as savings and uploaded sees its real
month silently empty with its rows held. Whether the guard should admit a
correction over flow-free held rows (the hazard lane's proposed relaxation
along the guard's own stale-flow rationale) is exactly the parked ring
question and is NOT decided in this fix round.

### HZ-M3P18-03 (low): INGESTED is terminal for a savings import

Decided as documentation plus a pin, the smallest honest fix: the marker
comment at import-repository.ts is corrected in place (R-087, superseded
meaning quoted: INGESTED remains the needs-interpretation marker for
pot-ring imports and is TERMINAL, meaning settled, for a savings import),
and test/application/savings-held.test.ts pins the terminal status over
the fake world (which mirrors the real flip), so the first pending-work
consumer meets a tested contract.

### HZ-M3P18-04 (low): the rings-disagreeing pair's silent hold

Visibility delivered through the same held-note change as HZ-02 (the
block names the savings-ring registration as the cause). The detection
script's header now states that the post-deploy run is NOT optional and
why: a rings-disagreeing pair no longer surfaces as a named refusal; its
statements land deterministically on the canonical-form member and, where
that member is savings-ringed, are silently held. What remains for the
parked merge entry: the pair's repair (the merge) and any account-listing
surface that could show both members.

### CR-M3P18-01 (medium): the read-back record

NOT FABRICATED, recorded precisely: the two real documents named by
CLAUDE.md rule 8's history are NOT present in this container and were
never available to this session, so a line-by-line read-back against them
was not performed and cannot be performed here. Every new fixture line,
harness label, bank name, description and catalogue line this phase adds
was INVENTED in-session (typed fresh for this phase; the only strings
reused are earlier committed inventions: Demobank, Acme Salaris BV,
Supermarkt Noord, and the previously listed counterparty numbers). No
external document, real or otherwise, was open or consulted while writing
them. THE READ-BACK REMAINS OWED before slice close, alongside the e2e
gate, in a container holding the real documents: read every line of
test/fixtures/savings-statement.csv, test/fixtures/pre-phase-current.csv,
the labels/banks/descriptions in test/e2e/seed-pre-phase-household.ts and
the new catalogue lines in messages/{en,nl,fr}.json against both real
documents, and record the result here.

### CR-M3P18-03/04/05 (lows)

03: the canonical-backfill spec now snapshots every transaction column
before the first migration run and deep-compares after the second; the
comment and the assertion say the same thing. 04: the held-read slice
test pins both bookingDate bounds by name. 05: the false import.spec.ts
pointer in this file is corrected in place above, loudly.

### CR-M3P18-02: standing environment debt, not claimed

npm run test:e2e has still executed nowhere at any head of this branch;
the browser arms need the Supabase auth service. Unchanged, recorded, not
claimed.
