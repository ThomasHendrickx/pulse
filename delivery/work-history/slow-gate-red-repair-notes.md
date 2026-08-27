# Slow gate red repair, running record

Branch `claude/slow-gate-red-repair`, cut from origin/main a56cc5b.

This file is written as the work happens, not after it, because the
container it runs in restarts on its own schedule and analysis held only in
memory is analysis lost.

## The correction this lane starts from

Four phases in a row recorded `npm run test:e2e` as environment-limited.
That diagnosis was wrong. The slow gate IS runnable here: the docker daemon
starts, the repository ships its own Supabase CLI, and the local stack
serves the gate. The gate was therefore never green or red on evidence; it
was simply never run.

## How the gate was brought up

- Local Supabase stack, project `m1-p1-skeleton`, database on 127.0.0.1.
- Schema applied with `prisma migrate deploy` against the local database.
  Never `prisma migrate reset`, and no owner-consent variable was set.
- Every command pins DATABASE_URL, DIRECT_URL and the Supabase API URL to
  the loopback host and asserts the parsed hostname is 127.0.0.1 before it
  runs. The ambient environment names a deployed project of the owner's and
  nothing in this lane may reach it.
- Disk is the first diagnostic for a renderer crash, as playwright.config.ts
  already records. Free space was checked before the run.

## Baseline at origin/main

Run in progress; results appended below as they land.

## First baseline attempt, abandoned at test 46 of 116

Base a56cc5b. Tests 1 to 45 are real readings; from test 46 onward the
readings are worthless and the reason is recorded here so nobody diagnoses
them as product faults.

The local docker daemon DIED mid-run, at about 21:32 UTC. The database
container went with it, so every test from 46 onward failed at its sign-up
step with the app's own "Sign-up did not complete. Try again." and the
Postgres log shows "database system was not properly shut down" at the
restart. It is not the Supabase sign-in rate limit (no rate-limit refusal
appears in the auth log) and it is not memory (13 GB free, no OOM). The
daemon simply stopped. A watchdog now restarts it and the stack behind it.

What the valid part of that run establishes, at a56cc5b:

- FAIL accounts.spec.ts:697 the accounts screen at 360
- FAIL busy-state.spec.ts:537 every submit control acknowledges the press
- FAIL busy-state.spec.ts:652 the merchant naming submit, five rows
- FAIL canonical-backfill.spec.ts:112 the backfill canonicalises
- PASS busy-state.spec.ts:716 every navigating control
- PASS all fourteen month-view tests up to 1328, including the phone ones
  under the desktop project

## Second baseline, at merged main

main moved to 4f38dbb while this ran (the M3-P10 second fix round and its
criteria verdict), and that merge changes the discovered test set: the
chromium-phone project now matches merchants.spec.ts too. A before list and
an after list have to be taken on the same base, so the baseline is being
retaken on the merge and the run above is kept only for the daemon finding.

## Baseline at merged main 4f38dbb: 119 tests discovered

Four failures reproduce in the first 44 tests, each with its own error text
captured from the run's retained context rather than inferred.

### 1. accounts.spec.ts:697, the accounts screen at 360

    the added nav link wraps further than every existing one at 360
    and 200 percent
    Expected: <= 3   Received: 4

The measurement is of the product, at the narrow phone width and double
text size. Not yet classified; the line counts have to be read off the
running screen before anything is said about which link wraps and why.

### 2. busy-state.spec.ts:537, every submit control acknowledges the press

    merchant naming submit: aria-busy at 1000ms
    Expected: true   Received: false

INSTRUMENT. The spec holds the naming control as a lazy locator rooted at
getByTestId("unresolved-group").first(). M3-P11 predicts the typed name
inside the form action, before the await, and a predicted row stops being
unresolved at that moment (merchant-row.tsx sets the row's testid from
unresolved && !predicted). So the press takes the pressed row out of the
set the locator selects from, .first() re-resolves to a row nobody pressed,
and every reading after the press describes the wrong control. The product
behaviour is the one DR-0025 and DR-0026 asked for.

Worth stating because it corrects an earlier report: the sign-up control
does NOT fail here. The journey's only failing control is the naming one.

### 3. busy-state.spec.ts:652, the naming submit over five rows

    naming row 0: aria-busy at 1000ms
    Expected: true   Received: false

INSTRUMENT, the same defect in the loop's own .first().

### 4. canonical-backfill.spec.ts:112, the backfill opens the door

    getByTestId('recon-spend') expected "86,47", received "96,47"

INSTRUMENT, and the evidence is in the database rather than in the DOM.
The seed harness writes a pre-phase row with NO flow at all on a pot-ring
account, booked 2026-08-08, and the spec asserts that August's figures are
byte identical after the import "because the fixture books in July". The
product's interpretation window is padded by 49 days on each side
(SETTLEMENT_DATE_WINDOW_DAYS 45 plus TRANSFER_DATE_TOLERANCE_DAYS 4), so an
import booking 3 to 6 July interprets everything from mid-May to 24 August.
The seeded row is inside it. Read back from the local database after the
failure, that row now carries SPEND, which is exactly what the classifier
returns for it: classifyFlow never returns null, so a null flow means "not
interpreted yet", never "a gap the reader must close". The padding exists
so a transfer leg imported later can pair with one imported earlier, which
is the same mechanism. The spec asserted an identity the window forbids.

