# M3-P6 working notes (card-descriptor merchant grouping, display-only PAN masking)

Appended as the work happens (clause incremental-output). Nothing from the real
statements is written here: the uploads are referred to by 8-hex prefix only
(39bada64 Belfius current account, 0f79fa3d KBC card) and every measurement is
recorded as a COUNT or an abstract shape, never as content.

## 2026-08-21 start

- Read the brief in full, including the appended fleet warnings.
- Read pulse-domain, pulse-typescript, pulse-frontend.
- `df -h /` before any gate or e2e work (fleet warning 10): 19G available, 51% used. OK.
- Toolchain: ambient `node -v` is v26.7.0 (nvm default 26). `npm ci` under
  /opt/node22/bin (node v22.22.2, npm 10.9.7) FAILED: `Missing: @swc/helpers@0.5.23
  from lock file`. Under the ambient node v26.7.0 / npm 11.19.0 `npm ci` exited 0.
  Recorded as an environment warning: the committed lockfile resolves under npm 11,
  not npm 10, even though package.json engines pins node 22.x.

## Step 1, verification-first (before any code)

### (a) Deployed MerchantRule count, and the CR-402 branch it selects

Measured read-only against the pulse deployed Supabase project, ref
ygsarzjqosqmkqibqogk (notes/deployed-infrastructure.md), through the Supabase
management API rather than a psql session-pooler connection string. DEVIATION,
declared here the moment it was found: the plan's step 1 says the count is taken
"over a connection string pinned explicitly to the pulse deployed project's
session pooler". No pulse database password exists in this container or in the
repository (the fleet's infrastructure note records "No secrets in this file,
ever", and the only ambient DATABASE_URL belongs to a different project, fleet
warning 1), so the pinned-connection-string route was not available to me. The
management API is the same route every previous phase used for deployed-schema
work (M1-P1 baseline, M1-P2, M1-P3, M1-P4 records), it is pinned to the pulse
project by its ref, and it is read-only here. Same measurement, different
transport.

Query (project_id ygsarzjqosqmkqibqogk):

    select count(*)::int as merchant_rules,
           (select count(*)::int from public.merchants) as merchants,
           (select count(*)::int from public.transactions) as transactions,
           (select count(*)::int from public.imports) as imports
    from public.merchant_rules;

Result: `[{"merchant_rules":0,"merchants":0,"transactions":0,"imports":1}]`

The one deployed import is in status AWAITING_DECLARATION (`select status,
count(*) from public.imports group by status` -> AWAITING_DECLARATION 1), which
is why no transaction rows exist yet.

BRANCH SELECTED under the CR-402 stability contract: the ZERO branch. No stored
MerchantRule patterns exist, so there is nothing to re-normalise and no data
migration ships. The contract is discharged by updating the pinned regression
table in test/domain/normalise-counterparty.test.ts in the same commit as the
recipe change, plus this recorded measurement. Criterion 6.6 requires the same
measurement again at the release head; if it is nonzero then, the phase does not
close until the re-normalisation branch ships.

### (d) The predicate that defines a card row, written down explicitly

PREDICATE P-CARD, chosen to be executable rather than implicit: a row is a CARD
ROW when its uppercased descriptor matches

    /\bKAART\s+NR\s+(?:\d{4}[ .-]?){3}\d{4}\b/

that is, the Belfius card-number LABEL (the card word followed by the number
word) followed by a four-group sixteen-digit run. This is the plan's predicate:
it reproduces the plan's 15 exactly. A second, broader predicate P-LABEL is also
measured and reported separately, because the partially masked tail carries the
label word WITHOUT the number word:

    /\bKAART(?:\s+NR)?\s+(?:[0-9X]{4}[ .-]?){3}[0-9X]{4}\b/

### Counts measured in-container through the SHIPPED pipeline (39bada64)

Extraction -> reconstructPdfLines -> belfiusCurrentAccountTemplate.parse ->
normaliseCounterparty, all at the phase base 68fc7ee. Counts only:

