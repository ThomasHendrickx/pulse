# M3-P3 incremental work notes (pdf-kbc)

Append-only beacon per the dispatch contract (incremental-output clause).
Newest entries last. The schema-valid work history is m3-p3.yaml, written
from these notes before handback.

## Session start (2026-08-21)

- Read, in order: the composed implementer brief (with fleet warnings),
  schemas/work-history.schema.json, gate-registry.yaml (kernel, fleet
  home), the plan phase M3-P3 in delivery/plan/pulse-v02.yaml, the intake
  addendum (pulse-v0.2-pdf-addendum.md sections 4 through 6),
  notes/export-format-facts.md (fleet home, 2026-08-21 scout section),
  the M3-P2 work history and notes, and the project skills pulse-domain
  and pulse-typescript.
- Mechanism-index lookup (mechanism-lookup clause): the kernel file
  tuition/mechanism-index.yaml is NOT present in this fleet home (find
  over /home/user/pulse-fleet found no file of that name; the repository
  delivery/tuition/ directory contains only .gitkeep). Recording the
  lookup attempt: no entry could be read, so no mechanism rules were
  inherited from it. The mechanism rules applied instead are the ones
  recorded AT THE MECHANISM DEFINITIONS in the source, per M3-P2's
  mechanism-sibling discipline: pdf-template.ts (templates parse
  reconstructed lines only, pure; balance gate lives in the shared path,
  never in a template; the registry names the KBC template as the sibling
  implementation), pdf-lines.ts (no library text assembly; lines carry
  their left edge), dedup.ts (frozen hash recipe; occurrence ordinal
  counts hash-path rows only), gates.manifest.json lookup: not present in
  the fleet home either (kernel-repo file; this phase adds no destructive
  command, so the destructive-authority clause owes nothing here).
- Worktree: /home/user/pulse-fleet/worktrees/m3-p3-pdf-kbc, branch
  claude/m3-p3-pdf-kbc at a577e51 (main, the merged M3-P2 foundation),
  clean. Disk check per fleet warning 10: df / shows 21G available,
  no cleanup needed before e2e work.
- npm ci started (background). Node in this shell: v26.7.0.
- Upload prefix mapping per fleet warning 9 (the corrected mapping):
  0f79fa3d = KBC Mastercard uitgavenstaat (THIS phase's format
  reference), 39bada64 = Belfius current account. File names are never
  written anywhere; 8-hex prefixes only.

## Format facts verified against the real KBC statement (structure only)

Scratchpad-only extraction of the 0f79fa3d upload through the repo's own
pdfjs adapter settings plus the pdf-lines reconstruction algorithm
(script in the session scratchpad; nothing copied out). Structural facts,
all matching the plan's grounding and notes/export-format-facts.md:

- 2 pages. Fingerprint lines "KBC-Mastercard" and "Uitgavenstaat" as
  separate reconstructed lines in the page-1 header block.
- Header block: holder address block; Klantenreferentie,
  Uitgavenstaatnummer, Gebruikslimiet (with SPACE thousands),
  Kaartnummer(s) with the masked card form; the period line "Overzicht
  van je verrichtingen van DD-MM-YYYY tot DD-MM-YYYY"; two column-header
  lines ("datum datum omschrijving verrichtingen bedrag in EUR" and
  "verrichting verrekening"). Page 2 repeats the period line prefixed
  "Vervolg " plus the column headers.
- "Vorig saldo op DD-MM-YYYY <signed amount>" is an INDENTED line
  (x about 204 versus row margin about 62), followed by a per-card
  sub-heading line ("Kaartnummer <masked>") and a holder-name line at
  the same indent.
- Transaction rows are ONE reconstructed line each at the row margin:
  transaction date, settlement date, description, tight-signed amount at
  line end (comma decimals; space thousands on the Afrekening line and
  the limit; row amounts in this statement are all under 1 000). Rows
  are ordered by settlement date; the DOMICILIERING VIA JE BANK credit
  row appears LAST among rows despite its early settlement date, as a
  normal two-date row with a + amount equal to the negated Vorig saldo.