## THE COMPLETE BEFORE LIST, merged main 4f38dbb

`npm run test:e2e` exit 1. 16 failed, 102 passed, 30.6 minutes, 119
discovered. The sixteen are eight distinct defects, each red in every
project that runs it.

    1  chromium            accounts.spec.ts:697        the accounts screen at 360
    2  chromium            busy-state.spec.ts:537      every submit control acknowledges the press
    3  chromium            busy-state.spec.ts:652      the naming submit, five rows
    4  chromium            canonical-backfill.spec.ts:112 the backfill opens the door
    5  chromium            month-view.spec.ts:1390     held rows are shown
    6  chromium-prod       optimistic-naming.spec.ts:567 a second notice waits
    7  chromium-prod       optimistic-naming.spec.ts:668 the notice is the last action's
    8  chromium-prod       optimistic-naming.spec.ts:771 naming into an existing merchant
    9  chromium-phone      busy-state.spec.ts:537      (same as 2)
    10 chromium-phone      busy-state.spec.ts:652      (same as 3)
    11 chromium-phone      month-view.spec.ts:1390     (same as 5)
    12 chromium-phone-prod busy-state.spec.ts:537      (same as 2)
    13 chromium-phone-prod busy-state.spec.ts:652      (same as 3)
    14 chromium-phone-prod optimistic-naming.spec.ts:567 (same as 6)
    15 chromium-phone-prod optimistic-naming.spec.ts:668 (same as 7)
    16 chromium-phone-prod optimistic-naming.spec.ts:771 (same as 8)

Nothing crashed, nothing ran out of disk, and no test was lost to a
renderer trap. The gate ran; it is simply red.

### 5. month-view.spec.ts:1390, held rows

    getByRole('heading', { name: 'Confirm the detected format' })
    expected visible, element(s) not found

INSTRUMENT. The page the spec was looking at reads "Import complete", with
the account "Savings" and the rows already in. The test imports the current
account's statement first and TEACHES the household the format under a
name; the savings statement is the same format, so the second upload is
recognised and needs no confirmation. The spec drives a confirmation step
the product legitimately skips once it has been taught the format.

## Verdicts and repairs

Seven of the eight are INSTRUMENT defects: a spec addressing a control by an
identity the product legitimately changes, driving a step the product
legitimately removed, asserting a state the product's own documented rule
forbids, or reading a state before the action that produces it has
answered. One is a PRODUCT defect.

1. accounts.spec.ts:697, the nav link at 360 and 200 percent. PRODUCT, and
   the fix is in the stylesheet. Measured in chromium at 360 by 844 with
   every font size doubled: each of the four links had 42px of content
   width; Overview, Import and Merchants wrapped onto three lines and
   Accounts onto four. The cause is not the label's length, Merchants is
   longer: overflow-wrap anywhere fills each line greedily and "Acc"
   measured 43.5px against 42px of room, so the fourth link lost a
   character per line and paid a line for it. The horizontal padding on
   .app-nav-link is now --space-1 rather than --space-2, which is 46px of
   content width. Re-measured: Accounts lands on three lines with 2.9px
   spare and Overview has 2.1px, so the added link is neither the outlier
   nor the tightest, and the row is 105px tall there rather than 138px.
   Tokens only, no literal length, and neither the link's width (flex 1 1 0)
   nor its height (--tap-target-min) moves, so no tap target changes.

2 and 3. busy-state.spec.ts:537 and :652. INSTRUMENT, as set out above. The
   naming row is now held by its POSITION among the rows carrying
   data-group-key, which criterion 11.3 fixes across a prediction, rather
   than by .first() of a set the press empties. Nothing was weakened: the
   assertions are the same assertions, now applied to the control that was
   pressed.

4. canonical-backfill.spec.ts:112. INSTRUMENT. See the reasoning above. The
   after-block now states the one August figure that legitimately moves and
   why, with its arithmetic, instead of an identity the 49-day
   interpretation window forbids.

5. month-view.spec.ts:1390. INSTRUMENT. The confirmation step is not driven
   any more, and the spec asserts instead that it did NOT appear, which is
   the ask-once rule stated rather than assumed.

6. optimistic-naming.spec.ts:567. INSTRUMENT. The spec required BOTH rows to
   carry aria-describedby at once. That is unreachable by construction: the
   row points at its notice only while that notice is ON SCREEN, and the
   queue shows one at a time. What is asserted now is stronger, not weaker:
   exactly one row points, it points at the notice that is showing and not
   the other, and after the dismissal the OTHER row is the one pointing at
   a different notice. The old form would have passed with both rows
   pointing at the same notice.

7. optimistic-naming.spec.ts:668. INSTRUMENT, a race in the spec. It waited
   for .pulse-toast to have count 1, which was already true of the FIRST
   row's notice, and then read the second row's aria-describedby while the
   second action was still held by the delay. The wait is now on the
   condition that actually says the notice has changed hands, the row
   pointing at it, so the assertion fails on a product that never gets
   there.

8. optimistic-naming.spec.ts:771. INSTRUMENT. The merge measurement named
   one INCOME group and one SPEND group into a single name, and a merchant
   with groups on both sides renders TWO rows by design (HZ-M3P11-02), so
   the "one row after the merge" assertion was measuring the product being
   right. Both namings now target the spend section, where a merge really
   does produce one row with the summed total.
