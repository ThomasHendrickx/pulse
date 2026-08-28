# M3-P13 running notes (the schema-valid work history is m3-p13.yaml; this file carries the per-criterion walk and the captures)

Worktree /home/user/wt-m3p13, branch claude/m3-p13-identity-on-review, base
origin/main 975d0ce.

## Mechanism lookup (clause mechanism-lookup)

The fleet checkout has no `tuition/mechanism-index.yaml` of its own; the only
copies under /home/user/pulse-fleet are inside `node_modules/@tiphys/kernel`,
and that is the index the composed brief's mandated reading points at. It was
read.

- **Checking a generated artifact against its own generator.** APPLIES, to the
  pin between `test/e2e/identity-fixture-facts.ts` (the restatement) and
  `test/fixtures/generate-pdf-fixtures.ts` (the authority). The index's rule:
  compare by SET EQUALITY AND FIELD PRESENCE rather than by containment, and
  derive per item at run time rather than pinning a count. The first draft of
  the pin compared three named fields one by one, which is the containment
  shape that entry refuses. It now enumerates `Object.entries` of the
  restatement at run time, requires each name to exist on the generator's
  export, and compares the values, so a field added to the restatement without
  a counterpart is red rather than unexamined
  (`test/domain/identity-on-review.test.ts`, "every value the e2e module
  restates is the generator's value under the same name").
- **Every other entry in the index** (guard failure paths, append-only logs,
  claim files, leases, worktree removal, remote access, reporter parsing,
  supervising an agent, atomic replacement, shared worktrees, error
  classification, deciding another program's behaviour by pattern-matching a
  file) has no call site in this phase: the phase adds one pure display helper,
  three fields on a projection type, one column on a read, and rendering.
- **The mechanism this phase ESTABLISHES a rule for** has no entry in the
  index: REDACTING AN IDENTIFIER OUT OF TEXT THAT IS ABOUT TO BE SHOWN. Per
  clause mechanism-sibling the rule is recorded at the definition
  (`src/platform/ui/mask-account-number.ts`) and its siblings are named there:
  `src/platform/ui/mask-card-number.ts` and
  `src/modules/merchants/domain/normalise-counterparty.ts`. The rule: redact on
  the identifier's GRAMMAR, never on its shape; never let the redacted value
  reach a key, a dedup input or a stored pattern.

## Per-criterion walk

| Criterion | Status | What settles it |
|---|---|---|
| 13.1 | MET | `test/e2e/identity-on-review.spec.ts`, "criteria 13.1, 13.2, 13.3 ...": asserts by testid on the RENDERED page that the group whose data-group-key is the account identity renders `group-count` "3 rows" and `group-basis` equal to the English catalogue string for the shared-account basis, and that at least one unresolved group renders the shared-description string. Fast-gate companions in `test/domain/identity-on-review.test.ts` pin the domain half. |
| 13.2 | MET WITH A DEVIATION | The masking half, the identity-key half and the derivation half are all met and asserted. The clause "does NOT contain the unmasked account anywhere, asserted over the full page source" is NOT asserted literally, because it contradicts the same criterion's requirement that the hidden field carry the namespaced identity key, which for an account-basis group IS the namespace plus that account. See the verification-first record and the deviation in m3-p13.yaml. What is asserted: the account appears in no rendered text in either the compact or the spaced shape, and every occurrence in the page source sits in the hidden `counterpartyText` field or the row's `data-group-key`. The derivation half ("the same masking function is not called anywhere in src/modules/merchants/domain or src/modules/merchants/application") is a walk over both trees, asserted to find files at all first. |
| 13.3 | MET | Same spec: opens the disclosure, asserts three `group-row` elements, three distinct dates, three distinct descriptions, and that the three rendered amounts sum to the rendered group total in integer cents. |
| 13.4 | MET | `test/e2e/identity-on-review.spec.ts`, "criterion 13.4 ...": the three-row group's form renders the catalogue string carrying 3 and a one-row group renders the same key carrying 1, in English, then again with the locale cookie set to nl and to fr. The reach element is asserted to be INSIDE `form.merchant-name-form`. |
| 13.5 | MET | Same file, "criterion 13.5 ...": both direction totals read before and after a naming on the account-basis group and compared byte for byte, plus the naming reaching exactly the three rows it promised. The pre-existing H3.2 journey in `test/e2e/merchants.spec.ts` is unchanged and green. |
| 13.6 | MET | `npm run gate:tokens` exit 0, and the CSS this phase adds uses only tokens that already exist, so no token was added to `styles/tokens.css` and the criterion's second clause is vacuously satisfied rather than skipped. |
| 13.7 | MET | The three keys `groupBasisAccount`, `groupBasisDescriptor`, `groupReach` and `groupRowsShow` are added to all three catalogues in one commit; `test/app/catalog-parity.test.ts` is the existing copy gate and it passes. No user-facing string is hardcoded in `merchant-review.tsx`: every rendered sentence comes from `t(...)`. |
| 13.8 | MET | Gate table in m3-p13.yaml, each with its captured exit code, including `npm run test:e2e`. |
| 13.9 | MET | The new spec imports its account numbers from `test/e2e/identity-fixture-facts.ts`, whose two values are the committed fixture generator's own invented values and are already on `test/fixtures/allowed-identifiers.txt` (lines carrying BE31111122223333 and BE78222233334444, added with provenance by earlier phases). `npm run gate:privacy` exit 0. No descriptor, counterparty, place, amount or date from either real document appears in this phase's work history or in any commit message on the branch. |

## Captures

### The pre-phase label carried the account in full (hazard H13.2)

    $ npx tsx <probe calling normaliseCounterparty(counterpartyText({description})) on the committed fixture's own invented account>
    label carries the account spaced: true
    label carries the account compact: false

That is why the spec asserts the SPACED shape as well as the compact one: a
compact-only assertion passes against the unfixed screen.

### The first slow-gate run was invalidated and discarded

Run 1 was started after a hand-run `npm run build`, which writes the production
output into `.next`, the directory `next dev` uses. Three specs failed, one of
them the wrong-password sign-in line, which this phase cannot reach. After
removing `.next` and `.next-prod` and re-running, two of the three passed. Run 1
was also polluted by edits made to `test/e2e/` while it was running. Both facts
are recorded as environment warnings in m3-p13.yaml.

### The instrument the product legitimately changed under

`test/e2e/accounts.spec.ts:216` (CONTROL ARM) asserted that the group labels on
`/merchants` contain "EIGEN REKENING" and "EIGEN SPAARREKENING", which are
fragments of the uppercased NORMALISED DESCRIPTOR an account-basis group used
to be labelled by. Decision D-41 labels such a group by the counterparty NAME
the statement carries where any of its rows carries one, so the label is now
that name and nothing else. The assertion was updated to compare the label
EXACTLY, in the case the statement printed it, which is stronger than the
substring form it replaces: the old form passed on any label that happened to
contain those words inside a longer string.
