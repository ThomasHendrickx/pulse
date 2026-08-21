# M3-P2 incremental work notes (pdf-belfius)

Append-only beacon per the dispatch contract (incremental-output clause).
Newest entries last. The schema-valid work history is m3-p2.yaml, written
from these notes before handback.

## Session start (2026-08-21)

- Read, in order: the composed implementer brief (with fleet warnings),
  work-history.schema.json, gate-registry.yaml (kernel), the plan phase
  M3-P2 in delivery/plan/pulse-v02.yaml, the intake addendum
  (pulse-v0.2-pdf-addendum.md), notes/export-format-facts.md (fleet home),
  DR-0020, and the three project skills (pulse-domain, pulse-typescript,
  pulse-frontend). Mechanism-index lookup: the kernel file
  tuition/mechanism-index.yaml is NOT present in this fleet home
  (/home/user/pulse-fleet/tuition does not exist; ls exit 2). Recording
  the lookup attempt per the mechanism-lookup clause: no entry could be
  read, so no mechanism rules were inherited from it; the rules applied
  instead come from the plan, the skills and the M1 work histories.
- Worktree: /home/user/pulse-fleet/worktrees/m3-p2-pdf-belfius, branch
  claude/m3-p2-pdf-belfius at 7796fc9 (main), clean.
- npm ci: exit 0. npm install pdfjs-dist: exit 0, resolved ^6.2.108
  (DR-0020: pdfjs-dist, server side only, behind the parser adapter).

## Deviation found at session start: the uploads file mapping is swapped

The dispatch says 0f79fa3d-* is the Belfius current-account statement and
39bada64-* the KBC card. Extraction (scratchpad only) shows the OPPOSITE:
0f79fa3d-* is the KBC-Mastercard Uitgavenstaat
(2 pages, "KBC-Mastercard" + "Uitgavenstaat" fingerprint), and
the 39bada64-* upload is the Belfius current-account
rekeninguittreksel (5 pages, "Belfius Bank NV" header on every page,
SALDO OP lines, BLZ.-numbered pages, BIJLAGE annex last page). The
39bada64 file matches every structural fact the scout recorded for the
Belfius statement (39 transaction starts, 4 band lines on pages 1-4 plus
one on page 5, 2 SALDO OP lines). Proceeding with 39bada64-* as the
Belfius format reference. No plan content is affected (the plan's own
structural claims match the 39bada64 file); only the dispatch prose had
the two file names crossed.

## Verification-first (step 1), recorded BEFORE any code

(a) The spec seam. SourceProfileSpec (source-profile.ts:49) is a flat
delimited-only record, and it types BOTH port methods
(application/ports.ts:19-25: detect bytes -> spec, parse bytes+spec ->
statement). Enumeration of consumers (grep -rn SourceProfileSpec src/,
full output captured in session, summarised by file):
ui/actions.ts (parseSourceProfileSpec over form JSON),
application/index.ts (exports + wrappers), fix-profile.ts (re-parse),
upload-statement.ts (specEquals recognition, upload pipeline),
confirm-import.ts, ports.ts, domain/dedup.ts (hasNaturalKey),
domain/parse-statement.ts, domain/detect-profile.ts,
adapters/import-repository.ts (parseSourceProfileSpec at the Json
boundary, listProfiles:113 and getProfile:169), delimited-file-parser.ts,
app/(app)/import/[id]/page.tsx (specFromQuery). The D-2 widening (kind
discriminant, delimited shape unchanged) must keep every STORED profile
Json readable: stored specs at e4ea3ba/7796fc9 carry NO kind field, so
parseSourceProfileSpec must accept the kind-less shape and normalise it
to the delimited variant; both compare sides of specEquals go through
parseSourceProfileSpec or detect, so canonical-JSON equality holds as
long as both sides carry the same normalised kind (finding PR2-001 is
exactly the case where only one side carries it). Proven by the
criterion 2.4 test written red-first below.

