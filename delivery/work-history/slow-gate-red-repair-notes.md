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
