# M1-P4 notes: merchants and sources (rules plus manual)

Running log, appended as the work happens (incremental-output clause).
Phase branch: claude/m1-p4-merchants, base main 491d3c8.

## Mandated reading record

Read in order before any code:
1. roles/_shared-dispatch-contract.md: carried inside the brief body
   (implementer-brief-m1-p4.md, "The dispatch contract" section). Read.
2. schemas/work-history.schema.json: read at
   /home/user/pulse-fleet/schemas/work-history.schema.json. Required keys
   noted: kind, phase, prompt (verbatim), files-touched, per-step-commits,
   key-decisions, verification-first (contradicts-plan boolean per
   finding), deviations, gate-evidence, claims, environment-warnings.
3. tuition/mechanism-index.yaml: the project's delivery/tuition/ contains
   only .gitkeep; no mechanism-index.yaml exists anywhere under
   /home/user/pulse-fleet (find run 2026-08-20, no hits outside
   node_modules). The M1-P3 work history recorded the same state and read
   the kernel copy at node_modules/@tiphys/kernel/tuition/mechanism-index.yaml;
   Checked the fleet-level copy at
   /home/user/pulse-fleet/node_modules/@tiphys/kernel/tuition/mechanism-index.yaml
   (never a sibling worktree, per clause R-031): its fifteen entries are
   kernel-process mechanisms (claim files, leases, append-only logs,
   worktree removal, reporter parsing, generated-artifact drift). It has
   NO entry for merchant resolution, string normalisation, resolver
   chains, Prisma migrations or recompute: a recorded answer, not a
   skipped lookup. Two general rules still apply and are honoured:
   assert-by-name over append-only registries (the RLS and tenancy tests
   already derive tables from the DMMF), and a witness for a class must
   redden under two structurally different members (applied to the CR-308
   witnesses and the resolver tests).
4. gate-registry.yaml: read at /home/user/pulse-fleet/gate-registry.yaml.
   It is the KERNEL repository's registry (npm ci, npm run build tsc -b,
   node --test); the pulse project's own gates are the CLAUDE.md commands
   (typecheck, lint, vitest fast gate, playwright slow gate), which is how
   M1-P2 and M1-P3 recorded gate evidence. Following that precedent.
5. gates.manifest.json: not present in /home/user/pulse-fleet (find run,
   no hits outside node_modules). The kernel copy ships in
   node_modules/@tiphys/kernel. This phase adds no destructive command, so
   destructiveCommands is not extended.

Then: the phase declaration (in the brief), the plan section
(delivery/intake/pulse-v1-plan.md:155,164,192-193;
pulse-v1-architecture.md:35,183-197; acceptance-criteria.md:68-79), and
the three repo skills (pulse-domain, pulse-typescript, pulse-frontend),
all read in full.

## Scope escalation, raised now rather than at the scope gate

files-to-touch for M1-P4: src/modules/merchants/, src/modules/ledger/,
prisma/, test/domain/normalise-counterparty.test.ts,
test/application/resolve-merchants.test.ts, test/e2e/merchants.spec.ts;
extras src/modules/import/domain/parse-amount.ts and
test/domain/profile-detection.test.ts; work-history files are standing
extras.

Files I already know the phase needs BEYOND that list (the brief says say
it the moment it is found; the amendment must land on the base branch):

1. src/app/(app)/merchants/page.tsx: the manual-assignment UI needs a
   route. app/ routes stay thin (pulse-frontend section 2): the file
   resolves the household context and renders the merchants module's ui
   component; all substance lives in src/modules/merchants/ui/. There is
   no other way to give the e2e a URL to visit.
2. test/application/fake-import-world.ts: the fast-gate world must grow a
   merchants store (rules, merchants, tags) and thread the resolver port
   into the ledger deps, exactly as M1-P3 extended the same file (that
   extension was accepted as a deviation there).

Not needed after checking: messages/{en,nl,fr}.json already carry every
key the merchants page uses (merchants, merchantsBody, merchantsFoot,
nameIt, namePlaceholder, times, total, income, spend, counterparty,
unresolvedMany), seeded from the design prototype; key parity verified
88/88/88.

## Observation, recorded not fixed (outside scope)

messages/en.json "merchantsBody" (and its nl sibling) contains an em dash,
which CLAUDE.md non-negotiable 7 forbids in user-facing copy. Pre-existing
on main (design-prototype copy deck), messages files are not on this
phase's declaration, so recorded here for the orchestrator rather than
edited.

## Design decisions before code (summary; full rationale in work history)

- Schema: prisma/schema/merchants.prisma with Merchant (unique
  householdId+name), MerchantRule (kind EXACT|PREFIX|PATTERN, pattern
  string, unique householdId+kind+pattern), Tag (unique householdId+name),
  MerchantTag (unique merchantId+tagId, isPrimary boolean). Transaction
  gains nullable merchantId (interpretation column, exactly like flow).
  One migration, RLS enabled on all four new tables (rls.test.ts derives
  the list from the DMMF and reds otherwise).
- Resolution runs inside ledger interpretation: LedgerDependencies gains a
  MerchantResolverPort with EXACTLY one member, resolveCounterparties.
  The interpret use case therefore has no rule repository dependency BY
  CONSTRUCTION (criterion 3.2); the port is bound in ledger's composition
  root to the merchants module's published RuleResolver use case.
- Manual assignment (assignMerchant use case): normalise the counterparty
  text, find-or-create the Merchant by name, upsert an EXACT MerchantRule
  for the normalised string, then trigger recompute through a port bound
  to ledger's recomputeInterpretation AT THE UI ACTION layer (composition
  at the caller), so merchants/application never imports ledger and no
  module-level import cycle exists (ledger's index imports merchants for
  the resolver binding).