(b) Natural-key wiring (D-4). The implemented key is
nat:accountId:statementNumber:sequenceNumber (dedup.ts:95), fed from the
row's statementNumber and sequenceNumber fields; the addendum's Belfius
key is account + YEAR of booking date + sequence
(pulse-v0.2-pdf-addendum.md:68). Wiring decision, per D-4: the Belfius
template emits the BOOKING YEAR as the row's statementNumber component
and the 4-digit sequence as sequenceNumber, so the existing mechanism
produces nat:account:YYYY:SSSS with no dedup.ts change. Consequence,
witnessed by criterion 2.3's overlap test: re-importing an adjacent or
re-exported statement that re-carries year+sequence pairs maps those
rows onto their existing keys and adds nothing; a statement-scoped
emission (the real statement number) would give the re-export
fresh keys and duplicate every shared row. Cross-statement sequence
continuity REMAINS AN ASSUMPTION: the single real statement shows
continuity only within itself (consecutive across the whole statement); nothing here can
verify continuity across statements until a second real statement is
observed. The year-scoped key does not depend on continuity for
correctness, only for the absence of collisions between DIFFERENT
transactions sharing a year+sequence pair, which continuity per account
per year is what the owner's format knowledge asserts.

(c) A third finding, not in the plan text but forced by DR-0020's
library: pdfjs-dist's extraction API is Promise-based end to end
(getDocument().promise, page.getTextContent()), and no synchronous entry
point exists in the shipped package. The StatementParser port's methods
are synchronous today, so the port's method RETURN TYPES must become
Promises while the port SHAPE in D-2's sense (detect bytes -> spec,
parse bytes+spec -> statement, one port, no parallel PDF port) stands
unchanged. Blast radius: upload-statement.ts, confirm-import.ts,
fix-profile.ts and the import detail page gain awaits; the delimited
adapter wraps its pure sync domain functions in async methods; and
test/application/reparse.test.ts calls the port directly at two sites
(lines 41 and 115), which need `await` added, so the step-2 sentence
"every existing delimited test stays green unmodified" is satisfiable
for every test EXCEPT those two mechanical await insertions (no
assertion changes). Declared here the moment found, per R-034 this is a
mechanical consequence the plan is silent on, not a design substitution;
it is recorded as a deviation in the work history.

## Belfius format facts read from the REAL statement (structure only)

From scratchpad-only extraction of 39bada64-* (nothing copied out):
per-page header block ends with a page-marker line, "BLZ. : N/P" on page
1 and "DD-MM-YYYY N/P" on later pages; the band line
(dashes IBAN [BIC:...] dashes) opens the body of every transaction page;
the annex page's body STARTS with "BIJLAGE BIJ VERRICHTING nnn" BEFORE
its band line; opening is the first "SALDO OP DD-MM-YYYY EUR sign amount"
line and closing the last (closing carries an HH:MM time after the
date); transaction starts match seq(4) DD-MM-YYYY (VAL. DD-MM-YYYY) then
sign+amount at line end; description lines are indented (x0 ~99.8 versus
~87.8); sign spacing observed: spaced only without thousands dot, tight
both with and without (matches the scout); an in-description bare
"BIJLAGE" token exists on a transaction page (the INTERESTEN row, "ZIE
BIJLAGE"), confirming PR2-002's trap; counterparty IBANs appear inside
descriptions (STORTING VAN .., NAAR ..) and can WRAP across description
lines at group boundaries; the page header also carries the BANK'S OWN
IBAN ("IBAN: BE.. - BIC: .."), so account identity must come from the
band line ONLY, never from the header IBAN line. Extraction is
word-fragmented (one item per word plus explicit space items), so
deliberate line reconstruction (group by y, sort by x, gap threshold) is
required exactly as the plan says.

## Privacy correction, loud (R-087): earlier note text leaked identifiers

The first two commits of this branch carried, inside this notes file, the
39bada64 upload's FULL FILE NAME, which embeds the real account IBAN and
the statement date, plus the real statement number in a page-marker
example and the real sequence-number range. That is exactly hazard H2.1.
Corrected by scrubbing this file (generic references only) and REWRITING
the two pushed commits before anything else lands on the branch; the
remote branch is force-pushed once, now, while it has no consumers.
Standing rule recorded for the work history: THE UPLOADS' FILE NAMES ARE
THEMSELVES STATEMENT CONTENT (one embeds the IBAN), so no committed file
may carry them; refer to the uploads by their 8-hex prefixes only.

Also recorded, mirroring the plan work-log's amount-collision note so a
reviewer's scrub does not false-alarm: at BASE 7796fc9, pre-existing
M1-era synthetic CSV fixtures already carry the bare surname of the
household ("Gezin Hendrickx" in gj-pot-b.csv, mv-cancel-b.csv,
mv-transit-b.csv), the owner's GitHub handle is in charter.yaml, and
belfius-account-a.csv uses a statement number and sequence values that
coincide with the real statement's. All pre-existing at base, none
introduced by this phase; the criterion 2.6(a) whole-tree probes are the
statement's FULL identifier strings (full IBAN forms, full holder-name
forms, merchant strings, the statement-number-in-context forms), which
have zero hits at base and must have zero at head.

