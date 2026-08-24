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

## t2 HZ-M3P9-01, the mechanism rather than the instance

**THE MECHANISM IS NOT "the spec presses with a mouse".** It is A STATE
APPEARANCE REACHABLE ONLY THROUGH AN INPUT-CONDITIONAL PSEUDO-CLASS. `:active`
is granted by the engine's own gesture pipeline, so a rule that depends on it
alone is delivered on exactly the input paths that engine chooses to grant it
on, and the phase measured the one path it is granted on in this container
while the owner uses another.

I reproduced the reviewer's negative independently and then tested the
instrument, on a page OUTSIDE the product, under a context built from
`devices["Pixel 5"]` with `isMobile`, `hasTouch` and a 390 by 844 viewport,
sampling `getComputedStyle` and `getBoundingClientRect` every animation frame.
Three elements on one page: a button with `:active` only, a button whose
`data-pressed` attribute is set by a `pointerdown` listener, and a bare `div`
whose only rule is its own `:active` declaration.

```
### held page.mouse.down 400ms on #plain
  events: ["pointerdown:plain","mousedown:plain","pointerup:HTML","click:HTML"]
  {"id":"plain","frames":28,"framesActive":22,"framesWithTransform":21,"peakBoxDisplacementPx":2}

### held CDP Input.dispatchTouchEvent touchStart 400ms on #plain
  events: ["pointerdown:plain","touchstart:plain","pointerup:plain","touchend:plain","mousedown:plain","click:plain"]
  {"id":"plain","frames":26,"framesActive":0,"framesWithTransform":4,"peakBoxDisplacementPx":0.453}

### held CDP Input.dispatchTouchEvent touchStart 400ms on #handled
  events: ["pointerdown:handled","touchstart:handled","pointerup:handled","touchend:handled","mousedown:handled","click:handled"]
  {"id":"handled","frames":27,"framesActive":0,"framesPressed":25,"framesWithTransform":24,"peakBoxDisplacementPx":2}

### Input.synthesizeTapGesture touch 400ms on #plain
  events: ["pointerdown:plain","touchstart:plain","pointerup:plain","touchend:plain"]
  {"id":"plain","frames":39,"framesActive":0,"framesWithTransform":0,"peakBoxDisplacementPx":0}

### Input.synthesizeTapGesture touch 400ms on #handled
  {"id":"handled","frames":37,"framesActive":0,"framesPressed":24,"framesWithTransform":29,"peakBoxDisplacementPx":2}

### Input.synthesizeTapGesture touch 400ms on #bare
  {"id":"bare","frames":36,"framesActive":0,"framesWithTransform":0,"peakBoxDisplacementPx":0}

### page.touchscreen.tap on #plain
  {"id":"plain","frames":8,"framesActive":0,"framesWithTransform":0,"peakBoxDisplacementPx":0}
### page.touchscreen.tap on #handled
  {"id":"handled","frames":9,"framesActive":0,"framesPressed":0,"framesWithTransform":0,"peakBoxDisplacementPx":0}
```

Four things this settles, and one it does not.

1. `:active` is granted to a held MOUSE press in this container and to no
   touch path at all, on the product's own control and on a bare element
   outside it alike. The bare element is what says this is the engine and not
   the stylesheet.
2. `pointerdown` FIRES on every touch path, on the control, every time. So an
   attribute set between `pointerdown` and `pointerup` is reachable from a
   finger where `:active` is not.
3. `page.touchscreen.tap` dispatches its down and its up inside one task, so
   NO mechanism can produce a held interval under it: zero pressed frames for
   `:active` and for `[data-pressed]` alike. It is not a usable instrument for
   a press measurement; the held CDP `touchStart` is.
4. The transform seen on `#plain` under the raw held touch, 4 frames and
   0.453px, is the tail of the PREVIOUS test's release transition unwinding,
   not a press: `framesActive` is 0 and the peak never reaches
   `--press-offset`.

