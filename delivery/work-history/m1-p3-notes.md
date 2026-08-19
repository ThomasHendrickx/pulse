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