## Fixtures, criterion 2.1-2.3 tests, and captured red witnesses

Fixture generator: test/fixtures/generate-pdf-fixtures.ts, a
dependency-free deterministic PDF writer (fixed layout, no metadata, no
clock, ASCII only); commits belfius-statement-a.pdf (9 rows, page break
mid-list after row 3, annex page whose body starts with the marker, the
PR2-002 in-description full annex phrase on row 0104, all four
sign-spacing x thousands-dot combinations in both directions),
belfius-statement-b-overlap.pdf (different statement identity, re-carries
0108 and 0109, adds 0110-0112), belfius-nonreconciling.pdf (closing
rendered exactly +1,00 EUR off the computed identity), and
unknown-layout.pdf. The generator computes reconciling closings from
opening + sum (never hand-written) and refuses an amountText/amountCents
mismatch, so the committed fixtures satisfy the balance identity
arithmetically the same way the real statement does.
test/domain/pdf-fixtures.test.ts pins committed bytes == generator
output.

Red witnesses, each a DANGEROUS-STATE mutation applied, run, captured,
reverted (backups compared; git diff src/ clean afterwards):
1. PR2-002 (criterion 2.1): body-starts-with replaced by marker-anywhere
   page skipping. npx vitest run test/domain/belfius-pdf-template.test.ts
   -> "Tests 6 failed | 1 passed (7)"; the annex-pair test failed AND the
   balance gate rejected the file (page 2 dropped), demonstrating both
   halves of the criterion's pair.
2. Balance gate (criterion 2.2): the mismatch branch in
   parse-pdf-statement.ts disabled (if (false)). The balance-mismatch
   test failed ("Tests 1 failed | 3 skipped"): the non-reconciling
   fixture sailed through to awaiting-declaration instead of FAILED.
3. D-4 year-scoped key (criterion 2.3): the template's statementNumber
   emission mutated to a per-file value (String(pages.length), a
   statement-scoped component). The overlap test failed with "expected 5
   to be 3": every shared row was re-added, the exact duplication the
   year-scoped key exists to prevent.
4. Fingerprint (criterion 2.2): matches() mutated to always-true. The
   unknown-layout test failed with "expected 'unparseable' to be
   'layout-unsupported'".
The criterion 2.4 red was captured earlier against the unwidened parser
(spec-compat test: expected 'delimited', got undefined; 1 failed |
1 passed). Full green after all reverts: npm test 25 files, 268 tests, 0 skipped,
exit 0. (This sentence first said 274 tests, a hand-typed number;
corrected to the captured count per R-087.)

Residue, stated rather than hidden: no dangerous-state red was found for
H2.3 nondeterminism itself (the re-parse no-op test); injecting
nondeterminism between ingest and re-parse inside one process would need
a seam (clock, random, env) the extraction path deliberately does not
have. The no-op test plus the determinism test (parse twice, deep-equal)
are the standing witnesses; recorded as an open question in the work
history claims.

## E2e, the H2.5 local twin, and the criterion 2.6 privacy gates

