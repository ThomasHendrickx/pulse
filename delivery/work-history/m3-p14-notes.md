# M3-P14 implementer notes (running log)

Started. Read brief, plan phase M3-P14, CLAUDE.md, pulse-domain, pulse-frontend,
pulse-typescript. Next: verification-first step, capturing the claims the plan
makes about declareAccount's single caller, the absence of an accounts route,
the classification order, merchant resolution scope, and the mod-97 pass rate
over committed fixture account numbers.

## Verification-first, captured

Single caller of declareAccount in src (grep -rn 'declareAccount' src/):
  src/modules/import/application/confirm-import.ts:96  <- the only call
  src/modules/import/application/index.ts:8,59         <- the binding
  src/modules/accounts/application/index.ts:27         <- the definition
  src/modules/import/application/ports.ts:247          <- the port
No accounts route: `find src/app -ipath '*account*'` printed nothing.
Merchant resolution runs over INCOME and SPEND only: interpret-window.ts:100
isCounted, used at :126 (countedKeys) and :136 (merchants).

mod-97 measurement over the privacy gate's own scan scope, alternation and
normalisation (script kept in scratchpad):
  TOTAL distinct account-shaped values: 24; pass validity test: 13; fail: 11
The plan's figure was 17 / 7 / 10; this phase reads its own run. Consequence:
the fixture accounts this phase REGISTERS must be newly generated with
computed check digits, and added to test/fixtures/allowed-identifiers.txt.

## Coordinator corrections received mid-build (PR7-001..004)

PR7-001 (move, do not copy): already done before the message landed. The three
definitions were MOVED out of src/modules/merchants/domain/counterparty-identity.ts
into src/platform/account-number.ts; that file now imports them and keeps
IBAN_LENGTH_BY_COUNTRY and compactAccount as aliases, and
isTrustedCounterpartyAccount delegates to isValidAccountNumber. The merchants
files and their tests are outside the plan's files-to-touch list; treated as a
plan omission, touched, recorded here.
PR7-002 (two reasons): already done. "account-not-registered" and
"account-in-savings-ring", both on the ConfirmOutcome rejected union, both
whitelisted in status-keys.ts, both to be translated in en/nl/fr.
  NOTE ON THE PLAN'S POINTER: step 5 names ports.ts:72-81 (ImportFailureReason),
  but actions.ts:93-102 and status-keys.ts route the CONFIRM REJECTION union,
  not ImportFailureReason. The two reasons went on the rejected union, which is
  what reaches status-keys. Recorded as a disagreement with the plan's pointer.
PR7-003 (explainer must be VISIBLE at 390, no interaction): the explainer is a
plain paragraph in the server component, above the client form island, never a
details/summary or visually-hidden text. Playwright asserts toBeVisible() at 390.
PR7-004 (the reachable trap): a savings account marked POT at setup IS importable,
gains rows, and D-51 then refuses the ring change permanently. No new machinery;
the accountsRingHasRows copy says plainly what happened and that the ring can no
longer be changed, and a test covers that copy.
Also flagged: test/e2e/month-view.spec.ts:1377 declares a reserve account through
the import path this phase removes; rewritten to register instead.

## Red witness for criterion 14.1's registered arm, captured

WITNESS 1, the registration itself. The registered arm run against a household
that registered ONLY the current account (one line changed in the spec, then
reverted), which is the dangerous state the owner is in today:

  Running 1 test using 1 worker
    x  1 [chromium] > test/e2e/accounts.spec.ts:126:5 > REGISTERED ARM: ... (14.7s)
    Error: expect(locator).toHaveCount(expected) failed
    Locator:  getByTestId('unresolved-group')
    Expected: 3
    Received: 10
  1 failed

WITNESS 2, structurally different member of the same class: the accounts ARE
registered and the comparison is what fails. The reserves join reverted to the
raw-string form it had on main:

  Error: expect(received).toEqual(expected) // deep equality
    - "Car savings" / "Holiday savings" / "Pension savings" / "Savings"
    + "BE08900000000007" / "BE35900000000006" / "BE62900000000005" / "BE78900000000008"
  1 failed

GREEN after both were restored: 13 passed (1.8m), the whole accounts spec.

## A defect this phase shipped and its own journey spec caught

The reserves join was first written with '\s' inside a Prisma tagged TEMPLATE
LITERAL. JavaScript eats the backslash, so the SQL that reached Postgres was
regexp_replace(col, 's', '', 'g'): it stripped the letter s from both sides
instead of stripping whitespace, and joined nothing. Corrected to the POSIX
class [[:space:]], which carries no backslash, with the reason recorded at the
query.

