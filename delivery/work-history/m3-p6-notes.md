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