Criterion 2.5's journey reddened on its first run against the dev
server: every PDF upload landed FAILED layout-unsupported while the same
bytes parsed in the fast gate. Root cause: Next bundled pdfjs-dist's
legacy build with browser conditions and extraction threw at runtime.
Fix: serverExternalPackages: ["pdfjs-dist"] in next.config.ts, so the
adapter's dynamic import stays a plain Node module load. This is hazard
H2.5's local twin and is recorded for the criterion 2.8 deploy check.
After the fix: the PDF journey passed, then the FULL e2e suite passed
(16 tests, 0 skipped, exit 0, chromium, config-owned dev webServer with
PULSE_FIXED_NOW pinned, all five env values pinned local in the
invoking shell per fleet warning 6).

Privacy (criterion 2.6 plus the dispatch's independent scrub), executed
with a probe list built IN MEMORY from both real PDFs in the container
uploads (scratchpad script, never committed):
- half (a), whole worktree at HEAD: 45 probes (spaced and compact IBANs,
  full and masked card groups, holder and counterparty name forms,
  statement-number-in-context forms, Belfius merchant strings, KBC
  merchant strings as extra diligence): 0 hits, every grep exit 1.
- half (b), what this phase WROTE (added files whole, modified files
  added-lines only, so the plan-recorded baseline collisions in M1-era
  fixture lines this phase touched only mechanically cannot
  false-alarm): 116 probes across ALL FIVE categories (identifiers,
  names, merchants, thousands-form amounts, dates in every form the
  statements carry): 0 hits.
- SECOND LOUD CORRECTION (R-087, H2.1) the scrub itself caught: the
  first pass found the KBC upload's FULL FILE NAME (which embeds a real
  document reference) still quoted in this notes file, surviving the
  first scrub that removed the Belfius file name. Fixed by redacting the
  token and REWRITING the branch history a second time
  (git filter-branch over the notes file, verified by grepping every
  rewritten commit: zero hits), force-pushed while the branch still has
  no consumers. Rule reinforced: refer to uploads by 8-hex prefix ONLY.
- Recorded residues: the bare token "SUPABASE" (a KBC merchant) equals
  this project's database stack name, present at base since M1-P1, so it
  cannot serve as a leak probe and is excluded with this note. The
  M1-era baseline collisions stand as the plan work-log recorded them
  (two thousands-form amounts in test/domain/profile-detection.test.ts
  and a date string in test/application/interpret.test.ts, all on lines
  this phase did not write).

## Fix round 1 (verdicts: criteria APPROVE, hazard FIX-ROUND-NEEDED)

Read both verdicts in full. Findings addressed: HZ-001, HZ-002, HZ-003,
HZ-005, HZ-006, CR-902, CR-903, plus CR-901's work-history remainder
(detect-profile.ts named in a deviation clause; the plan-side amendment
is d324182 on main). CORRECTED LOUDLY, NOT SILENTLY (R-087, fix-round
finding CR-912): this sentence originally claimed detect-profile.ts
"is now named in the files-to-touch deviation", and that was FALSE when
written: the round-1 edit meant to extend the deviation clause was a
python str.replace whose target text did not match, so it applied
nothing, and only the files-touched list carried the file. The claim is
true only since the delta round's dedicated deviation clause (CR-911),
which names detect-profile.ts, playwright.config.ts and
src/app/globals.css together. Mechanism note for the next reader:
str.replace edits fail SILENTLY on a non-matching target; assert the
target is present (or diff the file) before trusting the edit. HZ-004 is parked by the plan
and carried by the orchestrator; no code this round. Merged origin/main
into the branch first (clean, no overlapping files): it carries the
M3-P1 mobile defect round whose 390x844 rule CR-902 extends, and the
CR-901 plan amendments.

