# M1-P3 work notes (one pot)

Incremental log per the dispatch contract. Newest entries at the bottom.

## Session start (2026-08-19)

Read: implementer brief (full, incl. fleet warnings), work-history.schema.json,
gate-registry.yaml (fleet copy). tuition/mechanism-index.yaml: NOT PRESENT in
this repository or the fleet root (delivery/tuition/ is empty); recording "the
index had no entry" per the mechanism-lookup clause. gates.manifest.json: not
present in this repository (it is a kernel file); the destructiveCommands list
lives in the fleet gate-registry.yaml copy; this phase adds no destructive
command.

Next: read plan section M1-P3, intake docs (plan, architecture, v0.2 addendum
section 5, acceptance criteria), repo skills (pulse-domain, pulse-typescript,
pulse-frontend), prior work histories, then the existing import module.

## Verification-first finding: main is missing the approved M1-P2 fix round (ESCALATION)

Commands executed, output captured:
- git diff 10beb40 12de8f5 --stat  -> ONLY delivery/plan/pulse-v1.yaml,
  delivery/review/m1-p2-criteria.yaml, delivery/review/m1-p2-hazard.yaml
  (606 insertions). So main's product tree equals the ROUND 0 head 10beb40.
- git diff 41ff037 12de8f5 --stat -> 29 files, 740 insertions(+), 918
  deletions(-): main LACKS the fix-round commits e10b0cc..41ff037
  (F1..F8: indicator fail-loud with creditValue, empty-sibling
  debit/credit detection, JSON tuple dedup encoding, hash-path-only
  ordinal, atomic status claim, desync throw, landing-account
  transparency, dead export removal).
- grep creditValue src/modules/import -> no hits on this base.
- test/domain/dedup.test.ts (added in fix round) does not exist on main.
- The 12de8f5 commit message claims "eight findings fixed with red
  witnesses in round 1, both reviewers re-executed their probes at
  41ff037 and returned APPROVE. ... Gates at head: typecheck 0, lint 0,
  unit 92/92, e2e 4/4". The tree it carries is the round-0 tree (round-0
  work history in it records 77 unit tests). The message is false about
  the tree.

Consequences for this phase:
1. CR-209 as specified (reject equal-after-uppercase debitValue /
   creditValue pairs in parseSourceProfileSpec) is UNIMPLEMENTABLE on
   this base: the indicator representation on main has no creditValue
   field and parse-statement compares case-sensitively. The defect
   construction (case-colliding pair reaching a case-insensitive
   comparison) exists only on the unmerged 41ff037 tree. STOPPED that
   thread; reported here and in the final report. Not improvising an
   F2 reimplementation: that would duplicate reviewed-but-unmerged work
   and guarantee a conflict when the orchestrator lands the fix round.
2. CR-208's mechanism (debitCredit branch negates a parsed value instead
   of a magnitude) PRE-EXISTS on this base (reviewer construction P7b:
   original two-populated-column path). In scope and implementable here;
   proceeding with red witness first.
3. The rest of the phase (ledger domain, pairing, corrections,
   interpretation window, recompute, re-parse, reconciliation property)
   is NOT blocked; it builds on main's schema and module structure.
   Proceeding.

Escalation routed per R-034: this note plus a verification-first entry
with contradicts-plan true in the work history plus a dedicated section
in the final report. The orchestrator owns merges; nothing in this
branch cherry-picks the unmerged fix round.

## CR-208: signed values in directional columns fail loud

Red witness FIRST, captured: added the CR-208 describe block to
test/domain/profile-detection.test.ts and ran it against the committed
parser: "Tests 3 failed | 25 passed (28)" (negative debit parsed ok as
+74210 instead of erroring; negative credit and plus-signed debit
likewise). Then the fix: carriesExplicitSign guard in both sub-branches of
the debitCredit arm of amountOf (src/modules/import/domain/
parse-statement.ts), row error problem "amount", which the upload use case
turns into a FAILED import with zero rows (existing "unparseable" path).
After fix: profile-detection 28 passed; full fast suite 81 passed, exit 0.

