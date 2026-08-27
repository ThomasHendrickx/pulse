# M3-P11 working notes (optimistic naming)

Branch claude/m3-p11-optimistic-naming, base e499d64370eef9957a8ebd8672bf4029e5816def
(origin/main at dispatch). This file is the running beacon; the schema-shaped
record is delivery/work-history/m3-p11.yaml, written from these notes.

## Environment at dispatch

- No Docker in this container, so no local Supabase auth service: every
  browser e2e arm is AUTHORED and cannot run here. Each such arm is recorded
  environment-limited with the exact owed command.
- Node via /opt/nvm. Playwright browsers at /opt/pw-browsers (chromium-1194).
- Ambient DATABASE_URL belongs to a foreign project (fleet warning 1/16/22):
  every command that could open a database is pinned to an invented
  127.0.0.1 target first.
- gate-privacy.sh at origin/main HEAD: commit dc8c505cdfe40c2ec85136d8aacb9d2fac31996c
  (last commit touching it), blob 87b248148ee08bf013b0714a61c5a27280fe667e.

## Mandated-reading results

- roles/_shared-dispatch-contract.md: included in the composed brief; read.
- schemas/work-history.schema.json: read (required keys, gateResult/claim
  shapes, verification-first boolean contract).
- tuition/mechanism-index.yaml: DOES NOT EXIST in this fleet home.
  `find /home/user/pulse-fleet /home/user/wt-m3p11 -name "*mechanism*" -not -path "*/node_modules/*"`
  printed nothing. Recorded as "the index has no entry" for every mechanism
  this phase touches; there is no index to consult.
- gates.manifest.json: DOES NOT EXIST in this fleet home (same find shape,
  `cat /home/user/pulse-fleet/gates.manifest.json` -> no such file). The
  destructive-authority clause's third conjunct has no registry here; this
  phase adds no destructive command, so nothing is owed to it.
- gate-registry.yaml: exists in /home/user/pulse-fleet; the brief's generated
  gate table names kernel gates run by the orchestrator. The gates THIS phase
  runs are the repository's own (CLAUDE.md + dispatch): typecheck, lint,
  npm test, gate:privacy, gate:decisions, gate:tokens, npm run build, and
  test:e2e (environment-limited here).

## Staleness found before any edit (plan grounded at 89ed187, tree at e499d64)

1. "A failed naming is silent today" is NO LONGER TRUE at this branch point.
   M3-P12 (merged, ordered strictly BEFORE this phase by decision D-44) made
   the action redirect with a per-kind status and made the screen read it:
   src/modules/merchants/ui/actions.ts:31-38 redirects to
   /merchants?status=<kind>, src/app/(app)/merchants/page.tsx reads
   searchParams.status, and merchant-review.tsx renders the mapped refusal
   copy under data-testid="naming-refused" (REFUSAL_MESSAGE map). The
   stale-subject spec in test/e2e/merchants.spec.ts (third test) asserts that
   banner is visible after a refused naming. Consequence for this phase: the
   step "make the action REPORT its outcome instead of redirecting a failure
   into a status nothing reads" now REPLACES a loud path with a louder one,
   and that spec's mechanism moves with it. Handled below, recorded as a
   deviation on the spec amendment.
2. Criterion 11.7(a)'s "at most FIVE" client files predates M3-P14, which
   shipped src/modules/accounts/ui/account-setup-form.tsx with "use client".
   The tree at base already carries FOUR client files
   (account-setup-form, submit-button, link-pending, nav-link;
   src/app/layout.tsx matches a grep for the directive only inside a comment).
   With this phase's toast and merchants leaf the honest count is SIX. The
   fast-gate guard test/app/client-boundary.test.ts asserts BY NAME, exactly
   so a stale count fails nothing silently; the named-set half of 11.7(a) is
   what is measured here, the count is reported stale-against-tree.

## Verification-first log (commands + captured output in the yaml)

(started 2026-08-27, before any product edit)

### (f) copy gate fires on a bare literal in this phase's own new component
Command: created throwaway src/platform/ui/vf-literal-probe.tsx carrying
`<p>bare english sentence that must be caught</p>`, ran `npm run lint`.
Captured: exit=1, output names the file and
`3:13  error  Missing JSX expression container around literal string: "bare
english sentence that must be caught"  react/jsx-no-literals`.
File deleted, not committed; lint on the clean tree exits 0 (captured).

### (b)(c)(d) unit-level halves (throwaway test/application/vf-m3p11-scratch.test.ts, deleted)
Command: `npx vitest run test/application/vf-m3p11-scratch.test.ts` (3 passed).
- (c) input merchantName "  Bakkerij  " -> stored merchant name "Bakkerij"
  (captured: `confirmed merchant name: "Bakkerij"`). The trimmed-name
  difference case is real and deterministic.
- (b) naming a second identity key with an EXISTING merchant's name creates
  NO second merchant: captured `merchant count: 1` with two EXACT rules both
  on m-1. The merge is real; the merged group total on screen is the sum, so
  the prediction must not cover totals. Browser half owed (below).
