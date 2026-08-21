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