Mechanism (fix-round contract): "a directional column's cell carrying its
own sign is silently reinterpreted by a branch that derives sign from
representation metadata". Derivation of call sites, executed:
  grep -n "parseAmountToCents(" src/modules/import/domain/parse-statement.ts
  -> lines in signed branch (sign legitimate), debitCredit debit branch,
     debitCredit credit branch (both now guarded), indicator branch
     (Math.abs of the cell; sign discarded, not inverted).
Not covered, stated: the indicator branch. Its fail-loud repair is F2
(commit e10b0cc) of the unmerged M1-P2 fix round; reimplementing it here
would duplicate reviewed-but-unmerged work (see escalation above). The
mechanism rule and the sibling are recorded at the definition
(carriesExplicitSign comment). No tuition mechanism-index feed exists in
this repository to add the rule to (delivery/tuition/ is empty); flagged
for the orchestrator.

Scope note (said the moment it was found): the CR-208 witness lives in
test/domain/profile-detection.test.ts, which is NOT on the M1-P3
files-to-touch list (the assigned backlog item names src/modules/import as
the scope hook). The declaration amendment on the base branch must cover
it, as M1-P2's extras did for its fix-round test files.

## Ledger domain: classification, corrections, pairing, reconciliation

Files: src/modules/ledger/domain/{flow,ledger-transaction,constants,
plain-date-distance,corrections,classify-flow,pair-transfers,interpret,
reconciliation}.ts. Tests: test/domain/classify-flow.test.ts (13),
test/domain/pair-transfers.test.ts (9), test/domain/corrections.test.ts
(13). All green; full fast suite green after the addition.

Key mechanical decisions (recorded for the work history):
- Settlement window SETTLEMENT_DATE_WINDOW_DAYS = 45 (named constant per
  D-11, value unpinned by the plan; the match also needs pattern plus
  exact amount, so width buys robustness, not false positives).
- Card account identification: a POT account without an IBAN (observed
  card exports carry no own-account identifier; such accounts are bound
  via SourceProfile). Used to compute card-import summaries.
- CSV card statements carry no settlement-total field, so the total is
  the sum of the import's debit line items (the addendum's "otherwise the
  sum of its line items" arm); settlement credit rows are not line items.
- The card-side mirror row links to the settlement debit within the D-7
  4-day tolerance (same movement seen twice), tie-broken by date distance
  then id; an unlinked settlement leg (either side) joins the unmatched
  internal set and is surfaced.
- UNRESOLVED arises exactly for zero-amount rows: every nonzero row is
  classified by the declared sets, the settlement step or the sign
  fallback.
- reconcile() computes changeInPot from facts only (sum of raw amounts)
  and difference = unmatchedInternalGap + unresolvedGap by construction;
  0 - x instead of unary minus so a zero total is +0, never -0.

Mutation red witnesses, all executed against the green tree, each mutation
reverted after its run (structurally different members per class):
- M1 drawdown-as-INCOME (H2.2 dangerous state): exit 1, 5 failed | 30 passed
- M2 pot-before-reserve precedence swap: exit 1, 1 failed | 34 passed
- M3b correctCardSettlement always undefined (H2.1): exit 1, 5 failed | 30 passed
- M4 pairing content sort removed, insertion order decides (H2.3): exit 1, 3 failed | 32 passed
- M5 pairing window unbound (400 days): exit 1, 1 failed | 34 passed
- M6 refund correction defanged: exit 1, 3 failed | 32 passed
- M7 cash withdrawal correction defanged: exit 1, 2 failed | 33 passed
- M8 unmatched transfer legs no longer surfaced: exit 1, 1 failed | 34 passed
(M3, a non-compiling variant of M3b, also exited 1 but with a TS error
rather than test failures; superseded by M3b and not counted.)

## Criterion 2.4: reconciliation property test

