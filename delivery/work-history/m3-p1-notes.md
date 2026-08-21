# M3-P1 work notes (navigation phase)

Incremental log. Newest entries appended at the bottom.

## Session start
- Implementer session for M3-P1 on branch claude/m3-p1-navigation at base c518181, worktree /home/user/pulse-fleet/worktrees/m3-p1-navigation.
- Created this notes file first per the incremental-output clause.
- Mandated reading done so far: composed brief (contains the dispatch contract verbatim), schemas/work-history.schema.json (fleet copy, incl. gateResult/claim defs pulled from report.schema.json), tuition/mechanism-index.yaml (kernel copy under node_modules/@tiphys/kernel/tuition; project delivery/tuition/ holds only .gitkeep), gate-registry.yaml (fleet root; it is the KERNEL repo's registry, binding local gates for this product repo are CLAUDE.md's), gates.manifest.json (kernel; this phase adds no destructive command, nothing to register).
- Skills read: pulse-frontend, pulse-typescript. CLAUDE.md in context.
- Mechanism lookup (mechanism-lookup clause): index keys are a-guard-s-own-failure-path, append-only-log, asserting-a-ci-step-is-wired, atomic-file-replacement, checking-a-generated-artifact-against-its-own-generator, claim-file-mutual-exclusion-by-o-excl, classifying-another-program-s-errors, deciding-what-another-program-will-do-by-pattern-matching-the-text-of-a-file-it-consumes, lease-compare-and-swap, parsing-another-program-s-reporter-output, reading-a-path-whose-type-is-not-established, shared-worktree, supervising-a-dispatched-agent, verifying-access-to-a-remote, worktree-removal-and-force-branch-delete. None of the mechanisms this phase uses (React server components, next-intl catalogs, Playwright e2e, Vitest parity test) has an entry. The closest applicable rule is asserting-a-ci-step-is-wired: "a witness for a class must redden under at least two structurally different members", which I will honour in the catalog parity red-witness (redden it two ways: key removed from one target catalog, and an extra key added to a target catalog).
- Next: verification-first checks against the working tree before writing any code.

