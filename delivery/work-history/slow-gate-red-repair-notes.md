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
