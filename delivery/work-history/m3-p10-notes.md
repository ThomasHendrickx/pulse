# M3-P10 running notes (beacon)

Branch: claude/m3-p10-busy-state, worktree /home/user/wt-m3p10, base 8d99dfd.

## Opening survey (before any edit)

Head is 8d99dfd, which carries M3-P14 (the accounts screen). The plan section
for M3-P10 was written against 89ed187, before M3-P14 merged, so three counts
in it are stale at this head. Recorded here as they are found.

## Criterion 10.11 red witness (captured)

Widened glob committed. With a bare JSX text node temporarily added to
src/platform/ui/submit-button.tsx:

    $ npm run lint
    /home/user/wt-m3p10/src/platform/ui/submit-button.tsx
      89:17  error  Missing JSX expression container around literal string: "RED WITNESS"  react/jsx-no-literals
    1 problem (1 error, 0 warnings)
    exit 1

With the temporary edit reverted (not committed, `git diff --stat` on that
path prints nothing): `npm run lint` exit 0.

## The control set at this branch head, against the plan's seven

The plan section was written at 89ed187. M3-P14 merged after it and shipped a
new accounts screen with its own controls, and a fourth navigation link, and a
second empty-state call to action. Enumerated at 8d99dfd with
`grep -rn 'type="submit"\|<button' src/ --include=*.tsx` and
`grep -rn "<Link" src/ --include=*.tsx`:

SUBMIT CONTROLS, NINE, not seven.
1. src/modules/import/ui/upload-form.tsx (upload)            [plan]
2. src/modules/import/ui/profile-confirmation.tsx (preview)  [plan]
3. src/modules/import/ui/profile-confirmation.tsx (confirm)  [plan]
4. src/modules/merchants/ui/merchant-review.tsx (naming)     [plan]
5. src/app/(auth)/sign-in/page.tsx                           [plan]
6. src/app/(auth)/sign-up/page.tsx                           [plan]
7. src/app/(app)/layout.tsx (sign out)                       [plan]
8. src/modules/accounts/ui/accounts-screen.tsx (ring switch) [M3-P14, NEW]
9. src/modules/accounts/ui/account-setup-form.tsx (register) [M3-P14, NEW]

1 through 8 render through the shared leaf. 9 does not, and the reason is
mechanical rather than a preference: that form submits through an onSubmit
handler and a transition, not through `<form action=...>`, so useFormStatus
reports nothing for it. It carries the same vocabulary from the transition's
own pending flag.