- rows parsed: 39
- rows matching P-CARD: 15; rows matching P-LABEL: 23
- of the 23 P-LABEL rows: 15 carry the FULL grouped sixteen-digit tail, 8 carry
  the PARTIALLY MASKED tail (four groups, the middle two X-masked, last four
  digits in the clear)
- card rows carrying counterpartyName: 0 (so the merchant key is the whole
  descriptor, which is the root cause)
- distinct normalised keys among the 15 card rows under the SHIPPED recipe: 15
  (one key per row: the defect)
- card keys still carrying a sixteen-digit separator-insensitive run: 15 of 15
- descriptors carrying a CONTIGUOUS sixteen-digit run, no separator removal: 0
  of 39. The number is printed group-spaced, so a contiguous-digits regex
  matches nothing and cannot fail (finding PR3-001 reproduced).
- card keys carrying the trailing holder-like "- WORD WORD" shape: 15 of 15
- card keys carrying a bare day-and-month token: 15 of 15
- card keys carrying an amount followed by a currency code: 15 of 15
- descriptors carrying an X-run of two or more: 11. Of those 11: 0 carry the
  P-CARD label, 8 carry the bare label word (they are the partially masked
  tails), and 8 end in a holder-like "- WORD WORD" tail. This is exactly the
  plan's "the card-number label occurs in 15 of 15 card descriptors and 0 of the
  11 X-token descriptors, while holder-like text follows in 8 of those 11", with
  "the card-number label" read as the label-plus-number-word form.
- SWEEP WINDOW, over NORMALISED KEYS (which is the surface criterion 6.3
  sweeps): keys containing a 13-to-19-digit run after spaces, dots and dashes
  are removed: 20 of 39; NON-card keys with such a run: 5. Both reproduce the
  plan's numbers exactly.
- Standalone structured-reference TOKENS on non-card rows: lengths 15, 15, 15
  and 13. The plan's "13-digit and 15-digit references" reproduced.
- PREDICATE-SENSITIVITY NOTE, recorded because the plan's step 1(d) exists for
  it: the same sweep run over RAW DESCRIPTORS rather than normalised keys gives
  28 of 39 and 13 non-card rows, not 20 and 5, because an IBAN glued to its
  neighbours by separator removal yields a fourteen-digit run. The plan's counts
  are correct for the surface the criterion names (keys); they would be wrong
  for descriptors. This does not change any design decision: more non-card rows
  carrying a long run makes the named-exception design more necessary, not less.

### (b) Pre-change grouping measurement on the committed synthetic fixture

Recorded in the same commit as the fixture itself (the fixture does not exist
yet at the phase base). See the "pre-change pin" section below.

### (c) The real statement's merchant count is NOT what any criterion asserts

Every acceptance criterion in this phase runs on SYNTHETIC fixtures with
invented values. The real statement's merchant count is a measurement about one
real file and is deliberately not asserted anywhere in the suite.

## Step 1(b), the pre-change pin on the committed fixture

test/fixtures/card-descriptors.csv is committed in this phase (synthetic,
invented values in the real grammar, 13 rows, one account, two months).
Measured through detectSourceProfile -> parseStatement -> normaliseCounterparty:

- BEFORE the recipe change (base 68fc7ee): 12 distinct keys over 13 rows. The
  ONE fixture merchant's five rows produced FIVE distinct keys, one per row,
  which is the defect this phase exists to fix.
- AFTER the recipe change: 8 distinct keys over 13 rows. The same five rows
  produce ONE key, "KOFFIEHUIS DE MOLEN GENT BE".
- The row carrying a legitimate 15-digit structured reference keeps it in its
  key, before and after.
- The non-card control row (an X-masked token followed by holder-like text,
  no card-number label) has the SAME key before and after:
  "ONLINE AANKOOP WEBSHOP DE VLIEGER 4000 12XX - JANSSENS PIETER". That
  string is pinned in the test as the pre-change literal.

## Steps 2 and 3, executed

