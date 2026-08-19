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
