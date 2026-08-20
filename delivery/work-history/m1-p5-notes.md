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
- [t1] Kernel mechanism index read in full (15 entries, all kernel-process
  mechanisms: claim files, leases, logs, worktrees, reporter parsing,
  guards, CI-step assertions). NO entry covers month projections, raw SQL
  aggregation, e2e fixtures, or server-component views: recorded answer,
  not a skipped lookup. Two general rules carried anyway: assert by name
  over append-only registries (CR-404 is exactly this rule, and the fix
  pins the index NAME); a class witness must redden under two structurally
  different members.
- [t2] Codebase survey done: ledger domain (flow, classify-flow,
  corrections incl. the cash marker and M1P4-C7 precedence note,
  interpret, reconciliation), interpret-window (unmatched INTERNAL legs
  are persisted as flow=INTERNAL with NO complete transfer_link row;
  matched pairs and settlements are link rows; UNRESOLVED arises only
  from zero-amount rows today), merchants published interface
  (normaliseCounterparty IS published), prisma schema, prototype month
  screen extracted from the bundled design reference (markup, copy deck,
  layout: spend wide column, income+reserves rail, recon strip, hatch
  badge for partial), tokens.css, import/merchants UI and e2e precedents.
- [t3] SCOPE ESCALATIONS, declared the moment found (auditor reads the
  declaration from the merge base; the amendment must land on the base
  branch, orchestrator please amend). Each is driven by an explicit
  acceptance criterion or an architecture rule, none is discretionary:
  1. eslint.config.mjs: criterion 4.4 REQUIRES react/jsx-no-literals (or
     equivalent) enabled for src/modules/**/ui; the lint config is the
     only place a lint rule can be enabled and is not on the declaration.
  2. package.json: criterion 4.5 REQUIRES an npm script wrapping the
     token-purity grep gate; scripts live only in package.json.
  3. playwright.config.ts: criterion 4.2 REQUIRES a fixed clock mid-month
     for the e2e webServer; the webServer env is set there so the gate is
     deterministic in-repo rather than depending on the invoking shell.
  4. src/platform/config.ts and src/platform/clock.ts: the fixed clock
     must reach the app; pulse-typescript section 6 says env is parsed
     ONLY in the config module, so the override accessor belongs there,
     and the Clock construction beside the existing systemClock.
  5. src/modules/ledger/application/index.ts (one export line): the month
     view must group cash withdrawals under their own destination with
     precedence over merchant assignment (M1-P4 open question M1P4-C7,
     recorded at the marker's definition in corrections.ts). The cash
     patterns are code-owned in ledger/domain/constants.ts; consuming
     them from overview without a published export would either reach
     into module internals (forbidden) or duplicate the pattern list
     (two sources). Exporting the patterns/predicate from the published
     index is the smallest correct surface.
  Standing extras (work history) and declared extras (CR-404 test file)
  are already covered.
- [t4] Design decisions before the first test line (summarised; full
  rationale goes to m1-p5.yaml key-decisions):
  - Fixed clock for e2e: PULSE_FIXED_NOW=2026-09-15T12:00:00Z. September
    2026 is then the partial current month (criterion 4.2), August 2026 a
    closed month compared to July 2026 (comparison assertions), July the
    baseline. Fixture months are absolute, so the suite is deterministic
    forever, per the architecture's fixed-clock rule.
  - Month selection via /?month=YYYY-MM (English URL, validated), default
    = the clock's current month; prev/next links; next capped at the
    current month.
  - Per-month reconciliation identity: difference = sum(INTERNAL in
    month) + sum(UNRESOLVED in month) holds by construction over the
    persisted flows; unmatched legs = INTERNAL rows with no complete
    link row. The panel names causes: unresolved rows and unmatched legs
    with counts and signed amounts.
  - Golden journey totals (fixture-derived, computed by hand in the spec
    header): August income 2.500,00; spend 1.918,97 (A: 12,50 + 86,47 +
    950,00; B: 20,00; card items 450,00 + 250,00 + 150,00 counted once);
    reserves 0,00; pot change 581,03; difference 0. Settlement pair
    (-850,00 on A, +850,00 on the card) excluded from both sides; the
    A->B transfer pair (300,00) excluded from both sides.
- [t5] Next: environment bring-up (npm ci, docker, db reset), then the
  golden journey spec written FIRST and shown red against the still
  view-less month route.
- [t6] Environment up: npm ci clean; sudo dockerd revived the
  m1-p1-skeleton supabase containers (fleet warning: auth container took
  ~30s of restarts before healthy); npx supabase status gave the local
  keys; pin-local-env.sh (scratchpad) pins ALL FIVE values plus seed
  login. Baseline at 047389b's parent: typecheck 0, lint 0, npm test 219
  passed 0 skipped 0 todo (Node v26.7.0, vitest run, no build step).
- [t7] CR-404 executed red-first (R-037a, the lying test repaired before
  anything else): (1) index renamed in the migration SQL by sed, OLD test
  18 passed exit 0 (the lie witnessed: the name slot accepted any name);
  (2) test pinned to merchant_tags_one_primary_per_merchant, rerun
  against the renamed SQL: exit 1, 1 failed 17 passed; (3) SQL restored,
  18 passed exit 0. Committed 047389b together with the em dash removal:
  merchantsBody AND emptySteps[0] carried em dashes in all three locales
  (the brief named only merchantsBody; the grep found the second key);
  replaced with semicolon/comma per locale, meaning unchanged; grep over
  messages/ now finds zero em dashes.
- [t8] db:reset against the local stack: Prisma consent guard fired as
  expected (fleet warning 3), target verified local first (docker ps:
  supabase_db_m1-p1-skeleton on 127.0.0.1:54322), consent env quoting the
  dispatch instruction; all five migrations applied, seed OK.
- [t9] GOLDEN JOURNEY RED WITNESS (the spec-first red for the whole
  view): commit 0ec6235 carries the spec plus the three fixtures
  (gj-current.csv 8 rows Jul+Aug, gj-pot-b.csv 2 rows, gj-card.csv 4
  rows). Run against the view-less app: the three uploads ALL pass
  (rows-added 8, 2, 4: fixtures parse, profiles detect, settlement and
  transfer interpretation ingest cleanly) and the spec fails at its FIRST
  view assertion, getByTestId("month-title") on /?month=2026-08, "1
  failed" (playwright list reporter; captured in scratchpad run log).
  Exactly the red a not-yet-built view should produce, with the whole
  import pipeline green underneath.
- [t10] Building now, in order: fixed-clock plumbing (PULSE_FIXED_NOW
  accessor in platform/config.ts, appClock in platform/clock.ts,
  webServer env in playwright.config.ts; scope escalations 3 and 4
  above), ledger published cash predicate (escalation 5), the overview
  module (domain fold, raw-SQL repository, application, ui), the thin
  page rewire, globals.css month styles, catalog keys in EN/NL/FR.
- [t11] View built (commit 8dbc7ed): overview module with domain
  (month.ts calendar arithmetic with Brussels-day clock reading,
  month-projection.ts fold/deltas/figures), application (four grouped
  queries plus the same four for the previous month ONLY when the viewed
  month is closed; the partial month's comparison is never even read),
  adapters (raw SQL: grouped income, grouped spend with primary tag and
  the cash marker computed in SQL from the ledger's published pattern
  list, reserves by counterparty account, the figures aggregate, the gap
  rows), ui (MonthScreen server components against the prototype), thin
  page.tsx, tokens-only styles, catalog keys 98/98/98 across EN/NL/FR.
  Golden journey GREEN on its first run against the finished view: 1
  passed (33.6s). Full e2e then: 10 passed (1.9m), including the four
  new month-view tests and all six pre-existing specs.
- [t12] Criterion 4.4 lint rule: react/jsx-no-literals (DEFAULT options:
  bare JSX text nodes forbidden; string literals inside expression
  containers and string props remain legal, which is where the view's
  deliberate glyphs live) enabled for src/modules/**/ui/**/*.tsx in
  eslint.config.mjs. Green over the whole tree; witnessed RED exit 1 by
  a hardcoded text node "Hardcoded month" in month-view.tsx, restored.
  Chosen rule name recorded for the work history: react/jsx-no-literals.
- [t13] Criterion 4.5 gate: npm script gate:tokens wraps the exact
  criterion grep negated. Raw grep over src/modules/*/ui exits 1 (no
  literal), script exits 0. Witnessed red under TWO structurally
  different members of the class: a hex colour in a style prop in the
  overview ui (exit 1) and an oklch() literal in a merchants ui comment
  (exit 1), both restored, gate 0 again.
- [t14] Mutation red-witness round for the month-view spec (a class
  witness reddens under structurally different members; each mutation
  applied, one test run, restored):
  M1 (H4.1): partial=false in month-overview.ts, "partial current month"
  test exit 1 (in-progress badge missing).
  M2 (H4.2 member 1): MATCHED_LINK_EXISTS mutated to TRUE in the
  repository, "gapped export" test exit 1 (recon-cause-unmatched never
  renders while the difference is still broken).
  M3 (H4.2 member 2): unresolved cause rendered only when books do not
  close, "unclassifiable" test exit 1 (the zero-amount gap hidden behind
  a closing book is exactly the dangerous state).
  M4 (H4.3): verdict replaced by a hardcoded English string in an
  expression container (invisible to the lint rule, so the e2e is the
  witness that closes that residue), locale test exit 1 on NL.