WHAT IT DOES NOT SETTLE: whether a real phone grants `:active` to a tap.
No physical device and no mobile browser is reachable here (`which
google-chrome chromium firefox` finds nothing), so this is an emulation result
and says so.

### the derivation, and what it did not cover

Every site in the shipped tree where this mechanism can live:

```
$ grep -nE ':(active|hover|focus|focus-visible|focus-within|target)\b' $(git ls-files "*.css")
src/app/globals.css:192:.app-nav-link:hover {
src/app/globals.css:197:.app-nav-link:focus-visible {
src/app/globals.css:243:.app-signout:hover {
src/app/globals.css:289:.empty-state-cta:focus-visible {
src/app/globals.css:367:.import-field input:focus-visible,
src/app/globals.css:368:.import-field select:focus-visible,
src/app/globals.css:369:.import-primary:focus-visible {
src/app/globals.css:605:.merchant-name-field input:focus-visible {
src/app/globals.css:701:.month-nav:hover {
src/app/globals.css:758:.month-unresolved-pill:hover {
src/app/globals.css:1478:button:active,      (and :1479 :1480 :1481 :1482 :1483)
src/app/globals.css:1494:.auth-submit:active, (and :1495 :1496)
src/app/globals.css:1561:button:disabled:hover, (and :1562 :1563)
src/app/globals.css:1569:button:disabled:active, (and :1570 :1571)
styles/tokens.css:293:a:hover { ... }
styles/tokens.css:296:input:focus-visible, (and :297 :298)
```

Three classes, and only one of them is this defect.

- `:active`, 9 selector lines across 2 rules plus the 2 disabled overrides.
  This is the class. Every one of them now carries a `[data-pressed]` twin.
- `:hover`, 5 rules. A phone grants no hover at all, which is a known and
  accepted property rather than a regression: it is in this phase's own
  grounding, and it is why criterion 9.2 uses the hovering state as the
  BASELINE. A hover cue a touch device does not show costs that device nothing
  it had. I did not measure hover under touch in this round and claim no
  measurement for it.
- `:focus-visible`, 6 rules. Granted on a touch device too, by the tap itself
  and by the keyboard. Different mechanism, not probed further here.

WHAT THE DERIVATION DID NOT COVER, stated because a search with the wrong
scope returns an empty result that looks like an absence of defects:

1. It covers the four tracked stylesheets only, which is
   `git ls-files "*.css"` and is exactly four files (criterion 9.6 pins that).
   It does NOT cover a pseudo-class written into component markup as a
   Tailwind variant or an inline style. Checked and empty:
   `grep -rnE 'hover:|active:|focus:|disabled:|style=\{\{' src/ --include=*.tsx`
   returns nothing.
2. It does not cover `delivery/design/` or `design/reference/`, which are
   mockups and are not served to anyone.
3. It says nothing about a rule a LATER phase writes. The guard against that
   is the spec, not the grep.
4. It says nothing about iOS. `:active` on iOS Safari is understood to require
   a touch listener on the element or an ancestor, and no iOS engine is
   reachable from this container, so that is reasoning and not a measurement.

## t3 the red witnesses, taken before the stylesheet was touched

Spec first, per clause R-037a, committed at `2e4f3b6` and run against the
stylesheet as it stood at `88dbaac`.

**HZ-M3P9-01, red.** `npx playwright test --project=chromium-phone -g "a held
touch press moves the control"`, exit code 1:

```
touch press, :active only, button.auth-submit: frames 27, in :active 0, carrying [data-pressed] 0, with a transform 0, peak box displacement 0.000px, events ["pointerdown","touchstart","pointerup","touchend","mousedown","click"]
touch press, :active only, p.auth-alt a: frames 28, in :active 0, carrying [data-pressed] 0, with a transform 0, peak box displacement 0.000px, events ["pointerdown","touchstart","pointerup","touchend","mousedown","click"]
touch press, [data-pressed], button.auth-submit: frames 27, in :active 0, carrying [data-pressed] 26, with a transform 0, peak box displacement 0.000px, events [...]
  Error: button.auth-submit never carried a transform under a held touch press
  Expected: > 0
  Received:   0
```