## Verification-first (findings before any code, commands and observed output)
- Base: `git log --oneline -1` prints `c518181 plan: pulse v0.2 delivery plan with adversarial review applied (M0-P2)`; branch `claude/m3-p1-navigation`, tree clean.
- Shell has no nav: read src/app/(app)/layout.tsx in full; the header renders brand eyebrow, `data-testid="household-context"`, and the sign-out form only (lines 17 to 27). CONFIRMS the grounding.
- Empty state has no link: src/modules/overview/ui/month-view.tsx, `EmptyState` (around line 386) renders `noData`/`emptyTitle`/`emptyBody` paragraphs, no Link element. CONFIRMS the grounding.
- No parity test: `grep -rn "parity" test/` prints nothing. `grep -rln "nav-overview\|nav-import\|nav-merchants\|app-nav" src/` prints nothing. CONFIRMS steps 3 and 4 build new things.
- Catalogs are at parity today: python key-set comparison over messages/{en,nl,fr}.json prints `en 101 nl 101 fr 101` and three empty set differences. So the parity test will be born green and its red witness must be forced locally (criterion 1.2 says exactly that).
- The plan cites layout.tsx:18; in the working tree the header opens at line 18 as cited. No finding contradicts the plan.
- ONE MECHANICAL GAP the plan is silent on, decided rather than escalated (small mechanical choice, R-034 distinction): a server layout cannot know the current pathname, and the App Router keeps the layout mounted across client-side navigations, so a server-computed active marker would go stale after the first click. The active marker therefore needs a small client island (usePathname). The literal data-testid strings and labels stay in layout.tsx (criterion 1.1's grep pins them there); the island receives them as props. New file src/platform/ui/nav-link.tsx, a primitive that knows nothing about transactions (pulse-frontend section 2 platform/ui test).
- SCOPE ADDITIONS, said the moment found (phase-scope clause): files-to-touch does not name (a) src/platform/ui/nav-link.tsx (the client island above; the alternative, putting "use client" on the layout file itself, is impossible because the layout is an async server component resolving the household context) and (b) src/app/globals.css (where every existing app-shell class lives; nav chrome classes belong beside .app-header, and styles/tokens.css is for tokens, not component rules). Both are needed; orchestrator should amend the declaration on the base branch before the scope audit.

## Environment measured
- node v26.7.0, npm in this shell. Docker daemon was DEAD (`docker ps` refused); started `sudo dockerd` in background at session start, waiting ~30s per fleet warning 8 before using the auth container.
- worktree node_modules was EMPTY; `npm ci` running in background.
- Ambient foreign credentials present exactly as fleet warning 1/6 says: DATABASE_URL, DIRECT_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (plus SUPABASE_BUCKET_NAME, SUPABASE_SIGNED_URL_EXPIRY) in the shell env. No .env in the worktree (only .env.example). ALL db/e2e invocations will pin the five values explicitly in the invoking shell: DATABASE_URL, DIRECT_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (local `supabase start` values).

## Red witnesses first (R-037a)
- Writing test/e2e/navigation.spec.ts and test/app/catalog-parity.test.ts BEFORE any implementation. The nav e2e is the natural red (no nav exists). The parity test is born green; will witness it red two structurally different ways per the asserting-a-ci-step-is-wired mechanism rule: (a) a key removed from one target catalog, (b) an extra key added to one target catalog. Commands and output to be captured below.
- Committed witnesses at 0cc70ad before any implementation code.

## Parity test red witness (criterion 1.2), captured 2026-08-21
Baseline: `npx vitest run test/app/catalog-parity.test.ts` at 0cc70ad: `Tests  3 passed (3)` (born green; catalogs are in parity at base, so the red is forced locally as the criterion instructs).
Red member 1 (missing key): deleted `signout` from messages/nl.json, reran. Output:
```
× message catalog parity across en, nl, fr > nl carries exactly the en key set 9ms
  → keys in en but not in nl: expected [ 'signout' ] to deeply equal []
```
Red member 2 (structurally different: EXTRA key): added `onlyInFrProbe` to messages/fr.json, reran. Output:
```
× message catalog parity across en, nl, fr > fr carries exactly the en key set 8ms
  → keys in fr but not in en: expected [ 'onlyInFrProbe' ] to deeply equal []
```
Both catalogs restored from backups; `git diff --stat` empty afterwards; rerun green.

## Local stack
- Docker daemon started; pre-existing local supabase stack (project_id m1-p1-skeleton, the id committed in supabase/config.toml) came up with docker: kong on 54321, postgres on 54322. `npx supabase status` gives the local ANON_KEY and SERVICE_ROLE_KEY demo JWTs.
- Pinned five-value env for every db/e2e invocation (fleet warnings 1 and 6): DATABASE_URL and DIRECT_URL postgresql://postgres:postgres@127.0.0.1:54322/postgres, NEXT_PUBLIC_SUPABASE_URL http://127.0.0.1:54321, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY from supabase status, plus SEED_USER_EMAIL/SEED_USER_PASSWORD from .env.example for the seed.
- db:reset attempt (pinned local) exited 1: the repo's own db guard printed an ALLOW for the local target, then Prisma 6.19's AI-agent consent guard refused migrate reset. Instead of quoting consent per the M1-P1 precedent, checked whether a reset was needed at all: `npx prisma migrate status` (pinned local) printed "5 migrations found ... Database schema is up to date!", exit 0. The local db already carries the full schema from the M1 runs and every e2e spec signs up its own fresh household, so NO reset was run and nothing destructive happened. Recorded as the cheaper and safer path, not a workaround of the guard.

## Implementation (commits c2aceec)
- messages: five new keys in en, nl, fr (navLabel, navOverview, navImport, navMerchants, emptyImportCta); parity re-verified by the fast gate (now 106 keys per catalog, key sets identical).
- src/platform/ui/nav-link.tsx (NEW, scope addition declared above): the one client island. "use client" reason recorded in the file: the shell layout stays mounted across client-side navigations, so a server-computed active marker would go stale; usePathname is the supported way to follow the route. No literal testid, no copy: both arrive as props from the layout.
- src/app/(app)/layout.tsx: nav element (aria-label from catalog) with the three NavLinks; ALL literal nav testids (main-nav, nav-overview, nav-import, nav-merchants) live in this file only, per criterion 1.1's grep pin. Household span got class app-household (margin-left auto moves from the sign-out form so the pair sits right of the nav).
- src/app/globals.css: .app-nav, .app-nav-link (inactive ink-muted, hover ink, focus ring via --focus-ring, active [aria-current="page"] ink + weight-medium + hairline underline via currentColor), .app-household, .empty-state-cta. Tokens only; NO new token was needed, so styles/tokens.css is deliberately untouched (it is on files-to-touch conditionally: "a missing token is added ... first"; none was missing).
- src/modules/overview/ui/month-view.tsx: EmptyState gains the Link to /import labelled t("emptyImportCta"), testid empty-state-import-link. jsx-no-literals holds (label is an expression container; attribute strings are not flagged by the rule's default options, and the phase changes nothing about that contract).

## Gate evidence at c2aceec (src state identical to final head)
- `npm run typecheck` exit 0. `npm run lint` exit 0. `npm test` exit 0: `Test Files 21 passed (21), Tests 252 passed (252)`, 0 skipped, invocation `vitest run` via npm, node v26.7.0. `npm run gate:tokens` exit 0.
- Criterion 1.3 grep, exact form: `grep -rE "oklch\(|#[0-9a-fA-F]{3,8}" src/` printed nothing, exit 1 (token and theme files live under styles/, outside src/, so no exclusion was even needed).
- Criterion 1.1 grep pin: `grep -rl "nav-overview" src/`, `grep -rl "nav-import" src/`, `grep -rl "nav-merchants" src/`, `grep -rl "main-nav" src/` each print exactly one file: src/app/(app)/layout.tsx.

## Navigation e2e red witness (R-037a), captured 2026-08-21
With the working tree's src/ restored to the witness commit 0cc70ad (`git restore --source=0cc70ad -- src/`, tree fully committed beforehand so nothing uncommitted was at risk), ran the two nav tests against the pre-nav code, pinned env, `npx playwright test -g "the nav is in the shell|active marker follows"` (-g per fleet warning 8). Output tail:
```
2 failed
  [chromium] › test/e2e/navigation.spec.ts:76:5 › empty household: the nav is in the shell and the empty state links to import
  [chromium] › test/e2e/navigation.spec.ts:92:5 › seeded household: header links navigate and the active marker follows the route
```
failing at `expect(page.getByTestId("main-nav")).toBeVisible()` (navigation.spec.ts:63). HONESTY NOTE: the runner's numeric exit code was swallowed by the `| tail` pipeline in that capture (the echoed 0 is tail's, not playwright's); the reported-red evidence is the runner's own "2 failed" listing above. Both tests fail on the first nav assertion, and the two members are structurally different journeys (empty household via the empty state, seeded household via click-through), so the witness reddens under two members of the class.
Then `git restore --source=HEAD -- src/` (tree clean afterwards, `git status --short` empty).

## Client-boundary probe (settles the "layout could not be the client component" claim)
- `sed -i '1i "use client";' 'src/app/(app)/layout.tsx' && npm run typecheck` exited 0: tsc alone does NOT witness the boundary, so a typecheck probe is insufficient evidence here.
- Same probe through `npm run build`: exit 1, `Error: x You're importing a component that needs "next/headers". That only works in a Server Component ... Build failed because of webpack errors`. Layout restored with git restore; src tree clean afterwards. Recorded as claim M3P1-C5 in the work history.

## Work history
- delivery/work-history/m3-p1.yaml written and validated: `npx --prefix /home/user/pulse-fleet tiphys validate --type work-history --context . delivery/work-history/m3-p1.yaml` exit 0 (Node 26 via nvm). First attempt was INVALID at #/claims/5 (an open question quoting dispatch words that carry guarded tokens); fixed by dropping the verbatim quotes and adding still-open-because, revalidated to exit 0.
- Claim grep from the brief run over the yaml, exact form, plus the whitespace-flattened variant: hits at prompt lines (dispatcher's verbatim words, claim M3P1-Q2), and at three prose sites each carrying an adjacent reference to executed construction M3P1-C5. No unsettled hit.

## Full e2e green at c2aceec
`npm run test:e2e` with the five values pinned in the invoking shell: exit 0, `14 passed (2.1m)`, 0 skipped, 0 did-not-run, invocation `playwright test` via npm against the config's own dev webServer (PULSE_FIXED_NOW=2026-09-15T12:00:00Z), node v26.7.0, chromium project. Includes both navigation tests green and test/e2e/golden-journey.spec.ts green UNMODIFIED: `git diff c518181..HEAD -- test/e2e/golden-journey.spec.ts | wc -l` prints 0, no selector change was forced (criterion 1.4 first half). `git diff --name-status c518181..HEAD` shows only A/M entries, no D: no test file deleted (criterion 1.4 second half).

## Fix round 1 (hazard review lows CR-601, CR-602), 2026-08-21
Both clean-room verdicts were APPROVE; the hazard review filed two lows, closed here before merge. Order followed: lying-test/red witnesses first, fixes second, gates third (R-037a).
- CR-602 defect reproduced first: nl emptySteps cut from 3 to 2 entries, OLD top-level parity test: `Tests 3 passed (3)`, exit 0 (the reviewer's construction, reproduced locally). Test repaired to deep leaf paths (array indices become path segments, object keys join with dots). NEW test red member A (same mutation): `paths in en but not in nl: expected [ 'emptySteps[2]' ] to deeply equal []`, 1 failed. Red member B (fr prevMonth array replaced by a string, a structurally different shape drift): `paths in en but not in fr: expected [ 'prevMonth[0]', 'prevMonth[1]' ] to deeply equal []`, 1 failed. Catalogs restored, green (3 passed), `git diff --stat messages/` empty.
- CR-601 red witness: new e2e test walks upload to the confirm step on the real /import/<id> sub-route (the redirect in src/modules/import/ui/actions.ts:30) and expects nav-import current PLUS nav-overview and nav-merchants not current, so a mark-everything fix would also redden. Against the exact-match NavLink: `npx playwright test -g "import link stays current"` (pinned env) exit 1, failing at navigation.spec.ts:110 `toHaveAttribute("aria-current", "page")`. Witness commit bb6ea80, pushed before the fix.
- Fix commit 1a0e0d8: isCurrentRoute in nav-link.tsx, root href exact-only, non-root exact or prefix-plus-slash; the rule is recorded at the definition and the CSS sibling (.app-nav-link[aria-current="page"]) named there.
- Gates at 1a0e0d8: typecheck exit 0, lint exit 0, gate:tokens exit 0, `npm test` exit 0 `Test Files 21 passed (21), Tests 252 passed (252)` 0 skipped, `npm run test:e2e` (five values pinned) exit 0 `15 passed (2.2m)` including the new sub-route test, node v26.7.0.
- Derivations with full output are in the work history's fix-round section: pathname consumers under src/ (one nav decision site; two middleware startsWith guards outside the shell, read and left alone) plus the shell route listing (import/[id] is the only sub-route today); and the array-valued catalog keys per locale (prevMonth 2, steps 3, emptySteps 3 in all three, no other non-string values). Residues stated there rather than implied: value-level translation quality and ICU placeholder parity are deliberately outside the parity guard; a future href pair where one nav href prefixes another would mark both current and has no instance to witness today.

## Defect round (owner-reported, criterion 1.5), 2026-08-21
Branch rebuilt by the orchestrator from main 0a49ef7 (previous work merged there; plan amended with criterion 1.5: 390x844 on every authenticated route, nav links, account identity and sign-out visible and clickable, documentElement.scrollWidth within the viewport width, with a kept desktop assertion).
- Escaped-defect mechanism, recorded honestly: no criterion named a viewport, every gate and both reviews ran at Playwright's Desktop Chrome default, so the reviews verified a blind contract faithfully. Pre-round proof: `git grep -n "viewport" 0a49ef7 -- playwright.config.ts test/e2e/` exit 1, zero hits.
- Red witness first (commit 3476e15): two new explicit-viewport tests in navigation.spec.ts (test.use 390x844 and 1280x720), walking /, /import, /merchants with an empty household, asserting nav links + household-context + sign-out visible, scrollWidth <= viewport, and a real sign-out click at 390. Against the merged code: exit 1, `Error: no horizontal scroll on /`, Expected <= 390, Received 476 (the header row, the owner's report). Desktop sibling green.
- Fix 1 (header, globals.css): .app-header flex-wrap with gap var(--space-4) var(--space-8); .app-header form flex-shrink 0 (sign-out moves whole to the next row, does not shrink away); .app-nav flex-wrap; .app-household min-width 0 + ellipsis (textContent intact, painting clipped). Rerun: phone test STILL red, now `no horizontal scroll on /import`, Received 396: the second overflowing element was page content, .import-field input's unconditional `min-width: var(--layout-rail)` (372px, globals.css:261 at 0a49ef7).
- Fix 2 (import field, globals.css): `min-width: min(var(--layout-rail), 100%)` plus max-width 100% on input/select and .import-field. Rerun: 2 passed, exit 0. No media query anywhere: wrapping serves every width, so no breakpoint literal was needed.
- Commit a5d37c0, pushed with --force-with-lease (rebuilt branch; remote was the pre-merge line 2c30eae).
- Gates at a5d37c0: typecheck 0, lint 0, gate:tokens 0, npm test 0 (`Test Files 21 passed (21), Tests 252 passed (252)`, 0 skipped), npm run test:e2e (five values pinned) exit 0 `17 passed (2.5m)`: all 15 previous tests green untouched plus the criterion 1.5 pair. Criterion 1.3 grep exit 1 (no literal colours).
- Residues stated in the work history fix-round entry: /import/[id] and a seeded month view are not asserted at 390 (criterion names the navigation controls on the three routes); non-EN locales not pinned at 390; heights not probed.

## Docs correction round (CR-701, R-087), 2026-08-21
The defect-round derivation block in m3-p1.yaml was RECONSTRUCTED, not pasted: six of eight line numbers resolved at no committed state (spec :181/:196 vs true 178/193; globals.css :126/:161/:163/:164/:299 vs true 124/162/164-165/289), one listed hit (text-overflow) was outside the stated grep's own pattern, and the "combined hits in full" parenthetical was false (6 of 20 globals.css hits listed). Corrected loudly in place, not silently: the block now opens with a correction note naming what was wrong, followed by the true output of the stated command re-run at bba9132 and pasted verbatim (9 viewport hits, 20 globals.css hits, complete), and the false parenthetical is replaced by a correction scoping the five hits this round touched (104, 124, 162, 165, 289) against the pre-existing remainder. The pre-round 0a49ef7 evidence in the same entry was real captured output and stands unchanged. tiphys validate exit 0 after the correction. No code changed in this round.