NAVIGATING CONTROLS, NINE, not seven: the four shell links (nav-accounts is
M3-P14's), the two month step controls, the unresolved pill, and the two
empty-state calls to action (empty-state-accounts-link is M3-P14's). Four more
Links exist outside the plan's set and are covered too: the two
back-to-import links on the import result, and the two alternate-auth links.

## Criterion 10.2, first full measurement (dev server, chromium project)

`npx playwright test --project=chromium -g "every submit control acknowledges"`
against `npm run dev` at 127.0.0.1:3000, PLAYWRIGHT_BASE_URL set so the config
starts no server of its own. Captured, per control:

    sign-up submit            intervalMs 7.2  attributes:disabled  requests 1  releaseGap 2048ms
    register accounts submit  intervalMs 9.3  attributes:disabled  requests 1  releaseGap 2058ms
    ring switch submit        intervalMs 4.6  attributes:disabled  requests 1  releaseGap 2033ms
    upload submit             intervalMs 7.8  attributes:disabled  requests 1  releaseGap 2038ms
    preview-again submit      intervalMs null kind none            requests 0  releaseGap 0
    confirm submit            intervalMs 5.2  attributes:disabled  requests 1  releaseGap 2052ms
    merchant naming submit    intervalMs 7.9  attributes:disabled  requests 1  releaseGap 2055ms
    sign-out submit           intervalMs 4.0  attributes:disabled  requests 1  releaseGap 2041ms
    sign-in submit            intervalMs 7.4  attributes:disabled  requests 1  releaseGap 2030ms

Every one of them: appearanceChanged true, busyAtSettle true at 1000ms,
pressableAtSettle false, markAtSettle `""` (the pseudo-element is drawn),
testidsStable true.

THE ONE THAT DID NOT MEASURE, AND WHY IT IS A PRODUCT FACT RATHER THAN A BUG
IN THE LEAF. The preview-again control recorded `requests: 0`: nothing was
submitted at all. It shares a form with a REQUIRED text field (the format
name), and the browser refuses a submission whose required field is empty, so
no request leaves and no busy state appears. That is correct. The spec now
fills the format name before it measures that control, and the reason is
written at the line.

## Criterion 10.2, second run (dev, chromium), all nine controls

    sign-up submit            4.9   preview-again submit   4.4
    register accounts submit  9.2   confirm submit         3.8
    ring switch submit        4.7   merchant naming submit 6.0
    upload submit             5.1   sign-out submit        4.6
                                    sign-in submit         7.6

Every control: kind attributes:disabled, appearanceChanged true, requests 1,
releaseGap ~2.04s, busy at 1000ms, mark drawn, testids stable.

## Criterion 10.2, the merchant naming median over five different rows (dev)

    naming intervals [7.8, 4.2, 4.3, 3.6, 4.3] median 4.3ms

Five DIFFERENT unresolved rows, each named successfully: the spec asserts the
unresolved count is 5-index before each press and 4-index after it, so a
naming that failed or a control pressed five times would fail the test.

## Criterion 10.5, the navigating controls, development run (chromium project)

    navigation branches [
      {"name":"empty-state-accounts-link","branch":"marker"},
      {"name":"empty-state-import-link","branch":"marker"},
      {"name":"nav-merchants","branch":"marker"},
      {"name":"nav-accounts","branch":"marker"},
      {"name":"nav-import","branch":"marker"},
      {"name":"nav-overview","branch":"marker"},
      {"name":"unresolved-pill","branch":"marker"},
      {"name":"month-step-previous","branch":"marker"},
      {"name":"month-step-next","branch":"marker"}]

All nine take the MARKER branch against the development server, where
viewport prefetching is off. `3 passed (2.0m)`, exit 0.

## Verification question (b): what useFormStatus reports for the two-control form

A real press on the profile confirmation form, with a temporary console probe
in the leaf reading useFormStatus out of BOTH controls at once (the probe is
not committed):

    PRESSED: preview-again
    [probe] {"pending":true,"method":"get","actionType":"function","identicalToProp":true,"hasFormActionProp":true,"dataKeys":["importId","profileName","spec"]}
    [probe] {"pending":true,"method":"get","actionType":"function","identicalToProp":false,"hasFormActionProp":false,"dataKeys":["importId","profileName","spec"]}

So the pending state CAN be attributed, in one direction only: a control that
overrides its form's action recognises its own submission by comparing
status.action with the action it was handed (true above), and a control that
does not override has no action of its own to compare with (false above).
The phase takes the form-wide answer, which criterion 10.3 explicitly allows,
and the reason is written at the leaf.

## Criterion 10.2(e): THE CONTROL RUN

The same measurement, with this phase's leaf REPLACED by the plain
server-rendered button it replaces, on two structurally different controls
(one form with a single control and a file input; one form rendered once per
row), against the same delayed server. Not committed; the tree was restored
and typecheck and lint re-run clean afterwards.

    CONTROL RUN A (upload submit, plain server-rendered button):
      {"clickAt":847.6,"firstAt":null,"kind":null,"discarded":4} requests 1
    CONTROL RUN B (merchant naming submit, plain server-rendered button):
      {"clickAt":1156.4,"firstAt":null,"kind":null,"discarded":4} requests 1

NO surviving record within 2000 milliseconds of the click on either, while
the route handler still counted the request: the press really did submit and
the screen really did nothing. That is the owner's complaint reproduced, and
it is what makes the 4 to 9 millisecond figures above mean something. The
`discarded: 4` is the filter doing work: records DID arrive inside the form,
and every one of them was outside the pressed control's subtree, which is
exactly the mutation the first version of criterion 10.2 would have accepted.

## Static criterion checks at the final tree

    $ grep -rn "useOptimistic" src/            -> no output, exit 1   (10.6d)
    $ grep -rln '^"use client"' src/
      src/modules/accounts/ui/account-setup-form.tsx   (M3-P14, pre-existing)
      src/platform/ui/submit-button.tsx                (new)
      src/platform/ui/link-pending.tsx                 (new)
      src/platform/ui/nav-link.tsx                     (pre-existing)
    $ find src/app -name "loading.*" | wc -l   -> 0                   (10.1d)
    $ git diff --name-only 8d99dfd..HEAD -- styles/ src/app/globals.css \
        messages/ prisma/ test/fixtures/ 'src/modules/*/application/' \
        'src/modules/*/domain/' 'src/modules/*/adapters/' \
        src/platform/ui/amount.tsx src/platform/ui/mask-card-number.ts \
        package.json package-lock.json
      -> prints nothing                                               (10.7)
    $ grep -c '<identifier|card|thousands-amount|date shapes>' over every
      added line of the phase diff -> 0 hits over 1296 lines, exit 1   (10.9b, weaker)

## THE PRODUCTION-BUILD PHONE MEASUREMENT, which is the one the phase exists for

chromium-phone-prod, 390 by 844, against `npm run build && npx next start`,
each control's server action held 2000ms by the route handler:

    sign-up submit             2.30 - 4.80 ms   (see the table below)
    register accounts submit   3.10 ms
    ring switch submit         2.30 ms
    upload submit              3.60 ms
    preview-again submit       3.10 ms
    confirm submit             3.20 ms
    merchant naming submit     2.30 ms
    sign-out submit            2.40 ms
    sign-in submit             2.60 ms
    sign-up submit             4.80 ms

Every one: kind attributes:disabled ON THE PRESSED CONTROL, appearanceChanged
true inside the observer callback that stopped the clock, requests 1 after two
presses 100ms apart, response released 2027 to 2055 ms after the click, busy
at 1000ms, not pressable at 1000ms, busy mark drawn, and every data-testid and
its text identical before the press and one second into it.

    naming intervals [2.4, 2.2, 2.1, 2.3, 2.1] median 2.2ms  (five DIFFERENT rows)

    navigation branches, chromium-phone-prod (prefetching ON):
      all nine take the MARKER branch.
    navigation branches, chromium-phone (development, prefetching OFF):
      all nine take the MARKER branch.

The two runs agree, which is what criterion 10.5(c) asks to be compared: no
control takes the marker branch in development and neither branch in
production.

The owner measured the dead gap at 500ms to 1s. It is now 2 to 5 milliseconds
on the build they press.

## The four failures of the first full run, and what they were

    ✘ 55, 56 [chromium] and ✘ 86, 87 [chromium-phone]
      test/e2e/pressed-and-disabled.spec.ts, both describes
      Error: the swept control set is not the enumeration
        - "a.month-nav|‹"                       + "a[data-testid=month-step-next]"
        - "a.month-nav|›"                       + "a[data-testid=month-step-previous]"

Exactly two identities, no addition and no removal, still twenty-one controls.
M3-P9's sweep identifies a control by its testid or, where it has none, by its
selector and text; the two month step controls had none and were identified by
their glyph child. Criterion 10.5(a) forbids a spec binding to that glyph and
explicitly permits this phase to give those two controls testids. The
enumeration was amended and the sweep left alone, which is what criterion
9.2(a) requires when the two disagree.

## clause claim-grep, run against the final work history, and every hit settled

    $ grep -nEi 'cannot be|impossible|needs a|is covered|catches|would catch|recovers|anyway|always|never|no way to' delivery/work-history/m3-p10.yaml
    6:  branched from main at 8d99dfd). Never touch /home/user/pulse or any other
    586:          The walk had never opened the one multi-line import in
    686:      backgrounded command they were chained with never started.
    703:      press that never submitted and reads it as a missing feature. Fill the

Re-run over the whitespace-flattened text, because prose wraps and a phrase can
straddle a line break, adds one further hit: "is covered by the busy state" in
claim M3P10-C1.

Settlements, one per hit:
- line 6 is inside the PROMPT, recorded verbatim under R-052a. It is the
  dispatcher's sentence, not a claim of mine.
- "is covered by the busy state" is claim M3P10-C1, whose settled-by carries
  the command and the captured suite output beside it.
- "the walk had never opened the one multi-line import" is claim M3P10-C5,
  whose settled-by carries the exact vitest failure that established it.
- "the backgrounded command they were chained with never started" and
  "a press that never submitted" are environment warnings, each with its
  `evidence` field carrying the captured observation beside it.