The third line is the one that matters: with the handler installed the
attribute was carried for 26 of 27 frames and the control still did not move,
because the stylesheet had no rule for it. That separates "the attribute is
set" from "the stylesheet responds", and it is the second half that this round
adds.

**HZ-M3P9-02, red.** `npx playwright test --project=chromium -g "a marked link
does not navigate"`, exit code 1:

```
  Error: a link wearing the full disabled appearance still navigated
  Expected: "/sign-in"
  Received: "/sign-up"
```

A first version of this test passed the negative assertion and failed its own
positive control, because the dev server compiles a route on first request and
the navigation had not landed inside the 500ms wait. A vacuous green on the
exact assertion the test exists for. The positive control is what caught it;
the test now warms the destination route first and waits 2500ms.

## t4 what changed in the stylesheet

- The pressed rules gain `[data-pressed]` beside `:active`, and the three
  inverse-surface controls gain `.class[data-pressed]` so specificity still
  puts them above the general rule. The two disabled overrides gain the same
  twin, so a disabled control refuses both routes.
- `[aria-disabled="true"]` gains `pointer-events: none`, in a rule of its own,
  deliberately not applied to `button:disabled` or `input:disabled`.
- `select` and `textarea` join the transition list and the disabled list.
- Three comments corrected in place rather than deleted (clause R-087).

## t5 the green witnesses, through a touch path on `chromium-phone`

`npx playwright test --project=chromium-phone -g "a held touch press moves the
control"`, exit code 0:

```
touch press, :active only, button.auth-submit: frames 28, in :active 0, carrying [data-pressed] 0, with a transform 0, peak box displacement 0.000px
touch press, :active only, p.auth-alt a: frames 29, in :active 0, carrying [data-pressed] 0, with a transform 0, peak box displacement 0.000px
touch press, [data-pressed], button.auth-submit: frames 29, in :active 0, carrying [data-pressed] 28, with a transform 27, peak box displacement 2.000px
press to first visible change under touch on button.auth-submit: 29.2ms
touch press, [data-pressed], p.auth-alt a: frames 28, in :active 0, carrying [data-pressed] 26, with a transform 25, peak box displacement 2.000px
press to first visible change under touch on p.auth-alt a: 31.4ms
  1 passed
```

Both shapes: the opaque submit on the inverse surface, and a bare anchor with
no background of its own, which is also the control the `a { display:
inline-block }` rule exists for. Peak box displacement 2.000px on both, equal
to `--press-offset`, measured as a real change in
`getBoundingClientRect().top` rather than as a matrix.

PRESS TO FIRST VISIBLE CHANGE, UNDER TOUCH: 29.2ms and 31.4ms, from the
`pointerdown` handler's `performance.now()` to the first `requestAnimationFrame`
callback whose computed transform is not the identity. That is roughly two
animation frames at 60Hz. It is NOT comparable with the 9.5ms the previous
round quotes for a mouse press: that number was taken with a different
instrument, and this one includes the frame the sampler itself waits for. The
honest statement is "within two frames", not a comparison of the two figures.

**HZ-M3P9-02, green.** `npx playwright test -g "a marked link does not
navigate"`, exit code 0, both projects, 2 passed.

## t6 the coverage findings, reddened by mutation

HZ-M3P9-03, HZ-M3P9-04 and CR-M3P9-02 are findings about assertions that could
not fail, so the only honest witness is to break the thing they claim to guard
and watch the new assertion catch it. Each mutation was applied, run, and the
file restored with `git show HEAD:<path> > <path>`; `git status --porcelain`
was empty after each.