RED WITNESS for the grammar, captured before the recipe was applied:
`npx vitest run test/domain/normalise-counterparty.test.ts` -> 6 failed | 47
passed. The six were the collapse assertions (same merchant across dates,
across months, across both tail shapes, the dash-separated number, the second
rail, and the sweep asserting no key retains the invented card number). After
the recipe: 61 passed, 0 failed (the eight new pins bring the file to 61).

RED WITNESS for criterion 6.10, captured immediately before the unification:
`grep -rlE 'counterpartyName \?\? [A-Za-z_]*\.?description' src/` returned 5
files (the two call sites, the two frozen sibling recipes, and the new shared
definition). After the unification it returns 3: the module exporting the
shared helper plus dedup.ts and corrections.ts, which is exactly what the
criterion demands.

NONE OF THE PRE-M3-P6 PINS MOVED. The card patterns are additive over the
earlier corpus. Recorded as an observation about this corpus, not as a
property of future recipe changes.

## Step 5, display-layer masking, with its red witness

RED WITNESS, against the DANGEROUS STATE rather than an absent feature.
With the strip already landed and the masking helper written but NOT wired
into either label surface, the new e2e spec was run against the local dev
server:

    PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test \
      --project=chromium -g "no rendered label carries a card number"

    1 failed
    Error: expect(received).toEqual(expected)
    - Array []
    + Array [ "415123456789012" ]
    at sweepGroupLabels (test/e2e/merchants.spec.ts:113)

That is a real thirteen-to-nineteen-digit run rendered on the merchant
review screen. After wiring maskCardNumbers into both label surfaces the
same command exits 0.

## TWO PRE-EXISTING PHONE-VIEWPORT DEFECTS, FOUND BY CRITERION 6.7

Both were surfaced by the 390x844 assertions and BOTH are outside this
phase's files-to-touch. Declared here the moment they were found; the file
is src/app/globals.css. See the deviations section of the work history:
this phase needs a files-to-touch amendment on the base branch, or an
explicit acceptance of the excess.

1. MERCHANT REVIEW, measured scrollWidth 462 at a 390 viewport. The
   overflowing element, measured element by element in the page, is
   .merchant-name-form (width 262) in a non-wrapping .merchant-row. Nothing
   in M3-P6 widened that row: the naming form has carried its intrinsic
   width since M1-P4, and the merchant review screen had no phone-viewport
   assertion before this phase added one. Fixed by letting the row wrap.
2. MONTH VIEW, measured scrollWidth 424 at a 390 viewport as soon as the
   month holds data. Cause: .month-grid was a two-track grid whose second
   track was the fixed --layout-rail width and could not shrink. The
   phone-viewport spec M3-P1 added could not see this, because it visits
   the routes on a household with NO import, where the month view renders
   its empty state and this grid is not in the document at all. Fixed by
   replacing the fixed track with wrapping flex, which keeps the desk
   layout identical (rail at --layout-rail, spend taking the remainder)
   and needs no breakpoint literal.

## The anchor guards, reddened under TWO structurally different wrong implementations

R-037a asks a class witness to redden under at least two structurally
different members. Both were executed against the real tree, one at a time,
with the good file copied out first and restored after (`git status` clean
afterwards).

MUTATION A, the masked tail anchored on the four-group run plus the holder
text, with the card-number label removed from the pattern (the shape finding
PR4-002 and PR5-003 name):

    npx vitest run test/domain/normalise-counterparty.test.ts \
      test/domain/merchant-review.test.ts
    Tests  15 failed | 61 passed (76)

among them "a non-card row carrying an X-masked token followed by
holder-like text is UNCHANGED by the strip" and its criterion-6.1 twin, plus
the pinned row for the control.

MUTATION B, an ADDITIONAL strip keyed on digit-run length alone, which is
exactly what step 3 forbids:

    npx vitest run test/domain/normalise-counterparty.test.ts \
      test/domain/merchant-review.test.ts
    Tests  5 failed | 71 passed (76)