- (d) whitespace-only name -> captured
  `{"ok":false,"error":{"kind":"empty-merchant-name"}}`. What the reader
  sees TODAY at this branch point is NOT "nothing at all" as the plan's
  grounding (read at 89ed187) says: M3-P12 merged since and the action
  redirects to /merchants?status=empty-merchant-name, which
  src/app/(app)/merchants/page.tsx reads and merchant-review.tsx renders as
  the nameRefusedName banner (data-testid="naming-refused"). Code-level
  captures: actions.ts:31-38 (redirect with status), page.tsx searchParams
  read, REFUSAL_MESSAGE map. Browser half owed (below).

### (e) WHICH transport failure reaches the client wrapper: SETTLED, first form
Throwaway probe (never committed): src/app/(auth)/sign-up/vf-probe/
(page + "use client" island with useOptimistic + "use server" action
returning a Result object), `npm run dev` with every env value pinned to
invented 127.0.0.1 targets, driven by a playwright script.
Captured (### lines in scratchpad vf-probe-out.txt):
- A RETURNED Result object reaches an awaiting client wrapper:
  `resolved:{"ok":true}` and `resolved:{"ok":false,"kind":"probe-fail"}`.
- Route handler FULFILLS the action POST with 500:
  `rejected:Error|vf probe forced 500`; NO framework error page (locator
  count for "Application error" = 0); the optimistic label reverted to the
  server value (`s2-label: SERVER LABEL`). THE FIRST ADMISSIBLE FORM WORKS
  and is the one the spec uses: fulfil with 500, observed by the wrapper as
  a catchable rejection.
- Route handler ABORTS the request: `rejected:TypeError|Failed to fetch`,
  label reverted. Also reaches the wrapper; not needed since form one works.

### (g) the ANNOUNCEMENT, not the tree
Same probe, action delayed 2000ms by the route handler:
- Region (role="status") text BEFORE click: "" (captured).
- MutationObserver scoped to that region captured the unconfirmed text
  ENTERING at the moment the prediction landed:
  `g-observed-entering: ["Not saved yet"]`; the row carried
  data-unconfirmed (captured "").
- The browser's OWN tree (CDP Accessibility.getFullAXTree): the focused
  submit control while predicted:
  `{"role":"button","name":"Name it","description":"Not saved yet",
  "properties":[...,"focused=true","describedby=\"probe-region\""]}`;
  description null BEFORE the click and null AFTER the response, and the
  region's text was gone after the response ("").
- RECORDED PER THE CRITERION: an accessibility-tree entry alone does not
  answer the announcement question; the announcement evidence here is the
  MutationObserver capture of text entering the live region, and the tree
  capture answers only the separate description-exposure half.

### (a) and the browser halves of (b), (d): ENVIRONMENT-LIMITED
No Docker in this container, so no Supabase auth service and no e2e run.
Owed commands, exactly:
- (a) `npm run test:e2e -- -g "naming an unresolved counterparty"` (asserts
  income-total and spend-total byte identical across the naming; the
  committed journey's own assertions are the record).
- (b) browser half: drive test/e2e/optimistic-naming.spec.ts merge journey
  (authored in this phase) under chromium-prod:
  `npm run test:e2e -- --project=chromium-prod -g "merge"`.
- (d) browser half: on the shipped screen at this base, submit a
  whitespace-only name and capture the naming-refused banner:
  `npm run test:e2e -- -g "stale page"` witnesses the banner mechanism.

### (e) addendum, MEASURED: what SUCCESS looks like to the awaiting wrapper
Second throwaway probe, action doing revalidatePath + redirect (the success
path this phase must keep exactly as it is). Captured:
`rejected:Error|NEXT_REDIRECT|digest=NEXT_REDIRECT;push;/sign-up/vf-probe;307;`
and the navigation completed. So a successful redirecting action REJECTS the
awaiting wrapper with an error whose digest begins NEXT_REDIRECT. THE CLIENT
WRAPPER MUST RETHROW THAT ERROR rather than treat it as a transport failure,
or every SUCCESS would raise the failure toast. The leaf tests
`digest` startsWith "NEXT_REDIRECT" and rethrows. Also observed: the client
island kept its state (the log) across the success redirect to the same
route, confirming client-component state at a stable tree position survives
the refresh, which is what the difference-notice claim mechanism rests on.

### (e) addendum 2, MEASURED: the busy state survives the client wrapper
Third throwaway probe: a form whose action is a plain async CLIENT function
that awaits the server action, with a child submit reading useFormStatus.
Captured: `button-while-inflight: PENDING`, `aria-busy-while-inflight:
"true"`, `button-after: IDLE`. So M3-P10's SubmitButton busy state
(criterion 10.3) still fires when this phase wraps the action. Also
captured: with a function action React renders
`action="javascript:throw new Error('React form unexpectedly submitted.')"`,
so a no-JavaScript submit does NOTHING (no GET fallback, the identity key
does not leak into a query string). The no-JS naming is therefore silent
after this phase, which the plan's step records as the parked honest limit.

## Claim grep (brief clause claim-grep)

Ran, exactly as the brief writes it, over delivery/work-history/m3-p11.yaml
and over the whitespace-flattened text. Hits and their disposition:
- two occurrences of "never" inside the PROMPT block, which is the dispatch
  quoted verbatim per the schema's own requirement; they are the
  dispatcher's instructions, not claims made by this history.
- one "ALWAYS" in a key-decision was reworded to the precise statement (the
  region is rendered with the naming form from the row's first render).
After the rewording the only remaining hits are the two verbatim prompt
lines.