- FX continuation lines at a deeper indent (x about 218): "Bedrag <n>
  <CCY>" then "Koers (1 EUR = <rate> <CCY>)". 4 FX rows, 2 continuation
  lines each. 22 transaction rows total (21 debits plus the credit),
  exactly one identical duplicate row pair (same both dates, same
  description, same amount).
- "Totaal bedrag van de kaartverrichtingen op DD-MM-YYYY" carries NO
  amount; "Afrekening via je bank op DD-MM-YYYY <amount>" carries the
  closing figure with a SPACE thousands separator.
- BALANCE IDENTITY RECOMPUTED HERE: Vorig saldo plus the sum of all 22
  rows (including the credit) equals the Afrekening amount EXACTLY in
  integer cents (equivalently: the debit-row sum equals the Afrekening
  magnitude). Matches the M0-P2 scout's record.
- Marketing/footer blocks sit between the last row of a page and the
  page end at intermediate x positions; a bottom reference line embeds
  the customer reference (a privacy probe source, never a fixture
  value). Page markers "1/2", "2/2" at the far right.
- No IBAN anywhere in the statement body; account identity is the
  masked card number only, so the template emits accountIbans [] and
  the account rides the profile binding (upload-statement.ts
  resolveAccount, confirm-import.ts profile accountId binding).

Fixture-date safety set: distinct DD-MM-YYYY strings extracted from BOTH
real statements in-memory; synthetic KBC/companion fixture dates are
chosen from 2026-05-16..2026-06-14 plus 2026-06-22, none of which occurs
in either real statement.

## Key design decisions before code

- Template file src/modules/import/domain/kbc-mastercard-template.ts,
  id "kbc-mastercard-uitgavenstaat", version 1, hasNaturalKey false
  (hash dedup path with occurrence ordinals; the format has no sequence
  numbers). Registered AFTER the Belfius template; fingerprints are
  mutually exclusive on the real files.
- Line classification is SHAPE-FIRST for this layout, deliberately
  DIFFERENT from the Belfius template's positional rule, because the
  counterparty-controlled text here is a SUBSTRING OF THE ROW LINE, not
  free-standing lines: a merchant cannot mint a whole line, so the
  Belfius fabricated-row construction has no analogue. Loud-failure
  guards kept: a line STARTING with the two-date prefix that does not
  parse as a full row is a structure error (zero rows), and a
  Bedrag/Koers continuation line with no open row is a structure error.
  Documented at the template header per the mechanism-sibling clause.
- Label regexes tolerate glued interior spacing (\s* between label
  words), per the scout's tolerance-sensitivity warning.
- Amounts: template-local space-thousands acceptance; spaces are
  stripped from the matched amount text and the FROZEN
  parseAmountToCents(_, "comma") does the digits. parse-amount.ts is
  not touched (its accepted shapes feed delimited detection).
- Settlement date maps to ParsedRow.valueDate (datum verrekening is
  value-date semantics, same slot the Belfius template uses for VAL.),
  AND stays verbatim in rawLine; bookingDate is the TRANSACTION date
  (addendum:76, PR2-004).
- FX continuation lines fold into the row's rawLine (newline-joined),
  never into description, never rows.
- Synthetic fixture family: kbc-statement-a.pdf (9 rows: 8 debits
  summing to the Afrekening magnitude incl. one space-thousands row
  amount, the identical pair, one FX USD row and one FX GBP row, the
  month-straddler transaction 31-05 settling 02-06, DOMICILIERING
  credit +1 234,56 equal to the negated Vorig saldo -1 234,56),
  kbc-nonreconciling.pdf (Afrekening rendered 1,00 off), and
  belfius-settlement-companion.pdf (Belfius layout, June, sequences
  0130-0133, carrying the MASTERCARD AFREKENING NUMMER 30456 debit of
  -1.234,56 booked 03-06). Previous balance magnitude EQUALS this
  statement's Afrekening magnitude BY CONSTRUCTION so the companion
  debit both matches the card import's settlement total (D-11 amount
  equality) and finds the DOMICILIERING mirror credit (equal magnitude,
  2 days apart, within the 4-day mirror window), making the criterion
  3.4 month view reconcile with zero unmatched legs.

