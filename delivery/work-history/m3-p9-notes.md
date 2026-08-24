# M3-P9 acceptance walk

Branch `claude/m3-p9-pressed-and-disabled`, base `origin/main` a4f1a94.
Every command below was run in `/home/user/wt-m3p9` with
`export NVM_DIR=/opt/nvm && . /opt/nvm/nvm.sh` first. Phone results are
Chromium emulation results under the `chromium-phone` project's device
descriptor at 390 by 844 with `isMobile` and `hasTouch` set; no physical
device is reachable from this container.

## 9.1 the six verification-first answers: MET

All six are in `delivery/work-history/m3-p9.yaml` under `verification-first`,
each with the command and its captured output. Summary of what each returned:

| Question | Answer |
|---|---|
| (a) seven rule counts over every tracked stylesheet | 4 `:hover` in `src/app/globals.css` (:192, :243, :701, :758) and a fifth at `styles/tokens.css:201`; 0 `:active`, 0 `:disabled`, 0 `transition`, 0 `animation`, 0 `@keyframes` in all four; 5 `cursor` (:89, :239, :381, :439, :617) |
| (b) token absence and heading text | three non-token hits; heading at `styles/tokens.css:116` reads `Space, radius, elevation` with no elevation token under it |
| (c) `prefers-reduced-motion` under `src/`, `styles/`, `test/` | nothing, exit 1 |
| (d) the sweep | 19 identities collected, equal to the plan's enumeration in both directions; no amendment needed |
| (e) held press under `chromium-phone` | `page.mouse.down` DOES yield `:active` (`matchesActiveMouse: true`); touch emulation was not dropped |
| (f) real phone browser | none reachable; every phone result is emulation and says so |

## 9.2 the pressed appearance: MET

- **(a) the set, swept not looked up.** The spec runs
  `button, a[href], summary, input[type="submit"], input[type="button"], [role="button"]`
  on every screen it reaches and collects identities. It printed
  `swept control set (19):` on all four runs and then asserted
  `expect(found).toEqual(expected)` against the enumeration, which fails on a
  missing control and on an extra one alike.
- **(b)(i) movement.** `transform: translateY(var(--press-offset))`, with
  `--press-offset: 2px` in `styles/tokens.css`. The spec checks that the
  computed matrix carries a vertical translation of at least 1 and equal to the
  computed `--press-offset`, **and** that the element's own
  `getBoundingClientRect().top` moved, because a probe showed Chromium
  reporting `matrix(1, 0, 0, 1, 0, 3)` on an inline anchor whose box did not
  move.
- **(b)(ii) surface.** `background-color: var(--color-surface-pressed)`
  (`--pulse-grey-200`) for sixteen of the nineteen and
  `var(--color-surface-inverse-pressed)` (`--pulse-grey-600`) for the three
  inverse-surface submits. The spec composites the held background over the
  nearest non-transparent ancestor background and does the same for the
  hovering one, and requires a WCAG ratio of at least 1.1 to 1. Measured
  headroom, from a probe run in this container: white to grey-200 1.746, paper
  to grey-200 1.676, flag background to grey-200 1.508, grey-700 to grey-600
  1.501. The comparison is against the **hovering** state, not at rest.
- **(c) the platform cue.**
  `grep -rn "tap-highlight" $(git ls-files "*.css")` exits 1. The comment
  explaining the choice spells the property name out in words for that reason.

## 9.3 disabled, busy and unconfirmed: MET

Applied through the DOM (decision D-28): `disabled` on buttons and inputs,
`aria-disabled="true"` on links and the summary, `aria-busy="true"` for busy,
`data-unconfirmed` on a merchant-review row.

- (a) disabled: `--color-surface-disabled`, `--color-ink-disabled`,
  `opacity: 0.55` and `cursor: default`. The magnitude clears both branches;
  the cursor assertion is what caught `.spec-editor summary`'s `cursor: pointer`
  outranking a bare attribute selector, which the element-qualified selectors
  fix.
- (b) busy: `opacity: 0.7` plus an `::after` mark with
  `content: ""`, a width of `var(--space-5)` and a loop on
  `--duration-busy-cycle`. The spec asserts `::after` content is not `none` and
  its computed width is above zero.
- (c) unconfirmed: `opacity: 0.72` and its own `::after` ring. Not `aria-busy`,
  for the reason the plan and decision D-29 give.

## 9.4 reduced motion: MET

One `@media (prefers-reduced-motion: reduce)` block in `styles/tokens.css`
redefines `--duration-press`, `--duration-state` and `--duration-busy-cycle` at
`:root`; no rule carries a variant of its own.

- (a) under reduce every value in computed `transition-duration` is `0s` on all
  nineteen, and no control runs an animation.
- (b) under no-preference at least one control reports a non-zero
  `transition-duration`, asserted at the end of the journey.
- (c) the whole of 9.2(b) and 9.3 re-runs under a context created with
  `contextOptions: { reducedMotion: "reduce" }` and passes with the same
  magnitudes. The travel is deliberately not zeroed there, which is the half
  that keeps the feedback and drops only the easing.

## 9.5 tokens only: MET