- Merchant resolution renames and regroups ONLY: it writes
  transactions.merchantId and touches no flow, no amount, no correction
  key (hazard H3.2); the ledger's refund counterpartyKey is deliberately
  NOT switched to the new normaliser in this phase (that would change
  classifications, and M1-P3's open question C9 hands that to a decision,
  not to a side effect).
- Cash withdrawals are NOT special-cased in resolution this phase: a cash
  row resolves like any row if a rule matches; destination-cash grouping
  is projection work (M1-P5). Recorded as an open question because
  ledger/domain/corrections.ts says the M1-P4 resolver groups by the cash
  marker; doing that requires the projection layer that does not exist
  yet.

## Log

- [start] Worktree verified clean at 491d3c8. Brief, schema, skills,
  plan excerpts, fixtures, existing ledger/import modules read.

- [CR-308] Red witness first: added the CR-308 describe block to
  test/domain/profile-detection.test.ts (four tests: debitCredit member,
  indicator member, unsigned control, direct unsigned entry). Against the
  unfixed parser: `npx vitest run test/domain/profile-detection.test.ts`
  exit 1, "Tests 3 failed | 43 passed (46)" (the control passed, as
  expected). Fix: parseUnsignedAmountToCents now rejects a parse that
  comes back negative (guarantee carried by the OUTPUT, so no future
  normalisation change can smuggle a sign through), leading-sign check
  kept as the loud fast path; the falsified "can never diverge again"
  claim corrected IN PLACE and loudly (R-087) in the same comment. After
  the fix: same suite 46 passed, exit 0; full fast gate 159 passed (15
  files), exit 0, Node v26.7.0, vitest run, no build step required.
  Deliberate choice AGAINST fixpoint stripping: making stripCurrencyNoise
  iterate would have CHANGED the signed representation's behaviour too
  ("EEURUR-742,10" in a signed column currently fails loud as
  unparseable; a fixpoint strip would make it parse as -742,10), and the
  backlog item's scope is the unsigned entry. The brief offered either
  fix; the output rejection is the one that adds no new accepted inputs.

- [schema] prisma/schema/merchants.prisma added (Merchant, MerchantRule,
  Tag, MerchantTag, all non-null householdId), Transaction gained the
  nullable merchantId interpretation column beside flow, Household the
  back-relations. Red first: `npx vitest run test/schema` exit 1, RLS test
  naming exactly [merchants, merchant_rules, tags, merchant_tags] as
  missing enablement; tenancy suite stayed green (21 passed), so the new
  models satisfy householdId-on-every-model and money-name rules by
  construction. Docker daemon was dead; sudo dockerd revived the
  m1-p1-skeleton supabase stack with data intact (fleet warning holds).
  Migration 20260820073725_merchants_rules_and_tags created with
  DATABASE_URL and DIRECT_URL pinned to 127.0.0.1:54322 in the invoking
  shell (fleet warning 1), RLS enablement appended for all four tables
  (same pattern as the transfer_links migration), applied clean. After:
  test/schema 24 passed, exit 0; live check via docker exec psql:
  relrowsecurity = t for all eleven application tables. The one-primary
  invariant for MerchantTag is application-enforced (setMerchantTag),
  because Prisma cannot model a partial unique index and a hand-added one
  would make the next `prisma migrate dev` see drift; recorded at the
  model definition.

- [domain+application] normalise-counterparty red first (collection error,
  exit 1, "Tests no tests" with the module absent), then 18 passed.
  Resolver, assignment, tags, review grouping implemented; ledger gained
  the one-member MerchantResolverPort, merchant writes in
  replaceInterpretation (set-based, null clears), resolver binding in the
  composition root; fake world grew the merchants store, the REAL resolver
  over it, and a declarationWrites counter. Full fast gate 177 passed at
  9b329b3.
- [criterion 3.2 suite] test/application/resolve-merchants.test.ts: 14
  tests green at first run against the committed implementation, so the
  suite's teeth were then PROVEN BY MUTATION, five structurally different
  members of the phase's hazard classes, each applied, run, restored:
    M1 interpretation drops merchant assignments: exit 1, 4 failed | 10 passed
    M2 assignMerchant writes the rule but skips recompute (declaration
       never applied): exit 1, 3 failed | 11 passed
    M4 resolver ignores PREFIX rules: exit 1, 3 failed | 11 passed
    M6 rebuild preserves stale row edits instead of clearing (hazard
       H3.1's dangerous state): exit 1, 1 failed | 13 passed
    M5 INTERNAL rows resolve merchants too: exit 1, 1 failed | 13 passed
  After restore: 14 passed, exit 0. Criterion 3.2's by-construction half
  is double-guarded: expectTypeOf pins LedgerDependencies["merchants"] to
  exactly one key (typecheck gate reds on any addition) and the runtime
  half counts zero declaration writes across upload, interpret and
  recompute.

- [ui] Manual-assignment UI: MerchantReviewScreen (server component,
  module ui/), assignMerchantAction (one use case, recompute bound to the
  ledger's published interface AT THE ACTION, no module cycle), published
  ui/index.ts, thin route src/app/(app)/merchants/page.tsx. SCOPE NOTE,
  adding to the escalation above: src/app/globals.css also had to change
  (merchant-* classes plus a visually-hidden a11y helper), because module
  screens are styled there by the repo's established pattern and CLAUDE.md
  forbids literal values in components; tokens only, all existing (the
  draft used two nonexistent tokens, --layout-content and --layout-measure,
  replaced with --layout-max and the import screen's line-height pattern
  before commit). No new message keys needed: the design-prototype seed
  already carries the merchants copy in all three languages. Lint warnings
  from rest-destructuring discards were removed by an explicit named fact
  snapshot; lint now exits 0 with zero warnings.