## Fixtures, template, criterion 3.1 tests, captured red witnesses

Generator extended (test/fixtures/generate-pdf-fixtures.ts): KBC layout
builder mirroring the verified geometry (header block with fingerprint
lines, indented Vorig saldo with per-card sub-heading, one-line two-date
rows with the amount at line end, FX continuation lines at deeper
indent, digit-free marketing footer, Totaal bedrag line without an
amount, Afrekening line with the space-thousands closing); fixtures
kbc-statement-a.pdf (9 rows; the straddler, the identical pair, USD and
GBP FX rows, a space-thousands ROW amount, DOMICILIERING credit equal
to the negated Vorig saldo; closing COMPUTED from opening + sum),
kbc-nonreconciling.pdf (Afrekening exactly 1,00 off), and
belfius-settlement-companion.pdf (Belfius layout, statement 7, June,
sequences 0130-0133, the MASTERCARD AFREKENING NUMMER 30456 debit of
-1.234,56 booked 03-06). Pre-existing Belfius fixture bytes unchanged
(git status shows only the three new PDFs).

Template implemented (kbc-mastercard-template.ts) and registered second
in PDF_LAYOUT_TEMPLATES. Test file test/domain/kbc-pdf-template.test.ts.

RED-FIRST for the class: the full test file was run BEFORE the template
existed: "Tests 9 failed | 1 passed (10)" (every KBC parse red via
layout-unsupported; the one green was the companion fixture under the
already-shipped Belfius template). After implementation: 10 passed,
then 12 passed with the two loud-guard tests added.

Dangerous-state mutations, each applied, captured, reverted (backup
compare; git diff src/ afterwards shows only the intended registry
edit):
- W1 bookingDate := settlementDate (the PR2-004 dangerous state):
  "Tests 1 failed | 11 passed (12)", exactly the month-straddler test.
- W2 FX continuation lines DROPPED instead of folded: "Tests 1 failed |
  11 passed", the rawLine-verbatim test.
- W2b FX continuation lines leaked into DESCRIPTION (second structurally
  different member of the fold class, R-037a): "Tests 2 failed | 10
  passed" (description equality and rawLine tests).
- W3 space-thousands strip removed before the frozen comma parse:
  "Tests 8 failed | 4 passed" (balances unparseable, rows misread).
- W4 shared balance gate disabled (if (false) in
  parse-pdf-statement.ts): "Tests 1 failed | 11 passed", the
  non-reconciling KBC variant sailed through.

Real-statement verification through the FULL shipped path (scratchpad
script, abstract output only): detect selects
kbc-mastercard-uitgavenstaat v1; parse.ok true (the balance identity
held through the shared gate); 22 rows; accountIbans empty; exactly 1
positive credit row equal to the negated opening; 4 rows with folded
continuation lines, 8 continuation lines total; no natural-key
components; dedup keys all hash-path, 22 distinct, exactly one ordinal
#1 key (the real identical pair). The real Belfius statement still
detects belfius-current-account-nl v1 and parses 39 rows (registration
order unaffected).

Full fast gate after all reverts: 27 files, 292 tests, 0 skipped,
exit 0.

## Criteria 3.2 and 3.3 application tests, captured red witnesses