among them "a legitimate 13-to-19-digit structured reference on a NON-card
row survives in the key", its criterion-6.1 twin, the pinned reference row,
the idempotency check, and criterion 6.3(b)'s named-exception sweep.

So the two guards are not merely green: each reddens under the specific
wrong implementation it exists to refuse, and neither reddens under the
other's.

## A THIRD implementation of the merchant-source rule, in SQL

Found while checking criterion 6.10's "no fourth definition in an equivalent
form the literal pattern cannot see". The literal pattern is TypeScript and
cannot see SQL: src/modules/overview/adapters/overview-repository.ts:95 and
:266 both compute COALESCE(t."counterpartyName", t."description") as the
counterparty text, which is the same rule. It is raw SQL by design
(pulse-domain section 9), so it cannot call the shared helper. This phase
did not rewrite the aggregation; the sibling is now NAMED at the helper's
definition so the next reader of that rule meets it (clause
mechanism-sibling). Recorded as an open question.

## Privacy gate, criterion 6.8

Both real uploads are present in this container, so the criterion is
witnessed rather than recorded as not-witnessed. Probes are derived from the
uploads AT RUN TIME, held in memory, and never printed or written: only
counts, categories and repository paths appear anywhere.

TIGHT RUN, high-value probes only, each derived from a POSITION in the real
grammar rather than from a generic token filter: IBANs in both forms,
long structured references, the identifier fragments embedded in the two
FILE NAMES themselves (fleet warning 9), the card number in every grouping
shape plus each of its four-digit groups, the holder tail that follows the
card number on a card row plus each of its tokens, and the merchant span
between the rail prefix and the country code on every card row. Descriptors
are assembled through the shipped template first, because a per-line probe
cannot see a descriptor that spans several indented lines.

    tight probe categories: iban=18 ref=17 filename=5 card=12 holder=3
                            merchant=11 total: 66
    HALF (a) whole-worktree hits: 0
    HALF (b) changed-file hits: 0
    TIGHT_EXIT=0

BROAD RUN, deliberately over-inclusive (every token of five or more letters
on a card row, every thousands-form amount, every date in the file): 132
probes, 6 whole-worktree hits and 2 changed-file hits. EVERY ONE of those 8
hits is a probe that ALSO matches at the PHASE BASE 68fc7ee, so this phase
introduced none of them; they are collisions between generic vocabulary (a
public city name, a round amount, a calendar date) and content committed
long before this phase. No identifier, card, holder or filename probe hit
anything, in either run, anywhere. The two files this phase ADDS
(test/fixtures/card-descriptors.csv, src/platform/ui/mask-card-number.ts)
and the new test file carry zero hits under either probe set.

INDEPENDENT IN-MEMORY SCRUB, run so a git-grep flag or pathspec mistake
cannot make the gate vacuous: every changed file read as bytes and searched
in memory, plus this branch's full commit messages and patch text via
`git log -p 68fc7ee..HEAD`. Changed-file in-memory hits: 2, both from
base-matching generic probes. Commit-and-patch hits: 0.

## Per-criterion walk at the head

- 6.1 GREEN. `npm test` exit 0. Five rows of one fixture merchant, differing
  in date and amount across two months AND carrying the card tail in both
  observed shapes, produce ONE key and ONE review group holding all five
  (`groups[0].count === 5`). The same five pinned against the PRE-change
  recipe produce five keys; both numbers are recorded above (5 before, 1
  after; over the whole fixture 12 distinct keys before, 8 after). The
  structured-reference row's 15-digit reference survives in its key and is
  asserted to be inside the 13-to-19 window rather than dodging it. The
  non-card control row's key is asserted equal to its captured pre-change
  literal.
- 6.2 GREEN. Two merchants sharing a chain prefix and a city are two keys and
  two review groups, one containing NOORD and one ZUID.
