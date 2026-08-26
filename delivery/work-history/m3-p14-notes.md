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