## Gate runs at the committed head

npm run typecheck   exit 0   (tsc --noEmit, no output)
npm run lint        exit 0   (eslint ., no output)
npm test            exit 0   Test Files 40 passed (40) / Tests 540 passed (540), 0 skipped
npm run gate:tokens exit 0
npm run gate:privacy exit 1 FIRST, then 0. The gate caught the deliberately
  INVALID probe values criterion 14.3 asserts the four refusals over: they are
  account-shaped and were not on the allow list. Five values added with how
  each was derived and which of the four tests it breaks. Re-run: clean.

Criterion 14.9's own grep, over the 940 lines this branch adds or changes under
src/app and src/modules/*/ui, comment lines dropped, searching for oklch(,
rgb(, rgba(, hsl(, hsla(, a hex colour, any number followed by px/rem/em, and
eleven colour keywords after a colon: grep exited 1, no hits. styles/tokens.css
appears in no diff on this branch, so no token was missing.

## The mandated claim grep, and how each hit is settled

  grep -nEi 'cannot be|impossible|needs a|is covered|catches|would catch|recovers|anyway|always|never|no way to' delivery/work-history/m3-p14.yaml

Ten hits, run line-based and again over the whitespace-flattened text.

  Lines 4 through 62 are inside the VERBATIM prompt block. They are the
  dispatcher's words and the coordinator's, recorded as R-052a requires; they
  are not claims this phase makes.
  Line 180 is "the stored counterparty column is a FACT and is never rewritten
  to fix an interpretation", which quotes pulse-domain section 2 rule 1 and now
  names claim C-14.8-no-fact-writes beside it, whose executed construction is
  the application test asserting the accounts repository names exactly one
  Prisma model.
  Line 413 is inside CAPTURED test output: it is the name of the test in the
  red witness, adjacent to the command that produced it and its exit code.

No hit is an unsettled assertion.

## Other catalogue and style checks

Catalogue parity across en, nl and fr is mechanically enforced by
test/app/catalog-parity.test.ts over deep leaf paths, and it passes with the 40
keys this phase adds, so "present in all three catalogues" is checked rather
than asserted.

Em dashes: `git diff af3b5cb..HEAD | grep '^+' | grep -c '—'` returns 0, and
so do the same counts over the commit messages on this branch and over both
work-history files.

## The nine criteria, walked

14.1 THE OWNER'S SCENARIO, END TO END, AND THE FIXTURE PROVED CAPABLE OF
     FAILING. MET. test/e2e/accounts.spec.ts carries both arms over
     test/fixtures/setup-current.csv, a new invented current-account export
     whose rows carry transfers to seven further accounts of the same
     household, three spending and four savings, plus three ordinary outside
     merchants. Registered arm: 3 unresolved groups, no registered label or
     account number among the group labels in either the compact or the
     spaced rendering, none of the seven own amounts a group total, exactly
     four reserve groups whose labels are the four the household typed,
     spend-total "98,97", and the reconciliation panel naming three unmatched
     internal legs with copy that names importing the other account's export.
     Control arm: 10 unresolved groups, each of the seven own amounts its own
     group total, and spend-total "1.473,97". Every account number the fixture
     introduces passes the validity test, asserted by a fast-gate test that
     reads them out of the fixture rather than retyping them, and all are
     listed in test/fixtures/allowed-identifiers.txt with their provenance.

14.2 SETUP ASKS ONCE, EXPLAINS THE RINGS BEFORE THE ANSWER, AND SAYS CARDS
     ARE NOT WANTED. MET. Playwright: eight accounts in one submission with
     rows addable and removable and one submit; the explainer asserted
     VISIBLE with no interaction, before the ring control in document order
     and above it on screen, in the criterion's own terms; the cards line
     asserted visible. All three catalogues carry every key, enforced by
     test/app/catalog-parity.test.ts. Application test: a submission with the
     ring unanswered is refused with the named error ring-missing against its
     own row, and nothing is written.

14.3 A TYPED ACCOUNT NUMBER IS VALIDATED. MET. Application tests cover the
     four refusals over wholly invented inputs and assert no account row is
     created for any of them; a Playwright test types three rows, has one
     refused by name, finds the other two still carrying what was typed
     including their rings, corrects the one and registers all three.

14.4 ONE CANONICAL FORM AND ONE VALIDITY TEST, WITNESSED WHERE THEY MATTER.
     MET. test/domain/account-number.test.ts enumerates the call sites and
     asserts exactly one definition under src/ of the canonical form, of the
     country-length table and of the mod-97 arithmetic, all three in
     src/platform. The whitespace-removal helper the criterion names in
     belfius-current-account-template.ts is REPLACED by the platform form and
     the test asserts the replacement; the one permitted exception is the
     ledger's refund key, pinned with its reason. Idempotence and the
     spaced/compact/mixed-case identity are asserted, and a ledger domain
     test classifies a SPACED stored counterparty as RESERVE against a
     savings account registered compact and INTERNAL against a spending one,
     with a control showing an unregistered spaced counterparty still falls
     to SPEND.

14.5 THE IMPORT'S OWN ACCOUNT IS A REGISTERED ACCOUNT OR A CARD. MET. Three
     Playwright cases: an unregistered own account refused with a message
     naming and linking to the accounts screen, nothing ingested and no
     account created; an own account registered in the savings ring refused
     with a message naming the ring correction AND what it costs, in the
     criterion's own terms; a card statement accepted and declared at first
     sight. A grep asserts the ring control is gone from
     profile-confirmation.tsx.

14.6 THE CARD CASE IS STATED AND ITS CONSEQUENCE IS MEASURED. MET. The setup
     screen says cards are not entered here, in all three catalogues, and the
     accounts list shows a card with its ring and says it carries no account
     number. The consequence is witnessed over the committed golden-journey
     fixtures: before the card statement is imported the settlement debit is
     one aggregate spend row against the issuer carrying 850,00 and not one
     card line item renders; after it, that row is gone, the amount appears
     nowhere in main, and the three card line items are the counted spend.

14.7 THE SCREEN SURVIVES THE PHONE, INCLUDING EIGHT ROWS OF IT. MET. At 390
     and 360, at 100, 150 and 200 percent text scale, with eight rows
     entered: reachable from the shell nav and from the month view's empty
     state, tap targets measured in BOTH dimensions, no clipping on either
     axis inside main, and no document-level horizontal scroll. The nav
     line-count comparison is measured off the row with a Range over each
     label's text, which is a correction: the first version divided the
     link's box height by its line height, and flex stretches every link to
     the tallest, so it could not have failed.

14.8 NO FACT IS REWRITTEN AND NO DECLARATION IS WRITTEN BY AN ENGINE. MET.
     The accounts repository names exactly one Prisma model, asserted from
     its source; setup writes declaration rows and calls the published
     recompute exactly once, asserted by a counter; running recompute twice
     afterwards leaves every flow and merchant assignment identical; a ring
     change is refused at the application level for an account carrying its
     own imported rows, and allowed for one that does not.

14.9 THE GATES. MET, with the numbers in the gate evidence and the phase's
     own literal grep recorded above.

## What this phase did NOT cover

The accounts screen's controls are not in the pressed-feedback control set
that test/e2e/pressed-and-disabled.spec.ts sweeps. That spec's journey now
walks the screen to register an account but takes no measurement there, so the
new screen contributes nothing to M3-P9's set. The gap is recorded at that
spec's enumeration so the next phase to own the file meets the fact rather
than the old count.

The fold margin at 390 under a 200 percent text scale is 12px (688 against a
bound of 700), where three navigation links left 21px. It was bought back from
the nav's type size and padding and from the main region's top gap.

## A note on the two e2e runs that were discarded, and why

The first full run was made without pinning the five local-stack values over
the container's ambient foreign ones. It reported two failures and neither was
about this branch: test/e2e/auth.spec.ts constructs an orphan auth user through
the admin API using process.env.NEXT_PUBLIC_SUPABASE_URL and
SUPABASE_SERVICE_ROLE_KEY read in the TEST process, and
test/e2e/merchant-rule-write.spec.ts constructs a PrismaClient the same way, so
both talked to another project while the app talked to the local stack. Both
pass under the pinned run. Fleet warning 6 says to pin all five for the
webServer; the missing half is that the TEST process reads them too.

The second run was discarded because it built the production bundle before the
formatting fix landed, so its prod-mode smoke would have exercised a bundle the
branch no longer has. The recorded run is the third: pinned, at the code head,
with both ports free and .next-prod removed first.

## The recorded e2e run

  npm run test:e2e  (five local-stack values pinned, both ports free,
                     .next-prod removed first, at code head 351155a)
  Running 81 tests using 1 worker
  1 skipped
  80 passed (17.0m)
  E2E_EXIT=0

THE ONE SKIP, named rather than left as a number: test 51, "three touch paths
deliver input and none of them reaches :active", under the DESKTOP chromium
project. That test skips itself where the context declares no touch, and it
RUNS and passes under chromium-phone as test 79. The skip predates this phase.

The swept pressed-feedback control set printed 21, which is the enumeration
this phase amended from 19 by the two navigation and empty-state links it adds.