- (a) `grep -rEn "oklch\(|#[0-9a-fA-F]{3,8}|[0-9]+px" src/ --include="*.tsx"` → exit 1.
- (b) `grep -nE "^[^/*]*[0-9.]+(px|rem)"` over every `*.css` except
  `styles/tokens.css` → the same four lines as at base:
  `src/app/globals.css:624,625,627` and the media condition line.
- (c) `grep -nE "^[^/*]*[0-9.]+m?s[;, )]|cubic-bezier|steps\("` over the same
  files → nothing, exit 1.
- (d) `npm run gate:tokens` → exit 0.

All nine token names are declared in `styles/tokens.css`:
`--duration-press: 90ms`, `--duration-state: 160ms`,
`--duration-busy-cycle: 900ms`, `--ease-standard: cubic-bezier(0.2, 0, 0, 1)`,
`--press-offset: 2px`, `--color-surface-pressed: var(--pulse-grey-200)`,
`--color-surface-inverse-pressed: var(--pulse-grey-600)`,
`--color-ink-disabled: var(--pulse-grey-300)`,
`--color-surface-disabled: var(--pulse-grey-100)`.

## 9.6 the media-condition budget: MET

`grep -rhoE "@media[^{]+" $(git ls-files "*.css") | tr -s ' ' | sed 's/ $//' | sort -u`
returns exactly two lines: `@media (min-width: 768px)` and
`@media (prefers-reduced-motion: reduce)`. `git ls-files "*.css"` returns the
same four files as at base. `--breakpoint-wide: 768px` still matches the one
min-width condition.

## 9.7 a stylesheet phase: MET

CORRECTED IN FIX ROUND 1 (finding CR-M3P9-05): this said FIVE paths and then
listed six. `git diff --name-only origin/main` prints six paths:
`delivery/work-history/m3-p9.yaml`, `delivery/work-history/m3-p9-notes.md`,
`playwright.config.ts`, `src/app/globals.css`, `styles/tokens.css` and
`test/e2e/pressed-and-disabled.spec.ts`. No `*.tsx`, nothing under
`src/modules/`, `messages/`, `prisma/` or `test/fixtures/`.
`git diff --stat origin/main -- package.json package-lock.json` prints nothing.

## 9.8 privacy: PARTLY WITNESSED

- (a) `npm run gate:privacy` exits 0. The gate is the version at
  `origin/main` a4f1a94; the blob is `ee1cf88b2ea3b6c3993ee96a4a9841106ea8db52`
  and its last-modifying commit is `ac37a63`.
- (b) **WITNESSED IN FIX ROUND 1. THE SENTENCE THAT USED TO STAND HERE WAS
  FALSE AND IS CORRECTED IN PLACE (clause R-087, finding CR-M3P9-01).** It
  read: "NOT WITNESSED. The owner's real statements are absent from this
  container, so the probe set half (b) describes could not be built here."
  There was no captured `ls`, no captured `find` and no exit code behind that
  claim, and it is wrong: the uploads are on disk in this container. Three
  statement PDFs are there, referred to by 8-hex prefix only per fleet warning
  9. The round that recorded the sentence took the excused branch before
  trying the branch that owns the work, on the one criterion this fleet has
  already lost a round to. What the probes actually return is recorded in the
  fix-round section at the bottom of this file.
- (c) Every rendered measurement quoted in the work history comes from a
  committed synthetic fixture. The new spec drives
  `test/fixtures/belfius-account-a.csv` (the same fixture
  `test/e2e/merchants.spec.ts` drives) and `test/fixtures/unknown-layout.pdf`
  (already committed and already exercised by
  `test/application/pdf-upload.test.ts`), and adds no fixture of its own.

---

# FIX ROUND 1 (M3-P9), beacon log

Appended as the work happened, per the dispatch contract's
`incremental-output` clause. Both clean-room lanes returned
FIX-ROUND-NEEDED at 88dbaac: `delivery/review/m3-p9-hazard.yaml` on
`claude/m3-p9-rev-haz2` (HZ-M3P9-01 high, 02/03/04 medium, 05/06 low) and
`delivery/review/m3-p9-criteria.yaml` on `claude/m3-p9-rev-crit`
(CR-M3P9-01 medium, 04 medium, 02/03/05/06/07/08 low, criterion 9.8 NOT MET).

## t0 environment

```
$ df -h / | tail -1
/dev/vda        252G   32G  5.3G  86% /
$ node -v ; npm -v
v26.7.0
11.19.0
$ docker ps --format '{{.Names}}' | wc -l
11        (the local supabase stack is up)
```

## t1 CR-M3P9-01: the uploads ARE in this container

```
$ ls -la /root/.claude/uploads/e8dfc624-.../ | sed -E 's/[0-9]{4,}/NNNN/g'
-rw------- 1 root root NNNN Aug 17 07:33 0f79fa3d-NNNN.pdf
-rw------- 1 root root NNNN Aug 17 07:33 39bada64-BENNNN_NNNN_NNNN.pdf
   (plus a third statement PDF and several PNGs)
```

The reviewer is right and the previous round's sentence at what was
`m3-p9-notes.md:125` was FALSE for this container. Corrected below under
9.8; the probes are built and run in this round.