**HZ-M3P9-03.** Deleted `--duration-busy-cycle: 0s;` from the
`prefers-reduced-motion` block in `styles/tokens.css`, which leaves the busy
mark looping under reduce.

```
  Error: the busy mark still animates under reduce on button.auth-submit|Sign in (http://127.0.0.1:3000/sign-in) (name pulse-busy-cycle, duration 0.9s)
  Expected: false
  Received: true
  1 failed
```

The run reached my new assertion, which means the OLD control-level assertion
at the top of the same loop passed while the mark was spinning. That is the
proof the old check was vacuous, and it is a measurement rather than a reading
of the code.

**HZ-M3P9-04.** Deleted the two `.pulse-busy` selectors from
`src/app/globals.css`.

```
  Error: class-busy button.auth-submit|Sign in (http://127.0.0.1:3000/sign-in): background 1.000, colour 1.000, border 1.000, opacity delta 0.000
  1 failed
```

**HZ-M3P9-02, the in-journey half.** Replaced `pointer-events: none` with an
inert declaration in the `[aria-disabled="true"]` rule.

```
  Error: an aria-disabled control still accepts pointer input: button.auth-submit|Sign in (http://127.0.0.1:3000/sign-in)
  Expected: "none"
  Received: "auto"
  1 failed
```

**CR-M3P9-02, and a limit of the criterion's own wording.** The first mutation
set the unconfirmed mark's `width` to 0 and the spec stayed GREEN. Measured
why, on a page with nothing else on it:

```
$ node width-probe.cjs
{"zeroWidth":"2px","zeroContent":"\"\"","eightWidth":"8px"}
```

Tailwind's preflight sets `box-sizing: border-box` on `::after`, so a
pseudo-element with `width: 0` and a one-pixel border computes a width of 2px,
not 0. Criterion 9.3's "non-zero computed width" is therefore satisfied by the
border alone on any bordered mark. The assertion is still worth having and is
the one the finding asked for, but what it binds against is `width: 0` TOGETHER
WITH `border: none`, or `display: none`, and not `width: 0` by itself. Stated
here rather than left for the next reader to rediscover. With both zeroed:

```
  Error: unconfirmed mark has zero width
  Expected: > 0
  Received:   0
  1 failed
```

## t7 criterion 9.8(b), the probes the previous round said could not be built

All five probe families were built in this container at fix-round time from
the three statement PDFs under the uploads directory, referred to by 8-hex
prefix only and kept outside the repository in the scratchpad. Not committed,
checked rather than asserted: `git ls-files | grep -c
"privacy-probes\|touch-probe\|width-probe\|click-probe"` returns 0 and
`git status --porcelain | grep -c probe` returns 0. Text extracted with
`pypdf`. The build script prints families, counts, file lists and exit codes;
no probe string appears in the captured output below, and an attempt to print
one for classification was refused by this container's tool policy.

```
uploads read, by 8-hex prefix only: ['0f79fa3d', '39bada64', '84742d93']
family              probes   tree hits  touched hits  message hits
identifier              25           0             0             0
holder-name              2           0             0             0
merchant-string        143           5             0             0
thousands-amount         3           1             0             0
date                   112          13             0             0
TOTAL HITS: 19
```

**The half that binds this phase is GREEN.** Over the six files this phase
adds or modifies, and over every commit message on `a4f1a94..HEAD`, all five
families return zero hits. `styles/tokens.css`, `src/app/globals.css`,
`playwright.config.ts`, `test/e2e/pressed-and-disabled.spec.ts` and both
work-history files are clean against 285 probes.

**The whole-worktree half does NOT exit 1, and that is handed on rather than
smoothed over.** 19 probe-and-file pairs match somewhere in the tracked tree.
Every one of them is in a file this phase does not touch and every one
predates the base `a4f1a94`. What they are, judged by WHERE they matched
rather than by reading them, because printing a probe's content in this
container was refused by the tool policy and I did not work around that:

- The 5 merchant-string hits land in
  `src/modules/import/domain/kbc-mastercard-template.ts`,
  `src/modules/ledger/domain/constants.ts`,
  `test/fixtures/generate-pdf-fixtures.ts`, the committed synthetic Belfius
  and KBC fixture PDFs and the template-structure tests. That is the parser's
  own layout vocabulary: the printed labels a Belgian statement carries, which
  the templates must match and the fixture generator must reproduce for the
  parser to be testable. None of them lands in
  `src/modules/merchants/`, in `messages/`, or in any rendered string.
- The 1 thousands-amount hit and the 13 date hits land in committed CSV and
  PDF fixtures, two domain tests, `prisma/seed.ts` and
  `design/reference/pulse-prototype.html`. An amount of that shape and a
  calendar date are the two probe kinds that collide with invented values by
  construction.

I could not classify them beyond that, and I say so rather than calling them
clean: fleet warning 12 records that exactly this shape reached this public
repository once and that no gate can see it. **OPEN QUESTION FOR THE
ORCHESTRATOR:** someone with permission to read the probe strings should
classify those 19 pairs. They are not this phase's to fix, and this phase
introduces none of them.

Two earlier probe builds were wrong and are recorded because the second wrong
one was silently wrong. The first tokenised the statements word by word, which
made "September" and "transaction" probes and returned 115 hits that are
ordinary vocabulary. The second joined multi-word runs with `\s+`, which spans
a NEWLINE, and `grep -F` splits a pattern containing a newline into several
patterns, one of which was empty, and an empty pattern matches every file: a
77-character probe appeared to match `.gitignore`. Probes are now built with
`[ \t]+` and any probe containing a newline is discarded.

## t8 the gates

Run at the final tree of this fix round, in `/home/user/wt-m3p9`, Node v26.7.0,
npm 11.19.0, with the five local values pinned per fleet warning 6 by
`set -a; . ./.env; set +a` before the invocation so the ambient foreign
`DATABASE_URL` and `SUPABASE_*` cannot reach the Playwright web server.

| Gate | Exit | Summary line |
|---|---|---|
| `npm run typecheck` | 0 | `> tsc --noEmit`, no output |
| `npm run lint` | 0 | `> eslint .`, no output |
| `npm test` | 0 | see below |
| `npm run gate:privacy` | 0 | `gate:privacy clean` |
| `npm run gate:tokens` | 0 | no output |
| `npm run test:e2e` | see below | see below |

THE E2E SUITE, RUN TWICE, BOTH QUOTED. The reviewer recorded two pre-existing
specs failing on one full run and passing on retry, so both runs are reported
here whatever they show.

- RUN 1, against the tree carrying every behaviour change of this round:
  `60 passed (18.6m)`, `1 skipped`, `E2E_EXIT=0`. The one skipped test is the
  new touch measurement under the `chromium` project, which skips itself where
  `hasTouch` is not set; it runs and passes under `chromium-phone`. The suite
  is 61 tests now rather than 57: the touch measurement and the aria-disabled
  refusal each appear under both projects.
- RUN 2, at the committed head `1db37b3`: `4 failed`, `1 skipped`,
  `56 passed (20.6m)`, `E2E2_EXIT=1`. **This is reported before the green one
  and not instead of it.** All four are PRE-EXISTING specs, all four under the
  `chromium` project, all four inside the first twelve tests of the run, and
  none of them is the new spec:
  `test/e2e/auth.spec.ts:11` ("element(s) not found" on
  `getByTestId('household-context')`, the first test of the run, which is the
  same test and the same signature the clean-room reviewer recorded at
  `88dbaac`); `test/e2e/golden-journey.spec.ts:79` (30s test timeout with
  "Protocol error (Runtime.callFunctionOn): Internal server error, session
  closed", which is the CR-903 renderer-crash signature the Playwright config's
  own comment documents and attributes to disk pressure);
  `test/e2e/import.spec.ts:170` ("element(s) not found" on
  `getByTestId('import-result')`); and `test/e2e/month-view.spec.ts:120` (30s
  test timeout).
