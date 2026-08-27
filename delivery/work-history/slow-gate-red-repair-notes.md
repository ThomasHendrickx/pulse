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