test/property/reconciliation.test.ts: fast-check 4.9.0 added as a
devDependency (test-only; the criterion names fast-check explicitly).
Generator vocabulary: income, spend, refund pair, cash withdrawal,
reserve park, reserve drawdown, matched transfer (lag 0..4 days),
unmatched internal leg, full card-settlement shape (1..3 line items,
settle lag 1..10 days, mirror present or absent), unitemised settlement
debit (2.8 shape), zero row; 1..12 shapes per dataset, insertion order
scrambled per run, numRuns 500. changeInPot is computed by reconcile from
raw amounts only (facts side); income, spend, net-to-reserves from the
interpretation. Assertions: every reported figure is an integer; with no
surfaced gaps the identity holds exactly and reconciles is true; with
gaps the difference equals unresolvedGap plus unmatchedInternalGap
exactly; coverage tallies assert all five flow values, unmatched legs and
all four correction shapes actually occurred across the run. Green: 1
passed, and full suite green (117 passed).

Property red witnesses (mutations, each reverted after its run):
- P1 unmatched transfer legs dropped from surfacing: exit 1, 1 failed
- P2 mirrorless settlement debit treated as matched: exit 1, 1 failed
- P3 zero rows defaulted into SPEND (UNRESOLVED erased): exit 1, 1 failed
  (caught by the run-wide coverage assertion: the charter's "never
  defaulted into a total" at property level)
Note: category-swap mutations (for example a refund counted INCOME) do
NOT break the identity, because both sides of the equation move together;
those are guarded by the unit suites (M1..M8 above), which is why both
layers exist.

## TransferLink migration (D-6: M1-P3 owns TransferLink)

prisma/schema/ledger.prisma: TransferLink with non-null householdId,
outgoingTransactionId (unique), nullable incomingTransactionId (unique),
nullable settlementImportId carrying the D-11 settlement pairing to a card
Import. Facts tables untouched (back-relation fields on Household, Import
and Transaction are Prisma-side only; the migration contains no ALTER of
facts tables, verified by reading the generated SQL: CREATE TABLE
transfer_links plus indexes and FKs only).

Red witness (natural): after adding the schema, npx vitest run test/schema
-> 1 failed | 23 passed (transfer_links missing ENABLE ROW LEVEL SECURITY
in committed migration SQL). Generated the migration with prisma migrate
dev --name transfer_links with DATABASE_URL/DIRECT_URL pinned to
postgresql://postgres:***@127.0.0.1:54322/postgres (fleet warning 1; the
ambient env carries a foreign pooler). Appended the RLS enablement to the
migration and applied it to the live local db (migrate dev had applied the
pre-append file); pg_class now reports relrowsecurity=t for all eight
application tables incl. transfer_links. test/schema: 24 passed. A full
db:reset re-applying the whole chain is run before the e2e gate below.

Docker daemon was dead (fleet warning); sudo dockerd revived the
m1-p1-skeleton supabase containers exactly as the M1-P2 warning recorded.

## Ledger application layer, pipeline wiring, criterion 2.5 healing

src/modules/ledger/application/{ports,interpret-window,index}.ts,
src/modules/ledger/adapters/ledger-repository.ts. Interpretation runs over
the import's booking-date span padded by
INTERPRETATION_WINDOW_PADDING_DAYS (settlement window 45 + transfer
tolerance 4 = 49 days) across ALL pot accounts; recompute is the same step
with no bounds. Persistence is one transaction: delete links touching the
interpreted set, write flows set-based per flow value, insert links, move
the touched imports INGESTED -> INTERPRETED. The rim residue of window
runs is stated at the constant's definition (a pair straddling the padded
edge; recompute is the canonical repair).

Scope deviations found and declared the moment they arose (the phase list
names src/modules/ledger, src/modules/import, prisma and six test files):
- src/modules/accounts/{application/ports.ts,application/index.ts,
  adapters/account-repository.ts}: listAccounts added; the ledger engine
  needs the declared account list through the accounts module's PUBLISHED
  interface (the alternative, querying accounts from the ledger adapter,
  crosses table ownership). Mirrors M1-P2's declared-deviation pattern.
- test/application/fake-import-world.ts (M1-P2 test infrastructure, not
  on the M1-P3 list): extended with ids, a flow column mirror, a links
  store and a ledger-port fake so the REAL interpret use case runs in the
  fast gate.