- THE ISOLATED RETRY at the same head, `npx playwright test --project=chromium
  test/e2e/auth.spec.ts test/e2e/golden-journey.spec.ts test/e2e/import.spec.ts
  test/e2e/month-view.spec.ts`: `22 passed (6.6m)`, exit 0. All four failing
  tests pass in isolation.
- RUN 3, at the same committed head `1db37b3` with `test-results` cleared and
  6.4G free: `2 failed`, `1 skipped`, `58 passed (20.7m)`, `E2E3_EXIT=1`. Both
  are pre-existing specs under `chromium`, both are timeouts waiting for a
  server action rather than an assertion about a value:
  `test/e2e/import.spec.ts:170` (5s timeout on `getByTestId('import-result')`,
  this time at line 224 where run 2 failed at line 205, so it is not one fixed
  assertion) and `test/e2e/merchants.spec.ts:18` (30s test timeout).
- THE ISOLATED RETRY of those two files at the same head: `6 passed (2.4m)`,
  exit 0, including `import.spec.ts:170` itself.

**THE E2E GATE IS NOT REPRODUCIBLY GREEN IN THIS CONTAINER AND I DID NOT
ROOT-CAUSE IT.** Three full runs at essentially one tree: green, then four red,
then two red. Every red test is a pre-existing spec, every one of them passes
on an isolated retry at the same head, and the new spec passed all four of its
runs in all three. That is the same pattern the clean-room reviewer recorded at
`88dbaac` before this round existed. What I can add to it, as facts rather than
as a verdict:

- Nothing in the product enters any state this round adds.
  `grep -rn "aria-disabled\|aria-busy\|data-unconfirmed\|data-pressed\|pulse-busy\|disabled="`
  over `src/` restricted to `*.tsx` and `*.ts` exits 1, so the `pointer-events`
  rule and the `[data-pressed]` rules are inert in the running application.
- The full-run duration grew 18.6m, 20.6m, 20.7m across the three, and the
  local Postgres accumulates households and imported rows across every run.
  `npm run db:reset` was NOT run: Prisma's agent consent guard refuses it, and
  the stack is shared with other worktrees in this container, so resetting it
  would reach outside this phase.
- Two of run 2's four carried the "Protocol error (Runtime.callFunctionOn):
  Internal server error, session closed" and 30s-timeout signatures the
  Playwright config's own comment documents as CR-903 and attributes to disk
  pressure. Free space was 4.8G, 6.4G and 6.5G across the three runs.

I am not asserting that this round did not cause it. What I am asserting is
what I measured: the new spec is green in every run and in every project, the
red tests are pre-existing and green in isolation, and the same shape predates
this round.

WHAT I CAN AND CANNOT SAY ABOUT RUN 2. The gate is not reproducibly green in
this container: run 1 green, run 2 red on four pre-existing specs, the four
green on retry. I did not root-cause it and I am not claiming the phase did
not cause it on the strength of "they are pre-existing specs" alone. What
points away from this round: the four are the first, fourth, seventh and
twelfth tests of the run and the new spec is the thirty-second, so nothing it
does can precede them; two of the four carry the renderer-crash signature the
config already documents; and run 1, on a tree carrying every behaviour change
of this round, was green over the same 61 tests. What points at this round,
and is stated rather than buried: the new spec is the slowest single spec in
the suite and lengthens the window a documented flake can land in, and the
suite grew from 57 tests to 61 without a `db:reset` between runs, which
Prisma's agent guard refuses here. Disk was 4.8G free at the start of run 2 and
6.4G at the start of run 3.

## t9 one line per finding

