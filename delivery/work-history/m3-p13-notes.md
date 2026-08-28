# M3-P13 running notes (the schema-valid work history is m3-p13.yaml; this file carries the per-criterion walk and the captures)

Worktree /home/user/wt-m3p13, branch claude/m3-p13-identity-on-review, base
origin/main 975d0ce.

## Mechanism lookup (clause mechanism-lookup)

The fleet checkout has no `tuition/mechanism-index.yaml` of its own; the only
copies under /home/user/pulse-fleet are inside `node_modules/@tiphys/kernel`,
and that is the index the composed brief's mandated reading points at. It was
read.

- **Checking a generated artifact against its own generator.** APPLIES, to the
  pin between `test/e2e/identity-fixture-facts.ts` (the restatement) and
  `test/fixtures/generate-pdf-fixtures.ts` (the authority). The index's rule:
  compare by SET EQUALITY AND FIELD PRESENCE rather than by containment, and
  derive per item at run time rather than pinning a count. The first draft of
  the pin compared three named fields one by one, which is the containment
  shape that entry refuses. It now enumerates `Object.entries` of the
  restatement at run time, requires each name to exist on the generator's
  export, and compares the values, so a field added to the restatement without
  a counterpart is red rather than unexamined
  (`test/domain/identity-on-review.test.ts`, "every value the e2e module
  restates is the generator's value under the same name").
- **Every other entry in the index** (guard failure paths, append-only logs,
  claim files, leases, worktree removal, remote access, reporter parsing,
  supervising an agent, atomic replacement, shared worktrees, error
  classification, deciding another program's behaviour by pattern-matching a
  file) has no call site in this phase: the phase adds one pure display helper,
  three fields on a projection type, one column on a read, and rendering.
- **The mechanism this phase ESTABLISHES a rule for** has no entry in the
  index: REDACTING AN IDENTIFIER OUT OF TEXT THAT IS ABOUT TO BE SHOWN. Per
  clause mechanism-sibling the rule is recorded at the definition
  (`src/platform/ui/mask-account-number.ts`) and its siblings are named there:
  `src/platform/ui/mask-card-number.ts` and
  `src/modules/merchants/domain/normalise-counterparty.ts`. The rule: redact on
  the identifier's GRAMMAR, never on its shape; never let the redacted value
  reach a key, a dedup input or a stored pattern.

## Per-criterion walk

| Criterion | Status | What settles it |
|---|---|---|
| 13.1 | MET | `test/e2e/identity-on-review.spec.ts`, "criteria 13.1, 13.2, 13.3 ...": asserts by testid on the RENDERED page that the group whose data-group-key is the account identity renders `group-count` "3 rows" and `group-basis` equal to the English catalogue string for the shared-account basis, and that at least one unresolved group renders the shared-description string. Fast-gate companions in `test/domain/identity-on-review.test.ts` pin the domain half. |
| 13.2 | MET WITH A DEVIATION | The masking half, the identity-key half and the derivation half are all met and asserted. The clause "does NOT contain the unmasked account anywhere, asserted over the full page source" is NOT asserted literally, because it contradicts the same criterion's requirement that the hidden field carry the namespaced identity key, which for an account-basis group IS the namespace plus that account. See the verification-first record and the deviation in m3-p13.yaml. What is asserted: the account appears in no rendered text in either the compact or the spaced shape, and every occurrence in the page source sits in the hidden `counterpartyText` field or the row's `data-group-key`. The derivation half ("the same masking function is not called anywhere in src/modules/merchants/domain or src/modules/merchants/application") is a walk over both trees, asserted to find files at all first. |
| 13.3 | MET | Same spec: opens the disclosure, asserts three `group-row` elements, three distinct dates, three distinct descriptions, and that the three rendered amounts sum to the rendered group total in integer cents. |
| 13.4 | MET | `test/e2e/identity-on-review.spec.ts`, "criterion 13.4 ...": the three-row group's form renders the catalogue string carrying 3 and a one-row group renders the same key carrying 1, in English, then again with the locale cookie set to nl and to fr. The reach element is asserted to be INSIDE `form.merchant-name-form`. |
| 13.5 | MET | Same file, "criterion 13.5 ...": both direction totals read before and after a naming on the account-basis group and compared byte for byte, plus the naming reaching exactly the three rows it promised. The pre-existing H3.2 journey in `test/e2e/merchants.spec.ts` is unchanged and green. |
| 13.6 | MET | `npm run gate:tokens` exit 0, and the CSS this phase adds uses only tokens that already exist, so no token was added to `styles/tokens.css` and the criterion's second clause is vacuously satisfied rather than skipped. |
| 13.7 | MET | The three keys `groupBasisAccount`, `groupBasisDescriptor`, `groupReach` and `groupRowsShow` are added to all three catalogues in one commit; `test/app/catalog-parity.test.ts` is the existing copy gate and it passes. No user-facing string is hardcoded in `merchant-review.tsx`: every rendered sentence comes from `t(...)`. |
| 13.8 | MET | Gate table in m3-p13.yaml, each with its captured exit code, including `npm run test:e2e`. |
| 13.9 | MET | The new spec imports its account numbers from `test/e2e/identity-fixture-facts.ts`, whose two values are the committed fixture generator's own invented values and are already on `test/fixtures/allowed-identifiers.txt` (lines carrying BE31111122223333 and BE78222233334444, added with provenance by earlier phases). `npm run gate:privacy` exit 0. No descriptor, counterparty, place, amount or date from either real document appears in this phase's work history or in any commit message on the branch. |

## Captures

### The pre-phase label carried the account in full (hazard H13.2)

    $ npx tsx <probe calling normaliseCounterparty(counterpartyText({description})) on the committed fixture's own invented account>
    label carries the account spaced: true
    label carries the account compact: false

That is why the spec asserts the SPACED shape as well as the compact one: a
compact-only assertion passes against the unfixed screen.

### The first slow-gate run was invalidated and discarded

Run 1 was started after a hand-run `npm run build`, which writes the production
output into `.next`, the directory `next dev` uses. Three specs failed, one of
them the wrong-password sign-in line, which this phase cannot reach. After
removing `.next` and `.next-prod` and re-running, two of the three passed. Run 1
was also polluted by edits made to `test/e2e/` while it was running. Both facts
are recorded as environment warnings in m3-p13.yaml.

### The instrument the product legitimately changed under

`test/e2e/accounts.spec.ts:216` (CONTROL ARM) asserted that the group labels on
`/merchants` contain "EIGEN REKENING" and "EIGEN SPAARREKENING", which are
fragments of the uppercased NORMALISED DESCRIPTOR an account-basis group used
to be labelled by. Decision D-41 labels such a group by the counterparty NAME
the statement carries where any of its rows carries one, so the label is now
that name and nothing else. The assertion was updated to compare the label
EXACTLY, in the case the statement printed it, which is stronger than the
substring form it replaces: the old form passed on any label that happened to
contain those words inside a longer string.

### Criterion 13.6, run as a grep over the ADDED lines rather than over the files

Running the criterion's grep over the whole changed files returns three hits in
`src/app/globals.css` (`width: 1px` and `height: 1px` inside the pre-existing
`.visually-hidden` clip, and the `min-width: 768px` media query), none of them
added by this phase. Over the added lines only:

    $ git diff origin/main...HEAD -- src/app/globals.css src/platform/ui src/modules \
        | grep "^+" | grep -vE "^\+\+\+" \
        | grep -nEi "#[0-9a-f]{3,8}\b|rgb\(|hsl\(|oklch\(|[0-9.]+(px|rem)"
    (no output)

No token was added to `styles/tokens.css`, because every value the new rules
need already had one.

### Criterion 13.7, the hardcoded-string grep

    $ grep -nE '>[A-Za-z][A-Za-z ]{3,}<' src/modules/merchants/ui/merchant-review.tsx | grep -v "t("
    (no output)
    $ grep -c 't("' src/modules/merchants/ui/merchant-review.tsx
    24

### The second instrument the product legitimately changed under

`test/e2e/pressed-and-disabled.spec.ts` sweeps every interactive control the
journey reaches and asserts the collected set EQUALS a written enumeration, in
both directions, with a literal count beside it. The disclosure this phase adds
to the review row is a `summary`, so the sweep found a twenty-second control:

    Error: the swept control set is not the enumeration
    +   "summary.merchant-row-detail-summary|Show these transactions",

Criterion 9.2(a) says that when the sweep and the enumeration disagree the
ENUMERATION is amended and the sweep is never narrowed. It was amended, and the
literal count went from 21 to 22 with a note saying why it is a literal rather
than `ENUMERATION.length`. The new control needed no new appearance rule: the
pressed, disabled and busy rules are declared at element scope for `summary`
(`summary:active`, `summary[aria-disabled="true"]`, `summary[aria-busy="true"]`
in `src/app/globals.css`) and `.merchant-row-detail-summary` sits one
specificity step below each of them, so the whole measured appearance came out
of the rules that were already there.

Verified in isolation before the final full run:

    $ npx playwright test test/e2e/pressed-and-disabled.spec.ts
    11 passed (5.7m)   EXIT=0

### Slow-gate run history

| Run | What it measured | Result |
|---|---|---|
| 1 | Discarded. Started after a hand-run `npm run build` polluted `.next`, and edits landed under `test/e2e/` while it ran. | invalid |
| 2 | Diagnostic. Found the accounts control-arm label assertion and the page-source assertion in the new spec; aborted at 39 of 122 once both were understood. | invalid |
| 3 | Full run at the fixed tree. 117 passed, 4 failed, all four the same control-enumeration mismatch across two projects. | exit 1 |
| 4 | Full run after the enumeration amendment. | recorded in m3-p13.yaml |

---

# FIX ROUND ONE (2026-08-28)

Both clean-room lanes returned FIX-ROUND-NEEDED.
Verdicts read in full and every finding verified in this worktree before any
change: `delivery/review/m3-p13-criteria.yaml` on `claude/m3-p13-rev-crit`
(2cc76a4) and `delivery/review/m3-p13-hazard.yaml` on `claude/m3-p13-rev-haz`
(4738670).

## THE RED-THEN-GREEN WITNESS for the separator set (HZ-M3P13-01)

Verified first with a direct probe against the committed mask, using the
committed fixture's own invented account, before any test was written:

    $ npx tsx <probe calling maskAccountNumbers on nine renderings of one account>
    compact                        masked=true
    ASCII space U+0020             masked=true
    no-break space U+00A0          masked=false
    narrow no-break space U+202F   masked=false
    thin space U+2002              masked=false
    tab U+0009                     masked=false
    newline U+000A                 masked=false
    full stop                      masked=false
    hyphen                         masked=false

`masked=false` means the token was returned VERBATIM, in full.

RED, with the witness committed before the fix (commit "witness first: the
display mask is red on every separator but the ASCII space"):

    $ npx vitest run test/domain/identity-on-review.test.ts
    × an account grouped with no-break space U+00A0 is redacted, not printed
    × an account grouped with narrow no-break space U+202F is redacted, not printed
    × an account grouped with thin space U+2002 is redacted, not printed
    × an account grouped with tab U+0009 is redacted, not printed
    × an account grouped with newline U+000A is redacted, not printed
    × an account grouped with full stop is redacted, not printed
    × an account grouped with hyphen is redacted, not printed
    × an account grouped with form feed U+000C is redacted, not printed
    × the separator set the mask accepts is the set the canonical form removes,
      plus the two the card mask already tolerates
    ✓ an account grouped with ASCII space U+0020 is redacted, not printed
      Tests  9 failed | 17 passed (26)      EXIT 1

The ASCII-space row passing is what says the table is a real discrimination
and not a uniformly red file. The class is witnessed by structurally different
members: three invisible spaces, three control-ish whitespace characters and
two punctuation marks.

GREEN, after the fix (the separator predicate now asks
`isAccountNumberWhitespace` from `src/platform/account-number.ts`, so the tree
holds ONE answer, plus the two punctuation separators the card mask already
tolerates):

    $ npx vitest run test/domain/identity-on-review.test.ts
      Tests  26 passed (26)                 EXIT 0

The agreement is DERIVED rather than asserted from memory: a test iterates the
whitespace characters, asserts `canonicalAccountNumber` removes each one, and
asserts the mask tolerates each one. A future divergence between the two
answers is red.

## Per-finding disposition

| Finding | Severity | Disposition |
|---|---|---|
| HZ-M3P13-01 | high | FIXED. Separator set is now the shared platform predicate plus `.` and `-`. Red-then-green above. Slow-gate sweep strengthened: it now compares five renderings (compact, ASCII spaced, no-break spaced, narrow-no-break spaced, hyphenated) instead of two. |
| HZ-M3P13-02, CR-M3P13-03 | high | FIXED at every surface, not only the named ones. Six render sites now mask: the import preview's counterparty and descriptor cells, the month view's group label, reserves label, held rows and gap rows. The reserves label was NOT in either verdict; it was found by reading the exclusion table of the derivation test, which excused it as "the household's own declared account label or a counterparty IBAN". The residue note is replaced: the enumeration is now DERIVED by a test ("every surface that masks a descriptor masks it against the ACCOUNT as well as the card") rather than written in a comment, and the old false paragraph is quoted where it stood. |
| HZ-M3P13-03 | high | FIXED by rewording, with evidence. See the decision below. Pinned by a two-statement, two-month slow-gate case and by a fast-gate assertion that no period word can return to the string in any of the three languages. |
| CR-M3P13-01, HZ-M3P13-05 | medium | FIXED, and by the stronger of the two proposed remedies. `data-group-key` is an opaque SHA-256 prefix of the key. The excluded set for criterion 13.2 is now TWO channels. Both lanes independently confirmed the hidden field and the serialised payload are necessary; the work history keeps saying so. |
| CR-M3P13-02 | medium | FIXED. Row 20's second token is added to the e2e facts module (the derived agreement test picked it up with no edit, as the lane predicted) and the criterion's literal page-source clause is asserted for it over `page.content()` with NOTHING excluded, plus a non-vacuity assertion that its masked form IS present. |
| HZ-M3P13-04, CR-M3P13-04 | low | FIXED. An unregistered country now fails closed: the scan tries candidate lengths from the registry's longest to its shortest and redacts a run that satisfies ISO 7064. A checksum is a grammar test, not a shape test, so it cannot fire on a mandate reference, a card number or a phone number, and both directions are pinned. The false "Exactly ONE space" comment is corrected in place with the superseded text quoted. |
| CR-M3P13-05 | low | FIXED. Three comment claims corrected in place with the superseded text quoted: the non-existent `detail.aboveForm` slot, the duplicated clause, and the label-masking sentence that became half true. |
| CR-M3P13-06 | low | NOT ACTED ON, by instruction. The intermittent is in `test/e2e/setup-accounts.ts:58`, which this round was told not to touch. Recorded here so it is not lost. |

## HZ-M3P13-03: why the copy changed and not the read

Verified in this worktree before deciding:

    $ src/modules/merchants/adapters/merchant-repository.ts  listCountedTransactions
      where: { householdId, flow: { in: ["INCOME", "SPEND"] } }   no date bound
    $ src/modules/merchants/application/merchant-review.ts     takes a HouseholdContext only
    $ src/app/(app)/merchants/page.tsx                         reads only searchParams.status
    $ src/modules/merchants/application/assign-merchant.ts:172 "recompute is what carries it
                                                                to every past matching transaction"

Two reasons the read was not scoped instead.

1. IT WOULD HAVE FIXED THE SENTENCE AND LEFT THE LIE. A naming does not apply
   to one month: it writes a rule and recompute carries it to every matching
   transaction the household has, and `merchantsFoot` already tells the reader
   that names apply to past and future imports. Scoping the read would make
   "of this month" true of the NUMBER while it stayed false of the NAMING, and
   it would go on understating what the reader is about to do, which the
   hazard lane names as the dangerous direction.
2. IT IS A PROJECTION CHANGE THIS PHASE DOES NOT CARRY. The same read produces
   the two direction totals that criterion 13.5 asserts a naming cannot move.
   Bounding it by month changes those totals and their meaning, which is not a
   copy fix.

English written first: "Naming this applies to N transactions already
imported."

## Three things the fix round found that neither lane named

1. **This phase was serialising every raw transaction description into the
   page.** The transaction lines were handed to the client leaf as the element
   `<GroupRows rows={group.rows} />` inside the `detail` prop. A React element
   in a client component's props is serialised together with ITS OWN props, so
   the raw rows array crossed the boundary. Traced directly:

       SECOND-TOKEN-CONTEXT: "...\"rows\":[{\"id\":\"...\",\"bookingDate\":\"2026-03-19\",
       \"amountCents\":-8600,\"description\":\"OVERSCHRIJVING NAAR BE25 ... VIA BE72 ...\"}"

   Fixed by handing the leaf the RENDERED markup instead of an element that
   carries data. The mechanism and its sibling sites are recorded at the
   definition in `merchant-review.tsx`: pass the RESULT, never an element
   whose props hold data the screen does not render, because serialisation
   follows the element and not the pixels.

2. **`next dev` serialises every server component's props into the page.**
   After fix 1 the account was still in the dev source, inside a chunk of the
   shape `{"name":"GroupRow","env":"Server","stack":[...],"props":{"group":
   {...}}}`. That is the development server's own debug payload. Verified to
   be development-only rather than assumed: the same assertions against the
   production server this config already builds and starts find none of the
   three shapes and no debug chunk. Criterion 13.2's literal page-source
   clause for row 20's second token is therefore asserted against the
   PRODUCTION build, with nothing excluded, which is stronger evidence than
   the dev-server form the finding asked for.

   CARRY THIS: a page-source absence assertion run against `next dev` proves
   nothing.

3. **Answering the import format question twice with one name crashes the
   server.** Met while building the two-statement case:

       ⨯ Error [PrismaClientKnownRequestError]: Invalid `prisma.sourceProfile.create()`
         Unique constraint failed on the fields: (`householdId`,`name`)
           at async Object.createProfile (src/modules/import/adapters/import-repository.ts:147:15)
           at async confirmImport (src/modules/import/application/confirm-import.ts:146:6)
           at async confirmImportAction (src/modules/import/ui/actions.ts:88:19)

   The reader sees "Application error: a server-side exception has occurred"
   instead of a sentence saying the name is taken. Pre-existing, outside this
   phase's files, handed on as an open question with the stack.

## The accounts-setup intermittent, met a second time and classified the same way

The first full fix-round suite ended 121 passed, 1 failed, and the one failure
was `test/e2e/accounts.spec.ts:350`, "a mistyped account number is refused by
name and the other rows survive", timing out on the FINAL step: after
correcting the bad row and submitting again, `registered-account` did not
appear within the five-second default.

Classified INTERMITTENT rather than a regression of this phase, on evidence:

- The test passes in isolation at this head:

      $ npx playwright test test/e2e/accounts.spec.ts --project=chromium \
          -g "a mistyped account number is refused by name"
      1 passed (44.3s)   EXIT 0

- This branch changes nothing in the registration path. The fix round added
  three EXPORTS to `src/platform/account-number.ts`
  (`isAccountNumberWhitespace`, `ACCOUNT_NUMBER_LENGTH_BOUNDS`,
  `accountNumberChecksumHolds`) and changed neither `accountNumberProblem`
  nor `isValidAccountNumber` nor `canonicalAccountNumber`, which are the
  three the setup screen consults.
- It is the same SHAPE the criteria lane recorded as CR-M3P13-06: a
  five-second default wait on the accounts setup submit, on a loaded
  container, in a suite where every other journey drove the same action
  successfully. That lane met it at `setup-accounts.ts:58`; this round met it
  one screen later in the same flow.
- The lane's own remedy (an explicit timeout matched to the action's budget)
  was NOT applied here, by instruction: this round was told not to touch that
  helper and to re-run rather than chase it.

TWO INDEPENDENT SIGHTINGS NOW. It is worth a phase of its own: two lanes and
one implementer have each lost a run to it, and the next one will too.

---

# SETTLE ROUND (2026-08-28)

Both lanes closed APPROVE (criteria ce76ec3, hazard 392cefc). Seven findings
directed settled before merge. Both round-two documents read in full and every
claim verified in this worktree before any change.

## RED-THEN-GREEN, item 1: the separator rule closes rather than lists

Verified first with a direct probe against the committed mask:

    zero-width space U+200B    masked=false
    word joiner U+2060         masked=false
    soft hyphen U+00AD         masked=false
    en dash U+2013             masked=false
    underscore                 masked=false
    solidus                    masked=false
    country-space-check        masked=false
    glued prefix               masked=false

RED, witness committed before the fix:

    $ npx vitest run test/domain/identity-on-review.test.ts
    × an account grouped with zero-width space U+200B is redacted, not printed
    × an account grouped with word joiner U+2060 is redacted, not printed
    × an account grouped with soft hyphen U+00AD is redacted, not printed
    × an account grouped with en dash U+2013 is redacted, not printed
    × an account grouped with underscore is redacted, not printed
    × an account grouped with solidus is redacted, not printed
    × an account grouped with comma is redacted, not printed
    × an account grouped with middle dot U+00B7 is redacted, not printed
    × a separator between the country code and the check digits does not defeat the mask
    × two non-whitespace separators in one gap are NOT crossed
    ✓ a doubled WHITESPACE separator still masks
      Tests  12 failed | 33 passed (45)      EXIT 1

The doubled-whitespace row passing is load-bearing: it is the property the
directed fix would have broken (see the deviation below).

GREEN after stating the rule as a closure:

    $ npx vitest run test/domain/identity-on-review.test.ts
      Tests  47 passed (47)                  EXIT 0
    $ npx tsx <the same probe>
      all six separators and the country-space-check: masked=true

DEVIATION FROM THE DIRECTED FIX, recorded because the deviation is the
interesting part. The finding asked for "any single non-alphanumeric character
between run characters, bounded to ONE consecutive separator". The CLOSURE half
is taken as written. The BOUND is not: a flat bound of one would stop masking an
account written with a DOUBLED SPACE, which round one's own probe recorded as
masked at that head, so obeying it literally would have traded one fail-open for
another. Implemented instead: whitespace unbounded, at most ONE non-whitespace
separator per gap. That keeps the doubled space masked and still stops the scan
walking across arbitrary punctuation, which is the reason the bound was asked
for. Both directions are pinned.

## RED-THEN-GREEN, item 2: the fallback has exactly one candidate

Verified first:

    trials=40000 masked=2035 swallowed-a-word=428
    sample: MANDAAT ZZ89 **** OORD

RED: `the unregistered-country fallback never eats a following word` and
`the swallow rule holds on the UNREGISTERED path too` both failed.

GREEN: `trials=40000 masked=0 swallowed-a-word=0`, and the two tests pass.

DEVIATION, and this one is a correction of the proposed remedy rather than a
preference. The finding proposed walking to the end of the maximal run and
asking for that length once, claiming this makes word-swallowing impossible.
The single-candidate half is right and is taken. The impossibility does NOT
follow: a space separates the groups of one account AND separates two words, so
a maximal run that crosses spaces reaches the end of the sentence, and the one
remaining candidate then still swallows every following word on its
one-in-ninety-seven draw. Measured before choosing. So the fallback DOES NOT
CROSS WHITESPACE AT ALL: its run ends at the first space, which makes swallowing
impossible by construction rather than rare. The cost, pinned by a test: an
account of a country the registry does not carry, written in space-separated
groups, is not redacted. The registry is complete against ISO 13616 as
published, so that branch has no known member today, and the alternative cost
was measured text loss on three shipped screens.

## Per-item disposition

| Item | Finding | Disposition |
|---|---|---|
| 1 | HZ2-M3P13-01 | FIXED as a closure, witness above. Country-space-check also fixed by widening the candidate anchor. Glued prefix recorded at the definition as a known limit AND pinned by a test. |
| 2 | HZ2-M3P13-02 | FIXED, witness above. The swallow test now exercises the unregistered path, so its name is true of both branches. |
| 3 | HZ2-M3P13-03 | DONE. Two paragraphs at `groupDomId`: it is a stable opaque row identity and NOT a redaction, with the ~1.03e6-candidate figure and why it costs nothing today; and the per-household salt required in the same commit as any change that opaques the hidden field. |
| 4 | CR2-M3P13-01 | FIXED. `DESCRIPTOR_FIELDS` renamed `SENSITIVE_FIELDS` and given iban, counterpartyIban, counterpartyAccount, accountAlias, accountNumber. The walk went from 16 sites to 19; all three new ones disposed of explicitly. The accounts list's own number is NOT masked and is now an exclusion with its reason. The masker's authority claim is corrected to say the vocabulary is the walk's reach. |
| 5 | CR2-M3P13-02 | DONE. C13-4 and C13-5 rewritten as closed remedies, each quoting what it used to say, naming the change that closed it. C13-5 states the one genuine residual so the record does not overclaim in the other direction. |
| 6 | CR2-M3P13-03 | FIXED. The RF family is refused BY NAME in the fallback, and the false claim is corrected in both places with the superseded sentence quoted. Pinned at lengths 16, 20 and 24. |
| 7 | CR2-M3P13-04 | FIXED. One `renderingsOf` helper feeds the primary sweep, the dev assertion and the production page-source assertion, so all three test five shapes. |
| n/a | CR2-M3P13-05 | NOT TOUCHED, by instruction. It has its own phase. |

## A third surface the widened vocabulary found

Beyond the accounts list the finding named, the walk newly collected the
reserves list's `key={group.counterpartyIban}`. It is a React key, which React
does not emit into the DOM, so it reaches no markup, attribute or screenshot.
Declared with that reason rather than masked. It is the clearest evidence the
widening was worth doing: before it, nobody could have said whether that
surface existed.