- test/domain/profile-detection.test.ts: CR-208 witness (noted earlier).
The orchestrator must amend the phase declaration on the base branch to
cover these before the scope gate runs.

Import pipeline: ImportDependencies gains the interpret stage; upload and
confirm call it after every successful ingest (pipeline: parse ->
identify -> declare -> ingest -> interpret). Composition root binds it to
ledger interpretForImport.

test/application/interpret.test.ts (criterion 2.5): with account B
declared at an earlier first sight, file A's outgoing leg lands INTERNAL
with no link (surfaced waiting state); uploading account B's file (a
different import) heals it: one TransferLink across imports, both legs
INTERNAL, salary INCOME, groceries SPEND, imports INTERPRETED. Also:
re-upload idempotence (identical links and flows, zero rows added) and
recompute-over-everything reproducing the identical state. 3 passed.

Red witnesses (mutations, reverted after each run):
- W1 window collapsed to the import's own rows' dates: exit 1, 2 failed | 1 passed
- W2 window no longer spans all pot accounts: exit 1, 2 failed | 1 passed
Full fast suite after the slice: 120 passed, exit 0.

## Profile-fix re-parse (criterion 2.7, hazard H2.5, closes H1.3)

parseStatementRow extracted from parseStatement (one function parses a
line for BOTH the upload path and the re-parse path, so they can never
drift). New import ports: getProfile, listImportIdsForProfile,
listFactRowsForImport, applyReparse (THE one sanctioned facts rebuild,
documented at the port and at the adapter). Adapter applyReparse is one
database transaction: profile spec update, then a two-phase dedup key move
(every touched row to 'reparse-tmp:'||id via one set-based UPDATE, then
per-row fact columns plus final key), because the per-household unique
index is checked per statement and rows can exchange keys under a
corrected spec. Use case fix-profile.ts: parses every stored rawLine under
the corrected spec (any failure returns row-unparseable and rewrites
NOTHING), recomputes dedup keys with the ingest recipe, applies, then
re-runs interpretation per affected import. Published as fixSourceProfile
on the import module's application index.

test/application/reparse.test.ts: the H1.1 story (indicator file confirmed
as signed column, every amount positive), corrected to the detected spec:
amounts fixed in place, row ids and rawLine preserved, dedup keys
recomputed and distinct (incl. the identical-row pair), account and
profile declarations intact, interpretation rebuilt (mirror INTERNAL,
line items SPEND), re-upload of the same file adds 0 and asks nothing;
the unparseable-correction arm rewrites nothing; unknown profile
rejected. 3 passed. Note: the criterion's "merchant rules intact" half is
VACUOUS on this base: no MerchantRule table exists until M1-P4; the
declaration layer as a whole is asserted untouched instead, and the
re-parse writes only fact columns plus dedup keys by construction.

Red witnesses (mutations in src, reverted after each run):
- R1 re-parse leaves stale dedup keys: exit 1, 1 failed | 2 passed
- R2 corrected spec not persisted (declaration lost): exit 1, 1 failed | 2 passed
- R3 unparseable rows skipped instead of failing loud: exit 1, 1 failed | 2 passed
Full fast suite: 123 passed, exit 0. typecheck exit 0.

## Recompute dev action and the e2e gate

src/modules/ledger/ui/actions.ts: recomputeAction, a server action that
resolves the household context, calls recomputeInterpretation and
revalidates; refuses in production. The dev-only screen carrying its
button belongs to the month view phase (M1-P5); no src/app route is added
here (src/app is not on this phase's declaration).

E2E: db:reset against the local stack (guard satisfied, Prisma consent
env set) applied all three migrations from scratch and seeded; pg_class
reports relrowsecurity=t for all eight application tables. First e2e run
had 3 failures: the dev server inherited the AMBIENT foreign
NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Hemma), which
override .env (fleet warning 1 bites through the webServer too, not only
Prisma). Re-run with all five env values pinned in the invoking shell:
npm run test:e2e exit 0, 4 passed (auth x3, import x1), which also
exercises the new pipeline interpret stage inside the real journey (the
import completes at status INTERPRETED and the result page renders).