| Finding | What changed |
|---|---|
| HZ-M3P9-01 (high) | The pressed rules gained `[data-pressed]` beside `:active`, with twins on the three inverse-surface controls and on both disabled overrides. A new spec drives a held CDP touch press on `chromium-phone` and samples every animation frame: red before (0 frames with a transform, 0.000px) and green after (27 and 25 frames, 2.000px) on an opaque submit and on a bare anchor. The handler that sets the attribute is NOT shipped: I found no host for it inside the six paths criterion 9.7 prints. It is written out verbatim in the spec, and the gap is escalated rather than closed. |
| HZ-M3P9-02 (medium) | `[aria-disabled="true"]` gained `pointer-events: none` in a rule of its own. A new test drives a real pointer activation and asserts both directions; the in-journey loop now asserts the computed `pointer-events` on all nineteen controls whatever their tag, which is how the disclosure summary is reached without driving the whole import journey a second time. |
| HZ-M3P9-03 (medium) | The Snapshot now reads `animationName` and `animationDuration` from `getComputedStyle(node, "::after")`, and the busy block enumerates `getAnimations({subtree: true})`. Both redden on deleting `--duration-busy-cycle` from the reduced-motion block; the old control-level check passed on that same mutation, which is the measurement that shows it was vacuous. |
| HZ-M3P9-04 (medium) | `.pulse-busy` is now applied to every one of the nineteen controls and put through the same magnitude and mark assertions as the attribute branch. The comment above the rule is corrected in place: the attribute branch covers buttons, links and the summary alike, and the class is a second equivalent route rather than the link-shaped controls' own. |
| HZ-M3P9-05 (low) | The file header no longer claims no length literal below it. The five literals are named where the claim was, with why they are outside criterion 9.5 and CLAUDE.md non-negotiable 4, and CR-M3P9-08 is pointed at as M3-P10's. |
| HZ-M3P9-06 (low) | Eight em dashes replaced with colons in the notes headings. A grep for the character returns 0 over all six touched paths and over every commit message on the branch. |
| CR-M3P9-01 (medium) | The false "absent from this container" sentence is corrected in place. All five probe families built here; zero hits over the six touched files and over every commit message; 19 pairs over the whole tracked tree, all pre-existing, handed on as an open question because I could not read the probe strings to classify them. |
| CR-M3P9-02 (low) | The unconfirmed mark's width is asserted. Reddened by zeroing width AND border, and the reason width alone is not enough is measured and recorded. |
| CR-M3P9-03 (low) | The count is corrected to two in the CSS comment and in the deviation entry, naming the import-screen flex context as the reason the other two did not need the rule. |
| CR-M3P9-04 (medium) | Same as HZ-M3P9-01. The touch question is now measured rather than carried as an aside. |
| CR-M3P9-05 (low) | Five paths corrected to six in both places. |
| CR-M3P9-06 (low) | The two chevron characters restored in the captured output block. |
| CR-M3P9-07 (low) | `select` and `textarea` join the transition list and the disabled list, and deliberately not the pressed list. |
| CR-M3P9-08 (low) | Not taken inside this phase, which is what the finding itself asks: the plan fixes the token count at nine. Recorded in the corrected file header as M3-P10's. |

## t10 what is NOT closed

1. **No shipped code sets `[data-pressed]`.** The stylesheet answers a
   pointerdown; nothing raises one. Six lines in a client listener would do
   it, and criterion 9.7 prints no file that could host them. The plan holder
   decides: amend `files-to-touch` on the base branch so a follow-up round
   lands them, or leave them to M3-P10, which opens the client boundary. Until
   then a finger reaches the pressed appearance only where the engine grants
   `:active` to a touch.
2. **No real phone was pressed.** Every phone result here is Chromium
   emulation. `which google-chrome chromium firefox` finds nothing.
3. **The whole-worktree half of 9.8(b) is not clean**, at 19 pre-existing
   pairs this phase does not touch and could not classify.
4. **A busy control still accepts a pointer activation.** Named at the
   mechanism's definition in the stylesheet and handed to M3-P10.
