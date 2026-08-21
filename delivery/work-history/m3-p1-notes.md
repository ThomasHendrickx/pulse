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