- 6.3 GREEN. The same separator-insensitive test is used by both halves and
  is written once per file as `cardNumberRuns`. (a) No key and no rendered
  label from the card fixture contains the invented card number. (b) Exactly
  ONE key carries a 13-to-19-digit run and the assertion names it as the
  permitted exception; no rendered label on either surface carries one. The
  display helper masks every printed shape (space, dash and dot grouped, and
  contiguous) and holds at both window boundaries. `npm run test:e2e` exit 0
  with the same two sweeps over the rendered labels of both screens.
  DECLARED READING: the helper masks the exception row's reference in the
  LABEL too, so the label side of 6.3(b)'s permission goes unused. Open
  question M3P6-C7.
- 6.4 GREEN. The submitted subject is the unmasked normalised text, the
  stored rule is EXACT with pattern equal to that text, and after recompute
  all five rows carry the merchant, including the two September rows that
  were not the row named.
- 6.5 GREEN. `git diff --name-only 68fc7ee..HEAD | grep -E 'dedup\.ts|corrections\.ts'`
  exits 1; `git diff --stat 68fc7ee..HEAD -- test/domain/dedup.test.ts` is
  empty; re-importing the fixture reports added 0 and known 13; every stored
  rawLine is one of the file's own lines verbatim and every card row's
  rawLine still carries the unmasked card number and no mask marker; the
  stored rawContent equals the uploaded bytes.
- 6.6 GREEN. The deployed MerchantRule count, the command and the branch it
  selects are recorded above and in the work history. The pinned table was
  updated in commit 48cd54d, the same commit as the recipe change. The count
  was ZERO, so the migration test 6.6 conditions on is NOT REQUIRED and none
  was written. RE-MEASURED AT THE HEAD with the same query: still zero.
- 6.7 GREEN. The phone spec sets its own viewport with test.use in
  test/e2e/merchants.spec.ts, so playwright.config.ts is untouched. Both
  screens render their group labels masked and both report
  document.documentElement.scrollWidth of at most 390. Getting there needed
  two fixes in src/app/globals.css, which is the declared excess.
- 6.8 GREEN, witnessed rather than vacuous: both real uploads are present.
  Tight run 66 probes, 0 hits in both halves, exit 0; broad run's 8 hits all
  pre-existing at the phase base; independent in-memory scrub over changed
  files and over the branch's commits and patch.
- 6.9 GREEN. typecheck 0, lint 0, gate:tokens 0, `npm test` 0 with
  322 passed / 322 discovered / 0 failed / 0 skipped / 0 todo over 28 files,
  `npm run test:e2e` 0 with 21 passed including the unmodified golden journey
  and the production-mode smoke.
- 6.10 GREEN, all three halves executed at the head. Recorded above.

## claim-grep, run exactly as the clause carries it, and settled

    grep -nEi 'cannot be|impossible|needs a|is covered|catches|would catch|recovers|anyway|always|never|no way to' delivery/work-history/m3-p6.yaml

12 hits, plus the same pattern over the whitespace-flattened text (which
found nothing extra: 2 "cannot be", 2 "needs a", 10 "never", all already on
the line-based list). Settlement, one by one:

- Lines 11, 28, 40, 48 and 212 are inside the VERBATIM prompt block or inside
  a quoted plan clause. R-052a records the prompt verbatim, so these are not
  claims of mine to settle.
- Line 199, "are not recomputed by calling the new normaliser": settled in
  place by naming the constant and the command that shows it is a literal
  array (`grep -n 'PRE_CHANGE_KEYS_OF_THE_ONE_MERCHANT' -A 3
  test/domain/merchant-review.test.ts`), executed, output above.
- Line 377, "never touches the value the review form submits": the adjacent
  executed construction in claim M3P6-C3 is the test run that asserts it.
- Line 404, "never committed": restated to name the evidence, a clean
  `git status` at the head and a 13-path scope diff that does not list the
  script.
- Lines 475 and 476, the two "cannot" sentences: restated as "I found no way
  to satisfy criterion 6.7 from a file on the list", with the measured
  overflow figures and the specific CSS rules named, inside an open question
  that carries still-open-because.