test/application/kbc-settlement.test.ts (real parser adapter, real
interpretation, fake persistence with the real insert semantics):
duplicate pair survives import (9 added, both TAPAUTOMAAT rows stored
under h:<digest>#0 and #1 of ONE digest) and re-import (0 added, 9
known, both still present); the non-reconciling variant FAILED
balance-mismatch with zero rows at the upload boundary; the two-import
settlement scenario (KBC card import plus Belfius companion) leaves the
MASTERCARD AFREKENING debit INTERNAL with a persisted link
(settlementImportId = the KBC import, incoming = the DOMICILIERING
mirror row) while every card line item stays SPEND; the
companion-only scenario leaves the debit SPEND with no settlement link
(the honest unitemised aggregate).

Dangerous-state mutations, applied, captured, reverted (git diff src/
clean afterwards):
- W5 occurrence ordinal dropped (ordinal always 0 in assignDedupKeys):
  "Tests 2 failed | 2 passed (4)": the duplicate-pair test reddened
  (added 8, one fact silently gone) AND the settlement test reddened
  too, because the collapsed pair changes the card import's settlement
  total and the debit no longer matches: the H3.3 loss propagates into
  H3.4, witnessed rather than argued.
- W6 settlement-match step suppressed in classify-flow: "Tests 1
  failed | 3 passed": debit fell to sign-rule SPEND while its card rows
  were imported (the exact H3.4 double count), link gone.
- W6b only the CREDIT pattern broken in constants: "Tests 1 failed | 3
  passed": the mirror leg misread (INCOME) and the link lost its
  incoming side: the second structurally different member of the H3.4
  class (R-037a).

Full fast gate after reverts: 28 files, 296 tests, 0 skipped, exit 0.

## E2e (criterion 3.4)

Local stack: the running session-local supabase docker stack
(kong 54321, db 54322). All five env values pinned in the invoking
shell per fleet warning 6 (DATABASE_URL, DIRECT_URL,
NEXT_PUBLIC_SUPABASE_URL, the publishable/anon key, the service-role
secret), never ambient (the ambient pair points at the foreign Hemma
pooler, warning 1). npm run db:reset exit 0 through the repo's db
guard (migrations plus seed; the Prisma 6.19 AI-consent guard satisfied
by quoting the dispatch instruction after verifying the target is the
session-local docker db at 127.0.0.1:54322, the M1-P1 practice).
Disk before e2e: 20G free (warning 10).

New journey in test/e2e/import.spec.ts: sign-up, upload
kbc-statement-a.pdf, ask-once declaration with NO format question
(preview shows the straddler under its transaction date 2026-05-31),
rows-added 9; upload belfius-settlement-companion.pdf, second ask-once
declaration, rows-added 4; /?month=2026-06 renders the reconciliation
panel with data-state "ok" (the settlement debit and DOMICILIERING
mirror INTERNAL and matched, nothing unmatched, difference zero).
Run: npx playwright test -g "KBC card PDF plus companion" (warning 8's
-g form): 1 passed, exit 0, first run. Red witness note: this journey
asserts through the browser the same behaviours whose reds were
captured at domain and application level (the whole-file pre-template
red plus W1..W6b); no separate browser-level dangerous state was
staged. No UI file was touched by this phase, so no new phone-viewport
surface exists; the existing 390x844 confirm-step e2e still runs in the
full suite.

## Privacy (criterion 3.5) and TWO loud corrections (R-087)

CORRECTION 1, found by this phase's own half (b) gate: the KBC template
header comment quoted the REAL statement's Afrekening amount (a
thousands-form amount, one of the five promised categories) as its
shape example. Fixed at head by replacing it with the synthetic
fixture's amount (commit "fix: replace a real-statement amount quoted
as a shape example..."). RESIDUE, STATED: the string remains in the
FILE VERSIONS of the three earlier branch commits. A history rewrite
(git filter-branch, the M3-P2 precedent) was attempted and DENIED by
this session's permission classifier, twice; per the denial contract I
stopped rather than working around it. Exposure assessment: phase
merges in this fleet are squashed (a577e51 has a single parent), so
the intermediate trees never reach main; the exposure is the remote
feature branch until its post-merge deletion. Handed to the
orchestrator as an open question: purge the branch history before or
at merge, or accept the squash-and-delete path.

