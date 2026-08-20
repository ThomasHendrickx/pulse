# M1-P5 work-history notes (two-sided month view)

Running log, appended as the work happens (incremental-output clause). The
schema-valid work history is m1-p5.yaml beside this file; these notes carry the
narrative and captured output the yaml summarises.

## Mandated reading record

Read, in order: implementer-brief-m1-p5.md in full (the shared dispatch
contract is embedded in it), schemas/work-history.schema.json (fleet root),
gate-registry.yaml (fleet root). Mechanism lookup (mechanism-lookup clause):
no tuition/mechanism-index.yaml exists in the fleet root and the project's
delivery/tuition/ is empty; the kernel's copy at
/home/user/pulse-fleet/node_modules/@tiphys/kernel/tuition/mechanism-index.yaml
is the one M1-P4 read (kernel-process mechanisms only). I will read it before
writing code and record what it holds for this phase. gates.manifest.json
exists only inside the kernel package; this phase adds no destructive command.

Project reading: plan section M1-P5 in delivery/plan/pulse-v1.yaml (phase
declaration, acceptance 4.1-4.6, hazards H4.1-H4.4), CLAUDE.md, all three
skills (pulse-frontend, pulse-domain, pulse-typescript, in full),
pulse-v1-plan.md slice table and partial-month rule (lines 140-215),
pulse-v1-architecture.md sections 3, 8, 9, 10 (read model: four queries plus
four for the previous month, computed on read, raw SQL where Prisma is weak;
golden journey written first), acceptance-criteria.md slice 4, charter
escalation contract and DR-0001 (binding release verification: golden journey
plus fast gate, green on the release commit), M1-P4 work history in full
(open questions M1P4-C7 cash-marker precedence and M1P4-C10 hand to THIS
phase; environment warnings about auth-user accumulation, consent guard,
dockerd).

## Scope

Declared files-to-touch: src/modules/overview/, src/app/,
test/e2e/golden-journey.spec.ts, test/e2e/month-view.spec.ts, test/fixtures/,
messages/{en,nl,fr}.json. Extras: test/application/resolve-merchants.test.ts
(CR-404 index-name pin). Standing extras: delivery/work-history/*.
Backlog carry-ins declared in scope: CR-404 and the messages em dash
(merchantsBody, all three locales; CLAUDE.md rule 7).

## Plan of work (order per the phase spec)

1. Read existing modules (ledger, merchants, import UI), prototype, tokens,
   catalogs, fixtures; derive fixture-based expected totals BY HAND into the
   spec header.
2. Golden journey spec written FIRST (red witness for the whole view), plus
   new card/pot fixtures as needed.
3. Overview module: repository (raw SQL grouped queries), application use
   case (month projection, previous closed month comparison, partial-month
   flag from the Clock port), domain types.
4. View: MonthView server components against the prototype, tokens only,
   next-intl, reconciliation panel always shipping.
5. month-view.spec.ts: fixed clock mid-month (partial, no comparison),
   gapped fixture alarm, unresolvable transaction UNRESOLVED gap, three
   locales no truncation/overflow.
6. Lint rule for src/modules/**/ui literals; token grep gate npm script.
7. Gates: typecheck, lint, npm test, test:e2e on one commit; DR-0001
   evidence.

## Log

- [t0] Worktree verified clean at b54783b on claude/m1-p5-month-view.
  Mandated reading done as recorded above. Next: kernel mechanism index,
  then codebase survey (ledger domain and repository, merchants UI as the
  module-screen precedent, prototype HTML, tokens, catalogs, eslint and
  playwright configs, fixtures with their derived totals).