- Line 235, "needs a files-to-touch amendment": that is the open question
  M3P6-C9, handed back rather than asserted as settled.
- Line 494, "never widen the pattern": a quotation of the kernel mechanism
  index's own rule, attributed in place.

# FIX ROUND 1

Both verdicts FIX-ROUND-NEEDED at e0704a5. Merged origin/main first, so the
merge base is 77da0c6 and both plan amendments (src/app/globals.css at
29c4745, src/modules/import/ui/profile-confirmation.tsx at 77da0c6) are
visible from it. Fixed in the order the coordinator set: HZ-01 before CR-01,
then the mediums, then the lows.

## HZ-M3P6-01 (high) THE MASKER DID THE WRONG JOB. Fixed first.

The mechanism, not the instance: identifying a value by the SHAPE it happens
to have instead of by the GRAMMAR that defines it. The helper keyed on a
13-to-19-digit run; the merchants normaliser one module over already refuses
exactly that and says so in its own rules.

RED WITNESS, the reviewer's own probe shapes with invented values, run
against the SHIPPED helper:

    npx vitest run test/domain/merchant-review.test.ts
    Tests  2 failed | 14 passed (16)
    -> expected 'OVERSCHRIJVING NAAR BE**** 7034 ENERGIE NOORD'
       to be 'OVERSCHRIJVING NAAR BE68 5390 0754 7034 ENERGIE NOORD'
    -> expected 'KAART 4000 12XX XXXX 9010' to be 'KAART **** 9010'

The first is a spaced IBAN mangled into something that looks like a masked
card number; the second is a real printed card tail the shape test did not
even reach. Both green after the helper was anchored to the card-number
label.

The false sentence at mask-card-number.ts:41 is CORRECTED IN PLACE AND
LOUDLY (R-087) rather than deleted: the file now quotes the old claim, says
it was false, says what falsified it, and states the trade the new anchor
buys, including the cost that a card number printed with NO label is not
masked.

MEASURED ON THE OWNER'S OWN FILE, before and after, counts only:
  before: 5 of 27 keys changed by the masker, 0 of them card rows
  after:  0 of 39 keys changed by the masker
          23 of 39 RAW descriptors changed, ALL of them card-label rows,
          0 non-card rows touched
          0 of 15 card descriptors retain a window run after masking
          0 non-card descriptors had a window run touched

## CR-M3P6-01 (high) THE CONFIRM PREVIEW. Fixed second, on the corrected helper.

RED WITNESS against the shipped preview, at 390x844 through the real import:

    PLAYWRIGHT_BASE_URL=... npx playwright test --project=chromium -g "..."
    Expected substring: not "4000123456789010"
    Received string: "20260804  DEBITMASTERCARDBETALINGVIAGOOGLEPAY04/08...
                      KAARTNR4000123456789010JANSSENSPIETER  4,20"

Green after both preview cells render through the helper. The e2e now sweeps
the five preview rows with the same separator-insensitive test the group
labels use, and asserts at least four of them carry the mask marker, so the
sweep cannot pass by the rows happening to carry no card number.

THE SET OF SURFACES IS DERIVED, NOT REMEMBERED. The grep is in the fix-round
section of the work history and in the helper's own comment: eight JSX sites
in three files, five masked, three excluded with their reason. CR-M3P6-03
(the reconciliation gap row) came out of that derivation and is fixed in the
same commit.

## The mediums

- HZ-M3P6-03: the rail prefix is now the pinned alternation of the two rails
  observed. Fixture pair plus two pinned rows; the reviewer's collapse no
  longer happens.
- HZ-M3P6-04: the amount strip is anchored by a lookahead at the card-number
  label, reads BOTH thousands forms and starts at a field boundary. Three
  pinned rows including a non-card amount that must survive. The comment
  calling it "the transaction's own amount" is now true.