## Session kill, base repair, rebase, CR-209 (coordinator-directed)

The session was killed by a transient connection error while the work
history was being started; commits through 0eec116 survived and work
resumed from them (no restart). The coordinator confirmed the escalation:
main HAD been missing the approved M1-P2 fix round (PR #9 merged the
pre-fix head; the fix-round push never landed on origin). RESOLUTION: the
repair merged as 6fc43c9, whose code tree is exactly the reviewed 41ff037
state. The escalation entries above are kept as written (they were true
when written); this entry records the resolution rather than deleting
them.

Rebase of claude/m1-p3-one-pot onto origin/main 6fc43c9: conflicts only in
src/modules/import (upload-statement, confirm-import, ports, index,
import-repository), resolved by taking main's fix-round side as base and
re-applying this phase's additions on top (the interpret call after a
successful ingest claim; the four re-parse port methods beside main's F4
boolean markImportFailed and claimed ingestRows). parseStatementRow's
error union gained the fix round's "indicator" member; the CR-208 sibling
comment in parse-statement.ts was CORRECTED IN PLACE (R-087): its claim
that the F2 repair was absent from the base was true when written and
became false at 6fc43c9; the correction says so instead of silently
rewriting. Post-rebase gates: typecheck exit 0; npm test 138 passed
(this branch's 123 plus main's fix-round suites), exit 0.

CR-209, now implementable (creditValue exists on this base): red witness
FIRST, captured: the new describe block in
test/domain/profile-detection.test.ts ran against the rebased committed
code with "Tests 2 failed | 34 passed (36)" (case-variant pair X/x
accepted; identical pair D/D accepted). Fix: parseSourceProfileSpec's
indicator arm rejects pairs equal after uppercasing (invalid-spec at
amountRepresentation), reason recorded at the check. After fix:
profile-detection 36 passed; full fast suite 141 passed, exit 0.

## Work history, validation, claim grep

delivery/work-history/m1-p3.yaml written and validated: tiphys validate
--type work-history --context (scratch dir symlinking plan.yaml,
work-history.yaml, assurance-modes.yaml, the M1-P2 reviewers' pattern),
exit 0 under Node v26.7.0. Two first-pass validation failures were
repaired: an open-question claim carrying the universal token "every"
(reworded), and a contradicts-plan false record carrying a
plan-language-note over token-free prose (note dropped; the oneOf takes
token-free prose on the cheap branch only).

Claim grep (clause claim-grep), run exactly as written plus the
whitespace-flattened variant. Remaining hits, each settled: three inside
the VERBATIM prompt (quoted dispatch instructions, not claims made by
this history); one in a quoted commit subject whose behavior is settled
by claim M1P3-C5's executed red-witness construction; one "never reached
origin" inside environment warning 4, settled by the adjacent evidence
field (the two captured git diff --stat outputs) and the coordinator's
resolution message. The unexecuted "would catch" remedy sentence was
restated as an explicit unexecuted proposal.

Gate runs at the final CODE head 9b49cfb: typecheck 0, lint 0, npm test
141 passed 0 skipped exit 0, db:reset from scratch then test:e2e 4
passed exit 0 (all five env values pinned). Commits after 9b49cfb touch
delivery/work-history/ only, verifiable with git diff 9b49cfb..HEAD
--name-only. No em dash appears in any file this phase touched (grep
executed, zero hits).

## FIX ROUND 1 (hazard verdict at f274d30, six findings)

### CR-305: signed cell under an indicator representation fails loud

Red witness FIRST, captured: new describe block in
test/domain/profile-detection.test.ts against committed code: "Tests 2
failed | 37 passed (39)" (-742,10 beside marker C parsed +74210; +15,25
beside D parsed -1525). Fix: carriesExplicitSign guard in the indicator
branch of amountOf, row error problem "amount"; Math.abs removed (the
guard makes the parsed value non-negative). The CR-208 mechanism comment
corrected in place: the candidate-follow-up sentence now records CR-305
closed the arm. After: 39 passed; full suite 144 passed, exit 0. Storno
and blank-indicator fixtures carry unsigned cells, unaffected.