CORRECTION 2, in the scrub tool itself: the first scrub run passed
probes to grep/git-grep as positional arguments, so a probe STARTING
WITH A DASH (the real statement's band lines among the whole-line
probes) was misparsed as an option, errored, and was counted as
"no hit": a silent false pass. Fixed by passing every probe behind -e
and re-running; the previously-affected probes are genuinely 0-hit.
Mechanism note for the next scrub author: a grep probe is
attacker-shaped data; always pass it behind -e.

Gate results (probe list built in memory from BOTH real PDFs, never
committed; the real PDFs ARE present in this container, so the
criterion is witnessed, not vacuous):
- Half (a), whole worktree via git grep: 38 probes (masked card number
  full/fragments/compact, customer reference, statement number bare
  and in context, bottom reference-line tokens, 29 merchant-string
  probes): 0 hits, every grep exit 1.
- Half (b), the 10 files this phase changed (git diff --name-only
  a577e51..HEAD), all five categories plus diligence extensions (KBC
  identifiers, holder name and address forms, merchant strings, ALL
  KBC row amounts, thousands-form amounts from both statements, every
  date from both statements in DD-MM-YYYY AND ISO form, FX original
  amounts and rates, Belfius IBAN forms spaced and compact, every
  digit-carrying whole line of both statements, the upload file names
  and stems): 341 probes, 0 hits, every grep exit 1.
- Independent tree scrub (plain grep -rIF over the working tree, same
  full probe set): 8 hits, ALL in files verified byte-identical to the
  phase base (git diff --quiet a577e51..HEAD per file): generic
  dot-thousands amounts and date strings in M1-era tests, fixtures and
  seed (prisma/seed.ts, test/domain/corrections.test.ts,
  test/domain/profile-detection.test.ts, test/e2e/merchants.spec.ts,
  test/property/reconciliation.test.ts, three M1-era CSV fixtures),
  plus the owner's own intake document quoting one real FX
  continuation line as a format example
  (delivery/intake/pulse-v0.2-pdf-addendum.md:79, owner-authored,
  R-007: not this phase's to edit). Baseline residues recorded, none
  introduced or touched by this phase. The bare token SUPABASE remains
  excluded as a probe per the M3-P2 record (it equals the stack name).

## Final gates at head, work history, and the coordinator checkpoint

Coordinator checkpoint acknowledged mid-round: the session was alive
(the silence was the e2e and scrub work); no salvage was needed. Checked
origin/main after the checkpoint's note about the parallel production
defect round: main is still a577e51, nothing to merge at handback time.
If the engines-pin defect round lands before this branch's review
completes, the orchestrator merge-and-regate instruction in the
checkpoint applies.

Gates at 63682d7 (src and test byte-identical to the final head, which
adds only delivery/work-history files no gate reads): npm run typecheck
exit 0; npm run lint exit 0; npm run gate:tokens exit 0; npm test exit
0 (28 files, 296 tests, 0 skipped); npm run test:e2e exit 0 (20
passed, 0 skipped, 3.0m, chromium, config-owned dev webServer,
PULSE_FIXED_NOW pinned, all five env values pinned local). Em dash
sweep over every phase-written file: exit 1 (none). Scope: git diff
--name-only a577e51..HEAD lists exactly the declared surfaces
(src/modules/import/domain/, test/fixtures/, test/domain/,
test/application/, test/e2e/import.spec.ts) plus the standing-extra
work history; no excess to declare.

Work history m3-p3.yaml written and schema-validated: npx --prefix
/home/user/pulse-fleet tiphys validate --type work-history --context
<worktree> exit 0 (first validation caught claim M3P3-Q3 carrying a
refused universal token in an open-question statement; reworded,
revalidated 0). Claim grep run exactly as the brief carries it, line
and flattened forms: remaining hits are the verbatim prompt quotation
(R-052a) and one token inside a captured executed-construction command
whose output settles it.