- HZ-M3P6-06: the Dutch contactless token is added, and the two rails are
  unified by keeping the CITY on both (the postal CODE is dropped, the city
  token stays, and a card descriptor's separator dashes are dropped as whole
  tokens). The false grounding comment is corrected in place. Measured on the
  owner's file: any-label keys 11 -> 9, all-row keys 27 -> 25, and the two
  merged groups that appear are exactly the two merchants the review found
  split across rails.
- HZ-M3P6-02: the floor returns the input with the card-number tail replaced
  by its LABEL, put back through the pipeline so the floor is a fixed point.
  Fixture row, pinned row, and a key-sweep assertion.
- HZ-M3P6-05 / CR-M3P6-02: the SQL copy is hoisted into one module-local
  fragment and pinned by a test that reads the file. The comment at the
  helper's definition is updated in place.

## HZ-M3P6-08, answered with evidence rather than with the edit proposed

The proposed edit (skip the trailing-city loop on card descriptors) was
IMPLEMENTED and then REJECTED. It makes the key space not closed under the
pipeline, and the pinned idempotency assertion caught it:

    -> expected 'FIETSPUNT DE KETTING' to be 'FIETSPUNT DE KETTING GENT'

assign-merchant.ts normalises the submitted subject again, so the stored
EXACT rule would have been the city-less string while every matching row keys
with the city: the owner's naming would have matched NOTHING while every
total stayed right. That is hazard H6.4 and it outranks a latent merge of two
branches of one chain. The behaviour is pinned as what it is, and a NEW
closure invariant asserts over every group the fixture produces that a
submitted subject re-normalises to itself.

## The 6.2 escalation

Both collapse paths now have their own fixture pair and their own pinned
rows: the rail token (GROEPS-AANKOOP versus the bare name) and the trailing
city (FIETSPUNT in two cities). A third pair witnesses the cross-rail merge
that HZ-M3P6-06 asked for. Fixture rows 13 -> 19.

## Regression measurement, phase base versus fix-round head

Every committed CSV fixture except the one this phase added has ZERO key
changes, the three KBC card fixtures included: 86 rows, 14 changed, all 14 in
card-descriptors.csv.

## Privacy gate at the fix-round head, including one hit that was resolved

TIGHT RUN, 66 high-value probes derived at run time from both real uploads:
0 whole-worktree hits, 0 changed-file hits, exit 0.

BROAD RUN, deliberately over-inclusive: the first execution at this head
reported ONE hit INTRODUCED by this phase, in
delivery/work-history/m3-p6-notes.md, category "merchant". It was resolved
rather than waved past. The matched string was located by index in my own
file and is the payment-rail word for "card" with a leading apostrophe glued
to it: my probe tokenizer treated an apostrophe as a word character, so a
quoted occurrence in an extracted line became a six-character "merchant"
probe. It is rail vocabulary, not an identifier, a name, a merchant string,
an amount or a date, and the line it matched is a test expectation of my own
containing an INVENTED card number. The tokenizer now splits on the
apostrophe as well, and the broad run reports 130 probes, 6 whole-worktree
hits and 2 changed-file hits, every one of them a probe that ALSO matches at
the phase base 77da0c6, so this phase introduces none. In-memory scrub over
the changed files: 2 hits, both from those same base-matching generic
probes. In-memory scrub over the branch's commit messages and full patch: 0.

## Gates at the fix-round head

typecheck 0, lint 0, gate:tokens 0, npm test 0 with 338 discovered / 338
passed / 0 failed / 0 skipped / 0 todo over 28 files, npm run test:e2e 0 with
21 passed across both Playwright projects, the golden journey and the
production-mode smoke included.

## Scope diff after the final build

15 paths. files-to-touch plus the plan's two extras at 77da0c6
(src/app/globals.css, src/modules/import/ui/profile-confirmation.tsx) plus
the two standing work-history extras account for 14. The one excess is
src/modules/overview/adapters/overview-repository.ts, required by
HZ-M3P6-05 and CR-M3P6-02, declared in the commit that makes it and in the
work history's deviations.