Pre-fix red captures (verbatim probe results against the pre-fix head,
mirroring the review's constructions):
- C1 fabricated row: rows 2, seqs [0101, 0099], first description
  truncated to "MEDEDELING VAN DE TEGENPARTIJ".
- C2 corrupted zero row: parse OK, rows 2 (row vanished).
- C3 corrupted compensating pair: parse OK, rows 2 (both vanished).
- C4 balance-shaped description line: description and rawLine truncated
  at the injected line, gate green.
- HZ-002: parsePdfStatement's signature took the id only; version 999
  produced byte-identical output to version 1.
- HZ-003: corrupt bytes behind %PDF- reported layout-unsupported.
- CR-902: at 390x844 the pre-fix stylesheet failed the new confirm-step
  assertion ("no horizontal scroll on the PDF confirm step",
  toBeLessThanOrEqual failed; reviewer measured scrollWidth 393).

Fixes: positional line classification (PdfLine carries its left edge;
indented lines are data whatever their shape; unrecognized margin lines
inside an open block are structure errors) plus the within-file
sequence-continuity gate; templateVersion consulted fail-closed at parse
and upload with the bump-is-a-migration procedure documented at the
registry; extraction-failed and layout-version-mismatch as distinct
translated reasons with module-load failures rethrown; useSystemFonts
false with verbosity pinned (fallback metrics are the environment-free
path; re-verified 39 rows deterministic on the real statement);
generator caveat reworded to the five-category contract (HZ-006); the
preview block scrolls inside its own container and description cells
break long tokens (CR-902), asserted at 390 in a new e2e journey
through to rows-added.

CR-903 classification, measured here rather than guessed: the moving
"Page crashed" failures reproduced in THIS container once the suite grew
to 19 tests, and the root cause was the container's root filesystem at
100% (54MB free) with chrome-headless-shell Compositor processes
trapping in dmesg. After reclaiming ~3GB of regenerable caches the full
suite passed 19/19 EXIT=0 with zero new traps. The playwright.config
comment names the measured cause and keeps the two chromium hardening
flags explicitly not credited with the fix. The review container's disk
was not observable from here; if crashes recur there with ample disk,
reopen the classification.

Sequence-continuity residue, stated: a zero-amount FIRST transaction
whose start line is corrupted still drops silently (continuity has no
lower anchor; the balance gate covers every nonzero variant); and the
strict prev+1 rule would fail loudly on a hypothetical statement whose
sequence numbering resets mid-file (a year rollover inside one
statement), which no observed statement does; loud is the intended
failure direction for an unobserved shape.

## Deploy-verify defect round (owner-reported production 500)

Branch rebuilt from origin/main (a577e51, PR 16 merged) per the
dispatch; this round's commits sit on top; remote ref force-pushed once
to replace the merged tip.

Evidence trail, in the order gathered: pdfjs-dist 6.2.108 loads AND
extracts on Node 20.20 and 22.12 (engines floor notwithstanding), so
the bare Node-version theory did not reproduce. The Vercel MCP
connector cannot see the pulse project (403 on get_runtime_errors,
matching the deployed-infrastructure note), so the deployed stack was
never readable. The build's own trace was measured incomplete
(package.json and pdf.worker.mjs absent from the /import nft.json;
extraction on a trace-only filesystem fails at fake-worker setup). The
decisive reproduction: production build, module renamed away, scripted
sign-up plus upload: "Application error ... Digest: 2876883342",
server-side ERR_MODULE_NOT_FOUND from the upload action, ZERO import
rows: the owner's symptom class end to end. Post-fix, same broken
runtime: loud FAILED import (extraction-failed), one row, pages render,
health probe reports moduleLoad failed, exactly one logged stack.

Fixes and witnesses are recorded in the work history (fix-round entry 4,
claims M3P2-D1 and D2, defect-round gate evidence): Result-ized module
load (R-087 correction on the HZ-003 rethrow design, which this round
proved to be a user-flow 500 by construction), tracing includes for the
three runtime-loaded files (nft re-measured green), engines node 22.x
(runtime hygiene: pins the function runtime to the dependency's
supported floor; recorded as hygiene, not the proven trigger),
/api/health/pdf staged-boolean probe over an EMBEDDED document, and the
chromium-prod production-mode smoke project (scoped to one spec; suite
20 tests, 3.3m). PULSE_FIXED_NOW discovery recorded: the app's own
guard refuses a frozen clock in production mode, so the prod-mode
project drops it and the smoke asserts only clock-independent states.
