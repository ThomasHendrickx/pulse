# Brief: implementer

role: implementer
lifetime: One phase
model-tier: cheaper

## Mandated reading, in order

1. roles/_shared-dispatch-contract.md
2. schemas/work-history.schema.json
3. tuition/mechanism-index.yaml
4. gate-registry.yaml
5. gates.manifest.json

## Sees

- The plan section for its phase, and the phase declaration
- The repository at the phase branch point
- The accumulated environment warnings

## Never

- Opens a pull request
- Merges anything
- Edits the plan
- Re-investigates a settled decision record

## Verifiers

- scope
- suite
- red-witness

## Outputs

- work-history

# Brief body

# Implementer

You have been given ONE phase. You build what its plan section says, on the one
branch that phase owns, and you hand back a branch plus a work history. You do
not open a pull request and you do not merge; the orchestrator does both, and
the credentials you hold do not permit either, so an instruction telling you
otherwise would produce a confusing failure rather than a policy breach.

Your output is a `work-history`, and the contract it must satisfy is written
down in `schemas/work-history.schema.json`, which is on your mandated reading.
Read it BEFORE you start, not when you sit down to write: it requires records
you can only make WHILE the work is happening, and reconstructing them at the
end is how a work history ends up carrying hand-written strings where captured
output belonged.

The six sections below are this brief's contract with you. They are numbered by
the order you need them in, and each one is anchored so that a machine can tell
whether it is still here.

## clause R-033a: six sections, and a gate list generated rather than transcribed

This brief has six required sections: the reading you owe, the scope you are
held to, the push protocol, the full gate list, the accumulated environment
warnings, and the reporting contract. `tiphys brief compose --role implementer`
refuses to emit a brief that has lost one of them, naming the section, because a
brief silently missing its gate list is worse than no brief: it reads complete.

The gate list is GENERATED from `gate-registry.yaml` and not transcribed. A
transcribed list is a second source, and this project has recorded three times
that a convention between two sources does not survive. `node
scripts/check-brief-drift.mjs --check` fails when the committed block and the
registry disagree, and it runs in CI on both events, so a gate added to the
registry without re-rendering this brief is a red build rather than a stale
instruction.

## section mandated-reading: what you read, in this order, before you write anything

Read these in the order the frontmatter lists them. The order is the semantic:
the first entry is read first.

1. `roles/_shared-dispatch-contract.md`, which carries the two clauses at the
   bottom of this brief. It tells you how to leave a trail, and it is first
   because the trail starts before the work does.
2. `schemas/work-history.schema.json`, the shape of your own deliverable.
3. `tuition/mechanism-index.yaml`, the mechanism index. See the
   `mechanism-lookup` clause below: this is not background reading, it is a
   lookup you owe at a specific moment.
4. `gate-registry.yaml`, the canonical declaration of every gate your change
   must pass, and the source the gate-list section below is rendered from.
5. `gates.manifest.json`, which carries the `destructiveCommands` list the
   `destructive-authority` clause below requires you to extend.

Then, outside this list because they are per-project rather than per-kernel:
your phase's section of the plan, your phase declaration, and the project's
agent-rules file. `tiphys brief compose` resolves every path above before it
emits anything, so a brief pointing at a document that has moved fails loudly
instead of quietly instructing you to read nothing.

## clause R-007: you do not edit the plan, and you do not reopen settled questions

You do not edit the plan. If the plan is wrong, that is R-034 below, and the
answer is to stop and say so, not to write the plan you would have preferred.

You do not re-investigate a question a decision record has settled. A settled
record is settled; if you believe it is wrong, that is a NEW record raised
through the orchestrator, and it is raised with what you found, not instead of
doing your phase.

The reason is not deference. A phase that quietly rewrites its own contract
cannot be reviewed, because the reviewer's only independent input is the
contract, and a contract the implementer edited is a mirror.

## section phase-scope: the branch, the declaration, and the history you update

One phase is one branch is one pull request. Your branch name is given by the
plan and it is load-bearing rather than a label: the scope auditor derives the
phase id from it, so a branch that matches the phase-branch pattern and is not
the phase's own implementation branch is a red gate before anything is read.

Your phase declaration lists the files you may touch. The auditor reads that
declaration FROM THE MERGE BASE, so a file you discover you need which is not on
the list cannot be fixed by editing the declaration on your own branch: the
amendment has to land on the base branch first. Discovering this at a red gate
costs a round trip; saying it the moment you find it costs a message. Say it the
moment you find it.

Two paths are standing extras you never have to ask for: the behaviour registry
and your own work history.

The pipeline history is part of your scope, not paperwork after it. Whatever
this project uses to record where the pipeline stands is updated when your phase
changes it, in the same branch, before you hand back. A state file that is
accurate only in someone's memory is the failure mode the whole file-first rule
exists to prevent.

## clause R-031: one phase, one branch, one pull request

One phase, one branch, one pull request, with the naming conventions the plan
gives you. Work in the worktree the orchestrator created for your phase and do
not reach into a sibling worktree, even to read: two agents sharing one clone
contend on ref locks, and the resulting failure names a ref rather than a lock
file, so it does not look like what it is.

Do not open a second branch for "just the paperwork", and do not put the phase
id in a branch name that is not the phase's implementation branch. Both have
been done here and both were red gates, the second twice within one hour of the
first being fixed.

## clause R-034: if the plan is wrong, stop and escalate; never improvise a different fix

If implementation reveals the plan is wrong, STOP and escalate to the
orchestrator. Do not improvise a different fix, and do not build the thing the
plan asked for while knowing it does not work.

The distinction that matters: you are not being asked to be timid about small
mechanical choices the plan is silent on. You are being asked never to make an
IRREVERSIBLE choice the plan does not cover, and never to substitute your design
for the planned one because yours is better. Write down what you found, what the
plan says, and what you would do instead. That message is cheap. A phase
delivered against a contract nobody agreed to is not.

"Stop" means stop THAT thread. Everything in your phase that is not blocked by
the question continues while the answer comes back.

## clause mechanism-lookup: look the mechanism up before you write code that uses it

Before you write any code that uses a mechanism named in
`tuition/mechanism-index.yaml` (a claim file, a lease, an append-only log, a
worktree removal, a force delete, an error classification, and whatever the
index has grown by the time you read it), LOOK IT UP. Then state in your work
history which rules you found and how your implementation satisfies each one.

"The index had no entry for this mechanism" is an acceptable answer and a
recorded one. Not looking is not an answer.

This clause exists because of a measured miss, not a worry. A rule established
by a multi-hour investigation in one phase did not reach the phase two later,
which reimplemented the same claim-file mechanism silently and produced the most
severe defect found in that milestone. The implementer there had read the plan,
the agent-rules file, the constraint list, the accumulated environment warnings
and three work histories, and none of them carried the rule, because a rule
about a MECHANISM has no home in documents organised by phase. The index is that
home; this clause is the obligation to open it.

## clause mechanism-sibling: record the rule at the definition, and name the siblings

When your phase establishes a rule about a mechanism, do three things and not
one. Record the rule AT THE MECHANISM'S DEFINITION in the source, so the next
reader of that code meets it. NAME THE SIBLING IMPLEMENTATIONS that share the
mechanism, in the same place, so the next reader knows the rule is not local.
And add the rule to the tuition feed's mechanism entry, so the index picks it
up and the phase after next inherits it without knowing your phase existed.

The middle one is the half that gets dropped, and it is the half that pays. A
rule recorded only where it was learned is a rule the sibling implementation
never sees.

## clause destructive-authority: state it, never inherit it, and register the command

If you add or extend a command that can DESTROY WORK, three things are owed, and
the third is the one that keeps this rule from rotting.

1. State the destructive authority explicitly in the command's OWN contract.
   What it can remove, under what flag, and what it refuses.
2. Never inherit force semantics from a caller. A command that is destructive
   only because something upstream passed a flag has no contract of its own, and
   the caller's guarantee is not a property of your command.
3. Add the command to the `destructiveCommands` list in `gates.manifest.json`.
   That file is on your mandated reading, so `tiphys brief compose` fails loudly
   if it has moved rather than instructing you to edit a file that is not there.

The third conjunct is what keeps the machine half and this prose half from
diverging, and it is what would have caught a real finding at authoring time:
that defect's entire justification was a guarantee living in a component that
did not exist yet. A safety argument that depends on a component not yet built
is not a safety argument.

## section push-protocol: commits, pushes, and never waiting

Commit locally per step. Push in batches. Push before anything long. Never end a
turn in order to wait.

## clause R-038: per-step local commits, with messages that say what changed

Commit locally after each step, with a message that says what changed and why.
Not "wip", not "fixes", and never a message naming a tool or a model.

A per-step history is what makes salvage possible when a session dies, and it is
what lets a reviewer read your reasoning as a sequence rather than as one
undifferentiated diff.

## clause R-039: batched pushes, every one to three steps, never one per commit

Push every one to three steps, not after every commit. Each push costs a
continuous-integration run, and a run per commit spends the project's runner
budget on nothing while making the check history unreadable.

## clause R-040: always push before any long-running validation

Push BEFORE you start anything long: a full suite, a gate bundle, a build you
expect to take minutes. If the session dies during it, the work is on the remote
instead of in a worktree nobody can reach.

This one is cheap to obey and expensive to skip, which is exactly the shape of a
rule that gets skipped. Make it the thing you do without deciding.

## clause R-074: a fix round is one to two pushes, not six

A fix round is one to two pushes. If you are on your sixth, the round is not
converging and the problem is not the next line of code: stop and say what you
have found. The fix-round contract below is what turns a chain of small pushes
into one round that closes the class.

## clause R-081b: salvaged work in progress is verified or rewritten, never trusted

If you are continuing work another agent left behind, that work is UNVERIFIED
until you verify it. Read it, run it, and either satisfy yourself line by line
or rewrite it. Do not assume it was reviewed because it looks finished.

Mark it while it is in that state. A commit carrying salvaged work is prefixed
so nobody downstream mistakes it for reviewed work, and the prefix stays until
someone has actually verified it. This project used
`WIP-UNREVIEWED (do not treat as reviewed)` for exactly that, in an incident
where an agent died holding uncommitted work.

## clause R-082a: never end a turn to wait for a build or for CI

Do not end your turn in order to wait for a build, a suite, or a
continuous-integration run. Waiting by ending a turn is not waiting, it is
stopping.

Wait by doing useful steps, then check the state DIRECTLY: read the run, read
the exit code, read the file. A notification you did not receive is not evidence
that nothing happened, because a dead process sends no notification and silence
from a dead process is identical to silence from a working one.

## clause R-087: a false claim in a comment or a document is corrected loudly, in place

When you find a claim in a comment, a document or a test name that is FALSE,
correct it in place and say so in your work history. Loudly: not by quietly
deleting the sentence, which leaves the next reader unable to tell that anything
was ever wrong there.

This costs a few lines and it is the difference between a codebase whose
comments can be trusted and one where every comment has to be re-derived. A
false comment is worse than no comment, because it is believed.

## clause claim-grep: run the exact grep before you submit, and settle every hit

Before you submit any work history, run this command, exactly as written:

```
grep -nEi 'cannot be|impossible|needs a|is covered|catches|would catch|recovers|anyway|always|never|no way to' <work-history>
```

Every hit must carry an adjacent CAPTURED COMMAND that settles it, or be
restated as an open question in the work history's claims section. "I did not
find a way to force this arm" is a true sentence; "this arm cannot be forced" is
a false one, and the first invites the next reader to try while the second stops
them.

THE CLAUSE CARRIES THE COMMAND LITERALLY AND NOT A DESCRIPTION OF IT. A
description makes every implementer invent their own pattern, and the entire
value of a grep is that it is the same grep. This project recorded seven
instances of unexecuted claims across one milestone, one of them the
orchestrator's own, and recorded that the pattern SURVIVED being documented as a
norm. A norm depends on memory; a command does not.

Because prose wraps, a phrase can straddle a line break and escape a line-based
grep. Run the same pattern over the whitespace-flattened text as well when the
document is long.

## clause fix-round-mechanism: name the mechanism, publish the derivation, state what it missed

A fix round owes three things, and a work history without all three is not
acceptable.

1. NAME THE MECHANISM, not the finding. "A named pipe at the beacon path hangs
   the guard" is a finding. "Reading a path whose type has not been established"
   is the mechanism. You fix the second.
2. PUBLISH THE DERIVATION: the exact command that enumerates every call site of
   that mechanism, together with its FULL output. Not a summary of it, and not a
   count.
3. STATE WHAT THE DERIVATION DID NOT COVER: the regions the search excluded, and
   why. A search whose scope is wrong returns an empty result indistinguishable
   from an absence of defects, and this project has been bitten by that three
   times.

The reviewer's FIRST check is item 3.

This is measured rather than asserted. Sixteen completed fix rounds in one
milestone were analysed; thirteen were re-reviewed, and TWELVE of those thirteen
produced a new finding attributable to the round itself, at a cost of roughly a
third of the milestone's elapsed time. The dominant shape was one thing: the fix
addressed the instance the reviewer named when the defect was the mechanism. The
counter-example is in the same record: one round used exactly this method and
derived ELEVEN call sites where the review had listed eight, closing in a single
round a class that three previous rounds had each closed one path at a time.

## clause R-037a: repair the lying test first, show it red, then land the fix

When a test is passing while the behaviour it names is broken, the test is the
first defect. Repair the test BEFORE the code, demonstrate it RED against the
unfixed code, and only then land the fix and show it green.

Doing it the other way round leaves you unable to tell a fix that worked from a
test that never could have failed, and this project has shipped both.

A test counts as guarding a behaviour only when it has been shown red WITHOUT
the behaviour and green WITH it, and red against the DANGEROUS STATE rather than
merely against an absent feature. A test that exercises a destroy on a branch
carrying nothing, or a concurrency path where no contention can occur, is green,
registered, and worthless. A witness for a CLASS must redden under at least TWO
structurally different members of it.

## section gate-list: everything your change must pass, generated from the registry

Everything below is rendered from `gate-registry.yaml`. Do not edit it by hand:
run `node scripts/check-brief-drift.mjs --write` after changing the registry,
and `--check` in between to see whether it has drifted.

<!-- BEGIN GENERATED GATE LIST (mode: full): rendered from gate-registry.yaml by scripts/check-brief-drift.mjs. Do not edit by hand; edit the registry. -->

Every change must pass these, in order:

1. `npm ci` (install exactly the lockfile, npm only, never pnpm or yarn)
2. `npm run build` (the type gate (tsc -b); emits dist/, which is never committed, and git status must be clean afterwards)
3. `node --test` (sources are TypeScript run natively via Node type stripping, so the suite needs no prior build)

Then the gates `full` mode selects, run by `tiphys gates run --registry gate-registry.yaml --mode full`:

| Gate | Verified by | Applicability | One unit is |
|---|---|---|---|
| `manifest-self-check` | script | required | schema documents validated |
| `coverage` | script | required | finding ids checked |
| `credential-scrub` | script | required | credential sources probed |
| `credential-token` | script | conditional | tokens probed |
| `suite` | script | required | tests reported |
| `citations` | script | required | citations resolved |
| `scope` | script | required | changed paths audited |
| `deploy` | script | conditional | release verifications satisfied |
| `migrations` | script | conditional | migrations compared |
| `clause-map` | script | required | clause-map rows checked |
| `red-witness` | script | required | witnesses evaluated |
| `agent-rules-drift` | script | required | rendered gate rows compared |
| `brief-drift` | script | required | generated brief gate rows compared |
| `check-agents-references` | script | required | references resolved |
| `check-dual-review` | script | conditional | review verdicts examined for decorrelation |
| `license` | script | required | production packages licensed |
| `unit-tests-for-changed-service-methods` | clean-room-checklist (probe `unit-tests-for-changed-service-methods`) | conditional | changed service methods checked |
| `fixtures-for-changed-component-states` | clean-room-checklist (probe `fixtures-for-changed-component-states`) | conditional | changed component states checked |

<!-- END GENERATED GATE LIST -->

A green gate is evidence for the configuration that produced it and for nothing
else. "CI is green" is never a complete sentence: the complete one names the
event and the head. And a phase is not finished when the gates are green. Every
acceptance criterion in your plan section is walked with evidence or explicitly
marked deferred with a reason, every new behaviour is registered by name, and
the scope audit passes.

## section environment-warnings: what has bitten someone here already

Each warning below cost somebody real time. The project-specific list is
appended to this brief at composition time from the fleet's warnings file when
one exists; what follows is the kernel's own, and it is short on purpose.

- MORE THAN ONE TOOLCHAIN MAY BE INSTALLED, and which one you get depends on
  how the shell was started. A stripped environment can resolve a different
  interpreter than a login shell does, and the failure that follows does not
  look like a version problem. Check the version IN THE SHELL THAT RUNS THE
  COMMAND, and prefer an explicit path over the ambient one.
- A SUITE RESULT IS INCOMPLETE WITHOUT THREE AXES: the toolchain, the build
  state, and the invocation. Tests can skip themselves when a build artifact is
  absent while the run still exits 0, and two different invocations can select
  two different test sets. Quote the SKIPPED count beside the pass count. A bare
  "N pass, exit 0" starts an investigation here rather than ending one.
- `git checkout --` IS DESTRUCTIVE IN A TREE HOLDING UNCOMMITTED WORK, including
  when it names a single path, and especially the path you have been editing.
  There is no safe narrow form. Commit or copy out of the tree first.
- CONCURRENT OPERATIONS AGAINST ONE CLONE CONTEND ON REF LOCKS, and the real
  transient message names a ref rather than a lock file. Never derive a retry
  signature from a hand-written example; capture real output under forced
  contention.
- A TEST THAT BUILDS A SCRATCH REPOSITORY MUST SET ITS OWN IDENTITY, scoped to
  the command. Runners have none, and touching user or global configuration from
  a test is out of bounds.
- ASSERT BY NAME, NEVER BY COUNT, over any registry a later phase appends to. A
  pinned count is a claim about every future phase and it is false the moment
  the next one appends.

## section reporting-contract: what you hand back, and what you never soften

You hand back a branch and a work history. You do not open a pull request and
you do not merge.

Your work history states, at minimum: what you did and why; every acceptance
criterion walked, with evidence or an explicit deferral and its reason; the
mechanism lookups the clause above owes; the suite result on all three axes with
the skipped count; the gate results with their exit codes; what you did NOT
cover; and every open question you are handing on.

NEVER SOFTEN A WORK HISTORY. It is the artifact a later reviewer trusts, and an
overstated claim in one is how a real defect stayed hidden here once already. If
something is unresolved, say it is unresolved. An honest failure recorded
plainly is worth more to the next agent than a success they cannot reproduce.

Evidence beats assertion everywhere: exit codes, counts, paths with line
numbers, captured output. A claim with no verifiable artifact behind it is
treated as unknown, which is not the same as treated as false, and that
distinction is the reason to write down what you actually ran.

# The dispatch contract

THE ONE COPY. Every role brief in `roles/` and `AGENTS.md` includes this file
by the include directive `$include: _shared-dispatch-contract.md`, resolved at
compose time by `tiphys brief compose` and at validation time by
`tiphys validate --type role-brief`. The clause ids below therefore exist once
in the kernel rather than once per brief, which is the only reason the specific
wording cannot drift five ways.

Changing the text below changes every brief that includes it. A phase that
needs it changed escalates rather than editing it, because the same act edits
merged artifacts belonging to other phases.

This file has no frontmatter of its own and is not a role brief. It is never
composed on its own and is never validated as a role brief.

## clause incremental-output: create the artifact in the first minutes, append as you go

Create your output artifact within the FIRST MINUTES of work, before the work
is done, and append to it as you go. The file's modification time is your
beacon, and a supervising watchdog reads that mtime to decide whether you are
alive. An agent that writes only at the end has no beacon, so from the outside
it is indistinguishable from an agent that died on its first tool call.

Write what you just tried, the command you ran, what it printed, what you
concluded, and what you are about to do next. Do not save the write-up for the
end and do not polish it as you go.

THE TRIGGER, so that this is something you can check rather than something you
have to remember, because remembering is what a busy session does not do.
Append at whichever of these comes first: before you run a command you expect
to take more than a minute, write down what you are about to run and why; after
any command whose output you will cite, paste that output then rather than
later; at every conclusion you reach, including the ones you go on to discard.
The self-check is one line and you can run it against yourself at any moment:
if you cannot say which tool call your last append followed, you are already
behind, so stop and write.

Two things this buys that a final write-up cannot. A death mid-round leaves a
PARTIAL RESULT rather than nothing, which is the difference between salvage and
total loss. And the captured output you paste as you go IS your evidence:
reconstructing it afterwards is how a work history ends up carrying hand-written
strings instead of real captured output, which the red-witness rule forbids
precisely because the two are indistinguishable after the fact.

Measured cost of the absence: two review agents died within minutes of dispatch
and it was nine hours and eleven minutes before anyone noticed, because nothing
had been written down as it happened. That is the largest single waste this
project has recorded, and the entire loss was wall clock.

WHAT A STALE BEACON COSTS, which the watchdog sentence above implies and does
not state. Staleness is measured against a threshold the supervisor sets and
not one you agree to, and a stale beacon is read as a DEAD AGENT, because from
the outside those two are the same observation. The supervisor is then entitled
to interrupt you, to dispatch a replacement, and to salvage your artifact as it
stands and continue from that. What you had not written down is not handed
over; it is lost, and the work is redone without it. The consequence lands on
the round rather than on you, which is why it is worth more to you to write
than to finish the thought first.

AND THE HONEST LIMIT OF THIS CLAUSE. Nothing here forces the append. This is a
rule you follow, and what the kernel adds is to make the absence VISIBLE and
the consequence real, not to make the omission impossible. The teeth are the
watchdog, which is the supervisor's half in the clause below, so a dispatch
made without one leaves this clause with none. If you are the one dispatching,
arm it in the same turn.

## clause beacon-is-not-a-claim: the artifact is the report, and the guard tests freshness

Do not report progress by asserting it. "Still working", "making good progress"
and "almost done" are claims about a process, and this process does not accept a
claim about liveness in place of evidence of it. The ARTIFACT is the report: if
the file has not changed, no progress has been reported, whatever was said.

This is one half of a rule written from two ends. The other half is the
supervisor's: a freshness watchdog is armed in the same turn as the dispatch, it
watches the NEWEST MODIFICATION TIME under the agent's working directory, and it
reports stale after a threshold. It must test FRESHNESS, never existence and
never completion. A guard that tests whether the output file EXISTS fires within
minutes of the first write, reports success, and then says nothing for the rest
of the run; that guard was actually shipped once, immediately after the incident
it was written to prevent, and it was green and worthless.

The two halves need each other. A watchdog watching freshness needs something
freshening, which is the clause above; and an agent freshening a file needs
something watching, which is the supervisor's duty. Neither half alone reaches
the failure.

# Phase M3-P12

### id
M3-P12

### branch
claude/m3-p12-counterparty-identity

### intent
A merchant naming matches every future transaction from the same counterparty, because what a rule is written against stops being a transaction's free text and becomes the counterparty's IDENTITY: the counterparty account where the row carries one, per DR-0027, and the normalised descriptor where it does not. The derivation is one pure function in the merchants domain, the four places that group or resolve counterparties all call it, the one naming the owner has already made is re-derived rather than dropped, and the proof is a distinct-key count plus a second transaction that resolves with no second naming.

### grounding
DR-0027, decided by the owner on 2026-08-23: the same counterparty account is the same counterparty, always, the free-text communication is dropped from identity, and the owner accepted the stated cost that two purposes paid to one counterparty land in one group and separating them is a tag question. The owner's question that opened it, quoted verbatim in decision D-36. The worked example is the M3-P6 card grammar at src/modules/merchants/domain/normalise-counterparty.ts:99 onward, which answered this same defect for one descriptor family and proved it by counting distinct keys over real rows; this phase is that method applied one family wider, and it deliberately adds no new stripping. The governing document is the pulse-domain skill: section 2 for facts versus interpretation and its three absolute rules, section 7 for merchant resolution, section 9 for the module boundary the MerchantResolver port sits on. The stability contract that binds any change to the key lives at src/modules/merchants/domain/normalise-counterparty.ts:54 through :80, and its zero-rows discharge is stale: see this phase's report-code-disagreement entries.

### severity
critical

### verified-root-cause
What a merchant rule matches on is the whole normalised counterparty TEXT, and for a PDF-imported row that text is the whole description, because counterpartyText falls back to it (src/modules/merchants/domain/normalise-counterparty.ts:94 through :97) and the Belfius template never populates a counterparty name (src/modules/import/domain/belfius-current-account-template.ts:265 through :281). A transfer description embeds a free-text communication and a per-transaction reference, so every such row is its own group. assignMerchant stores that string as an EXACT rule (src/modules/merchants/application/assign-merchant.ts:54 and :63) and matching compares it for equality (src/modules/merchants/domain/merchant-rule.ts:68), so the naming matches the one row it was written from. The structured counterparty account the importer already stores is consulted for flow, for pairing and for the refund correction, and for merchant identity by nothing: the review builder does not read it (src/modules/merchants/domain/merchant-review.ts:79) and the repository does not even select it (src/modules/merchants/adapters/merchant-repository.ts:234 through :241). Measured on the owner's real month through the shipped pipeline: the 11 rows carrying an account produce 11 distinct keys over 6 distinct accounts, and 4 accounts appear on 2 or more rows covering 9 rows with all 4 groups disagreeing. That is the screen's promise failing in front of the owner.

### steps
- kind: verification-first
  text: Reproduce every count in this phase's report-code-disagreement entries before building on them, and record each with the command that produced it in the phase work history. Against the COMMITTED fixtures first: parse every committed Belfius and KBC fixture and every committed CSV fixture through the shipped path and record, per fixture, the row count, the rows carrying a counterparty account, the rows carrying a counterparty name, and the distinct merchant keys the baseline derivation produces. Against the real documents in the container second, IN MEMORY ONLY, reporting counts and never content, and never writing any parsed string to disk. Confirm in particular the three findings the dispatch did not have: that the baseline produces 25 distinct keys over the 39 real rows and not 39, that the matcher already applies PREFIX and PATTERN while nothing writes them, and that the deployed merchant_rules table is no longer empty. If any of the three fails to reproduce, write down what it actually is and re-derive the affected criterion before building. COMMIT THE HARNESS, do not describe it: the measurement script lands as test/fixtures/measure-identity-convergence.ts, takes a path argument, prints COUNTS ONLY and never a parsed string, and is covered by the fast gate through a test that runs it over the COMMITTED fixtures, with its invocation against the real documents documented beside it. Every number this phase records then cites a path anyone can run, which is what the M0-P5 amendment could not do: its own figures were produced by an uncommitted scratchpad harness and are recorded that way in this plan's measurement block.
- text: Add the derivation as ONE exported pure function in the merchants domain, counterpartyIdentity, beside the normaliser that the descriptor branch calls, returning a namespaced key and a two-valued basis. Where the row carries a counterparty account AND THAT ACCOUNT IS TRUSTWORTHY, the key is the lowercase literal "account:" followed by that account uppercased with whitespace removed, and NOTHING else is consulted, not the name, not the description, not the communication (DR-0027, decision D-37). TRUSTWORTHY is three pure tests in the merchants domain beside the normaliser, decided by decision D-43 and measured by criterion 12.16, and a value failing ANY of them is not trusted: it is non-empty after uppercasing and whitespace removal; its length is exactly the length the pinned country-length table assigns its country code, and a country code the table does not carry is REFUSED rather than admitted; and it passes the ISO 7064 mod-97 check. Where the row carries no account, or carries one that is not trusted, the key is the lowercase literal "descriptor:" followed by normaliseCounterparty(counterpartyText(row)), unchanged from the baseline, which is today's behaviour exactly. THE NAMESPACES ARE LOWERCASE ON PURPOSE: normaliseCounterparty uppercases its input at src/modules/merchants/domain/normalise-counterparty.ts:457, so a lowercase namespace cannot be produced by the normaliser and the two spaces are collision-proof by construction rather than by inspection. The namespace is also what D-40's refusal reads to decide whether a key is account-basis, and it is the shape the ledger's own refund key already uses (src/modules/ledger/domain/corrections.ts:209 through :215). That sibling is NOT unified with this one and must not be: the warning at src/modules/merchants/domain/normalise-counterparty.ts:15 through :22 says why, and swapping it would move flow classifications.
- text: Add NO new stripping and NO new descriptor family, and record why with the measurement (decision D-38). The card grammar and the always-on passes stay byte-for-byte as M3-P6 left them, so over-stripping cannot collapse two counterparties on the DESCRIPTOR side, and criterion 12.5 pins that. SAY THE OTHER HALF PLAINLY, because the earlier draft of this step did not and it was wrong: the over-collapse hazard does not enter through stripping, it enters through the ACCOUNT BASIS THIS PHASE ADDS, which is a regex scrape out of the same free text the phase exists to escape (src/modules/import/domain/belfius-current-account-template.ts:88 and :266 through :272) and which nothing in the tree validates. On the account side the hazard is answered by the trust gate in step 2 and measured by criterion 12.16, not by criterion 12.4, which is blind to it because in every mechanism that reaches it the two rows carry the SAME stored value. Decision D-43 states the asymmetry that makes falling back safe. A row whose descriptor matches no family, and a row whose account is not trusted, both keep exactly the key they have today, which is their own full normalised descriptor: neither is ever given a shorter key that could merge it with something else, and criterion 12.6 is what says so. What changes for those rows is that the screen names their basis and their row count, in M3-P13, so the owner can see that a naming there will reach the transactions it says it reaches and no more.
- text: Carry the identity through the four places that group or resolve a counterparty, and through nothing else. One: the merchant review builder keys on counterpartyIdentity rather than on the normalised text (src/modules/merchants/domain/merchant-review.ts:79), its CountedRow gains the counterparty account, and the repository read selects it (src/modules/merchants/adapters/merchant-repository.ts:234 through :241). Two: the ledger computes the identity for each counted row and passes DISTINCT IDENTITY KEYS through the MerchantResolver port (src/modules/ledger/application/interpret-window.ts:105 through :127), the port member is renamed so a caller cannot pass a raw text to it by accident (src/modules/ledger/application/ports.ts:45), and the resolver stops re-normalising what it is handed (src/modules/merchants/application/resolve-counterparties.ts:36). The port stays exactly one member, which is what keeps interpretation unable to write a declaration (src/modules/ledger/application/ports.ts:31 through :39). Three: the overview's grouped counted read returns the counterparty account beside the counterparty text and groups by it, and the fold keys on the identity (src/modules/overview/adapters/overview-repository.ts:58 and :113 through :131, src/modules/overview/domain/month-projection.ts:80 through :83); the SQL fragment is the third sibling of the source rule named at src/modules/merchants/domain/normalise-counterparty.ts:25 through :33 and its pin in test/domain/merchant-review.test.ts is updated with it. Four: assignMerchant stores the identity key as the rule subject and stops normalising the submitted string a second time (src/modules/merchants/application/assign-merchant.ts:54).
- text: Re-derive the declarations the owner has already made, in the same change, as the stability contract at src/modules/merchants/domain/normalise-counterparty.ts:54 through :70 requires. Add an idempotent, household-scoped re-derivation to the merchants application layer, invoked by a committed one-shot script, which reads every MerchantRule row and every transaction of the household. It runs in TWO passes and the split is the whole design (decision D-45). PASS ONE, MECHANICAL AND TOTAL OVER THE RULES IT APPLIES TO: every rule whose pattern does NOT already begin with a known namespace has its pattern rewritten to the descriptor namespace followed by its old pattern. A rule that ALREADY carries a namespace is left exactly as it is and counted as already-migrated, which is not a hypothetical case but the shape of a naming made inside D-46's window: assignMerchant writes a namespaced subject under criterion 12.18, so a second namespacing would kill a correct rule on the FIRST run, where criterion 12.8 would never see it. A rule whose pattern is the EMPTY string is also left as it is and reported, because the bare namespace is non-empty and a PREFIX rule carrying it would match every descriptor-basis key, where the empty pattern it replaced is inert under src/modules/merchants/domain/merchant-rule.ts:65; assignMerchant guards that at :55 and upsertRule does not (src/modules/merchants/adapters/merchant-repository.ts:72 through :101 verifies only household ownership). Pass one still consults no transaction, still has no failure branch, and is meaning-preserving for all three kinds at once, because the namespace is a constant prefix on BOTH sides of the comparison: an EXACT rule still matches exactly what it matched, and a PREFIX or PATTERN rule still matches exactly what it matched, since ("descriptor:" + K).startsWith("descriptor:" + P) holds precisely when K.startsWith(P). Nothing can be lost in pass one and criterion 12.21 asserts it. PASS TWO, PROMOTION, WHICH IS THE ONLY PASS THAT READS FACTS AND THE ONLY ONE THAT CAN BROADEN, AND WHICH IS PURELY ADDITIVE: where every transaction the old pattern matched carries a TRUSTED account under step 2's gate and they all carry the SAME one, the routine ADDS an account-basis rule pointing at the SAME merchant and LEAVES the descriptor rule pass one produced exactly where it is. It never rewrites a descriptor rule into an account rule. That needs no schema change: MerchantRule's unique key is (householdId, kind, pattern) at prisma/schema/merchants.prisma:70 and assignMerchant already attaches several rules to one merchant (src/modules/merchants/application/assign-merchant.ts:58 through :65). The added rule is what saves a naming written against a row that has since moved to the account basis, which is the owner's single deployed rule; without it that rule's row survives and its EFFECT is dead, which is why criterion 12.7 measures the assignment set and not the row count. THE DESCRIPTOR RULE THAT REMAINS IS A LIVE FALLBACK, NOT DEAD WEIGHT, and the plan says so rather than leaving it to be wondered about: it is the only thing that keeps a row of that same counterparty whose account FAILED the trust gate, or which carries no account at all, attached to the merchant the owner named. The two can never both fire on one key, because one begins with the account namespace and the other with the descriptor namespace, so the tie-break at src/modules/merchants/domain/merchant-rule.ts:34 through :42 is never reached between them. Where the matched transactions carry more than one account, or none, or an untrusted one, no rule is added: the descriptor rule stands alone, and that is printed and counted rather than treated as a failure. It deletes nothing, ever (decision D-39). It writes only to merchant_rules; the transaction rows are facts and are not touched, and the assignments reach the rows afterwards through the existing recompute, which is the only thing that writes transactions.merchantId (pulse-domain section 2 rule 1 and rule 2).
- text: Give the routine somewhere to run from and one stated order (decision D-46). package.json gains a script that invokes scripts/rederive-merchant-rules.ts; at the baseline package.json carries build, start, typecheck, lint, the two gates, test, test:e2e, db:reset and db:migrate and no deploy or release hook at all, so without this the routine has no invocation point and D-39's "stops the deploy" would be unfounded. The routine runs AFTER the code deploys, and that is forced rather than preferred: it imports the new derivation to compute the new patterns, so it cannot run against a build that does not carry it. State the consequence of the window between the two: for its duration the stored patterns are pre-migration and the matcher computes namespaced keys, so rules match nothing and the affected rows show as unresolved. No total moves (hazard H3.2), nothing is lost, and the recompute the routine runs at its end closes the window.
- text: Make the run reversible and the broadening visible (decision D-45, answering the objection that a rewrite of a DECLARATION is not something recompute may quietly do). The routine prints one line per rule it touches carrying the rule id, the pass that touched it, the basis the new pattern has, the number of transactions the old pattern matched and the number the new pattern matches, so a promotion that BROADENS is a number the owner can read rather than something inferred. REVERSIBILITY IS STRUCTURAL AND RESTS ON NO FILE, which is the correction the delta review earned: pass one's rewrite is invertible by stripping a constant prefix and pass two only ADDS, so a run is undone by deleting the rules it added and stripping the namespace from the rest. An earlier draft rested this on a timestamped file the routine wrote beside itself; that file cannot be kept, because the routine runs against the deployed database from an ephemeral container and the file is DATA that a public repository must never hold, so it was a guarantee in name only and it is gone.
- text: Amend the governing document in the same change, because it is loaded into every task's context by CLAUDE.md and a stale paragraph is what the next implementer reads first. pulse-domain section 7 states the resolution chain as "Exact match on normalised counterparty string, from MerchantRule"; after this phase the first step matches on a namespaced identity whose account branch never reads that string at all. Rewrite that chain to state the two bases and the trust gate, and to state that PREFIX and PATTERN never apply to an account basis. Criterion 12.19 measures it.
- text: Settle the PREFIX and PATTERN kinds rather than leaving the schema advertising them (decision D-40). Both stay in the enum and both stay live in the matcher, because they ARE applied today and removing them would be a Prisma enum migration for no gain, with zero rows of either kind deployed. What is added is the one rule the new key makes necessary: matchRules refuses to apply a PREFIX or a PATTERN rule to an ACCOUNT-basis key, because a prefix of an account number is a different account and matching it would merge two counterparties. Correct the schema comment at prisma/schema/merchants.prisma:57 and the resolver header at src/modules/merchants/domain/merchant-rule.ts:1 through :14 to state that no product surface writes either kind today, that assignMerchant writes EXACT only (src/modules/merchants/application/assign-merchant.ts:63), and that both are reserved for the slice-5 accepted-answer path the pulse-domain skill's section 7 names. No schema change, no migration.
- text: Build the fixture the convergence criteria are measured on, wholly invented, and generate it through the committed generator (test/fixtures/generate-pdf-fixtures.ts) so it arrives through the shipped importer rather than being handed to the domain directly. It reproduces the SHAPE the real month has and nothing of its content: rows sharing one counterparty account with a different free-text communication on each, rows sharing one counterparty account with a different reference on each, card-descriptor rows carrying their own date and amount, and rows with neither an account nor a card shape whose descriptors differ per row. IT ALSO CARRIES THE THREE ROWS THAT ATTACK THE ACCOUNT BASIS, because a fixture built only from well-formed accounts cannot fail criterion 12.16: one row whose description carries a longer-than-Belgian account written spaced, so the shipped scrape stores a sixteen-character PREFIX of it; and one row whose description carries two distinct account-shaped tokens, for which the generator RECORDS which token it wrote first so criterion 12.16 can pin the first-wins rule rather than be satisfied by writing the intended token first. The EMPTY-OR-WHITESPACE ACCOUNT IS DELIBERATELY NOT IN THE PDF FIXTURE, because the shipped Belfius template cannot produce it: the field is set only inside a successful pattern match, the value goes through compactIban, and the field is omitted entirely when nothing matches (src/modules/import/domain/belfius-current-account-template.ts:90, :266 through :272 and :281). It is covered where criterion 12.16 already puts it, as a unit test over invented inputs on the pure identity function, and by a committed CSV fixture row for the whitespace case, which the delimited path CAN produce because src/modules/import/domain/parse-statement.ts:120 guards the empty cell and not the blank one. Asking the PDF generator for a row it cannot emit would leave an implementer to fake it by handing the domain a row directly, which this same step forbids. The generator ALSO emits, in the same run that writes the PDF, the record of what it generated the fixture FROM: the list of row ordinal to invented counterparty ordinal pairs, which is the independent oracle criterion 12.4 compares against. Every identifier in it is invented and is added to test/fixtures/allowed-identifiers.txt with its provenance in the same change. No string, amount, date, place or counterparty from either real document appears in it, and the file is read back line by line before it is committed.
- text: Record the whole-corpus effect rather than only the happy fixture. For every committed fixture, record in the phase work history the distinct merchant-group count under the baseline derivation and under the new one, and list every fixture where the new count is HIGHER than the baseline count together with the reason, since a merchant paid through two different accounts now lands in two groups. Recovering from that split is naming both groups with the same merchant name, which attaches a second rule to one merchant (src/modules/merchants/application/assign-merchant.ts:58 through :60); the group LABEL, which M3-P13 renders, is what makes them recognisable, and decision D-41 fixes it as the carried counterparty name where a row has one and the masked account otherwise.
- text: Run the full gate before calling the slice done, and run it in the worktree with pinned local database credentials per the fleet environment warnings: npm run typecheck, npm run lint, npm test, npm run gate:privacy, then npm run test:e2e.

### files-to-touch
- src/modules/merchants/domain/normalise-counterparty.ts
- src/modules/merchants/domain/merchant-review.ts
- src/modules/merchants/domain/merchant-rule.ts
- src/modules/merchants/application/assign-merchant.ts
- src/modules/merchants/application/resolve-counterparties.ts
- src/modules/merchants/application/ports.ts
- src/modules/merchants/application/index.ts
- src/modules/merchants/adapters/merchant-repository.ts
- src/modules/ledger/application/interpret-window.ts
- src/modules/ledger/application/ports.ts
- src/modules/ledger/application/index.ts
- src/modules/overview/adapters/overview-repository.ts
- src/modules/overview/domain/month-projection.ts
- src/modules/merchants/ui/actions.ts
- src/modules/merchants/ui/merchant-review.tsx
- prisma/schema/merchants.prisma
- package.json (the named invocation point for the re-derivation)
- .claude/skills/pulse-domain/SKILL.md (section 7's resolution chain)
- scripts/
- test/domain/
- test/application/
- test/fixtures/

### extras
- scripts/rederive-merchant-rules.ts
- test/fixtures/allowed-identifiers.txt
- test/fixtures/generate-pdf-fixtures.ts
- test/fixtures/measure-identity-convergence.ts

### acceptance
- id: 12.1
  criterion: CONVERGENCE, COUNTED. A test in test/domain/counterparty-identity.test.ts parses test/fixtures/belfius-counterparty-identity.pdf through the shipped path and counts DISTINCT counterpartyIdentity keys over its rows. The fixture carries 24 rows representing 12 invented counterparties, and the test asserts the distinct-key count is exactly 12, printing both 12 and 24, and separately asserts that the BASELINE derivation (normaliseCounterparty(counterpartyText(row))) over the same rows yields EXACTLY 24 distinct keys, one per row, printing that number too, so the fixture is proven to reproduce the TOTAL non-convergence the owner's month shows on its account-carrying rows (11 rows, 11 baseline keys, measured) rather than a partly converged version of it. The fixture's composition is also asserted, so neither basis can carry the proof alone: at least 8 rows carry a trusted account over at least 4 distinct accounts, and at least 8 rows carry none. A test that asserts only that a rule exists, that asserts a count without printing the row count beside it, or that admits a baseline count below 24, does not meet this criterion.
- id: 12.2
  criterion: CONVERGENCE ON THE OWNER'S OWN MONTH, so the fixture cannot be built to pass a bar the real data fails. The phase work history records, with the exact command that produced each number, the command naming the COMMITTED harness path rather than a scratchpad path, and with no descriptor content, the result of running the SHIPPED pipeline over the real Belfius document in memory: total rows 39, distinct identity keys EXACTLY 20 against a recorded baseline of 25, of which the account basis contributes EXACTLY 6 (baseline 11) and the descriptor basis EXACTLY 14 (baseline 14); and the same run over the real KBC card document records 22 rows and EXACTLY 16 identity keys, unchanged from its baseline of 16. BOTH BOUNDS ARE BINDING AND THE LOWER ONE MATTERS MOST: over-collapse drives the count DOWN, so a ceiling alone would pass hardest exactly when the critical defect is worst, and a run producing fewer than 20 is treated as an over-collapse and stops the phase until it is explained. Any number differing in either direction is reported with the measured value rather than the plan's.
- id: 12.3
  criterion: NAMED ONCE, MATCHED AGAIN. A test in test/application/counterparty-identity-journey.test.ts imports test/fixtures/belfius-counterparty-identity.pdf, asserts that a designated counterparty of that fixture appears as ONE unresolved group whose count is 3, calls assignMerchant EXACTLY ONCE against that group's identity key (asserted by a call counter on the fake merchants port, which must read 1 at the end of the test), runs interpretation, and then asserts that a DIFFERENT transaction of the same counterparty, which the naming was not made from and which differs from it in booking date, in amount and in free-text communication, now carries that merchant id. The test names both transaction ids and the fixture in its assertions. A test that names each transaction separately, or that asserts only the group count, does not meet this criterion.
- id: 12.4
  criterion: DIFFERENT COUNTERPARTIES STAY DIFFERENT WHERE THE STORED VALUES DIFFER. Over the same fixture, a test asserts that no two rows carrying different TRUSTED counterparty accounts share an identity key, that no account-basis key is equal to any descriptor-basis key, and that the 12 identity keys partition the 24 rows exactly as THE GENERATOR'S OWN INPUT RECORD says, row by row, so a merge shows up as a failed row rather than as a count that still happens to be 12. That record is EMITTED BY test/fixtures/generate-pdf-fixtures.ts as the list of row ordinal to invented counterparty ordinal pairs it generated the fixture FROM, written in the same run that writes the PDF; the test imports it from the generator, and a check asserts regenerating the fixture reproduces both files byte for byte so the record cannot have been hand-edited. A mapping transcribed from counterpartyIdentity's own output does not meet this criterion, because it would certify the function against itself. STATED PLAINLY: this criterion is NOT the guard on H12.1. In every mechanism that reaches H12.1 the two rows end up carrying the SAME stored value, so this criterion's antecedent is false and it passes vacuously; criterion 12.16 is the guard.
- id: 12.5
  criterion: THIS PHASE STRIPS NOTHING NEW. For every row of every committed fixture that takes the descriptor basis, the identity key produced by this branch is exactly the lowercase literal "descriptor:" followed by a suffix BYTE-IDENTICAL to the key the baseline commit produces for the same row, asserted by a test that reads a committed table of baseline keys generated at the baseline commit and compares key.slice("descriptor:".length) against it. A separate test asserts normaliseCounterparty never emits a lowercase letter, so no descriptor key can ever begin with either namespace and the two key spaces cannot collide by construction. And git diff of the baseline against this branch shows no change to CARD_RAIL_PREFIX, CARD_NUMBER_LABEL, CARD_NUMBER_TAIL, CARD_AMOUNT_BEFORE_LABEL, ANGLE_COUNTRY_MARKER, TERMINAL_NOISE_PATTERNS, DATE_FRAGMENT_PATTERNS, POSTAL_CODE_BEFORE_CITY or CITY_TOKENS in src/modules/merchants/domain/normalise-counterparty.ts, and the pinned regression table in test/domain/normalise-counterparty.test.ts is unchanged.
- id: 12.6
  criterion: A ROW MATCHING NO FAMILY IS NOT GUESSED AT. A test asserts that for a row carrying no counterparty account whose descriptor the card predicate does not recognise, the identity key is "descriptor:" followed by exactly normaliseCounterparty(counterpartyText(row)), whose suffix after the namespace is equal character for character to the baseline key, and that its basis is reported as descriptor. A test asserts the same of a row whose stored counterparty account is empty or whitespace only, so no row is ever keyed on a bare namespace, which is the hazard src/modules/merchants/domain/normalise-counterparty.ts:462 through :464 already guards on the descriptor side and which this phase must not reintroduce on the account side. The plan and the code state, and a test asserts, that no truncation, no opening-prefix key and no fallback bucket is ever produced: two such rows share a key only when their full normalised descriptors are equal.
- id: 12.7
  criterion: NO NAMING THE OWNER MADE IS DISCARDED, MEASURED AS EFFECT AND NOT AS ROWS. Against a seeded database holding MerchantRule rows written under the baseline derivation, the test compares the set of (transactionId, merchantId) pairs recompute produces BEFORE the re-derivation with the set it produces AFTER, printing both sizes, and asserts the after set is a SUPERSET of the before set: no transaction that carried a merchant id loses it, and no transaction changes from one merchant to another. SELECT COUNT(*) FROM merchant_rules before and after is reported beside it and is NOT by itself sufficient, and the plan says why: a rule left byte-identical survives as a row and, once the key has changed under it, matches nothing, so the row count is preserved while the naming is dead. The routine prints one line per rule it touched carrying the rule id, the pass, the new basis, the number of transactions the old pattern matched and the number the new pattern matches, and lists separately every rule whose matched count INCREASED, which is the broadening decision D-45 authorises and makes visible. It exits non-zero on exactly two conditions: a merchant-conflict, meaning two rules for DIFFERENT merchants would collide on one new pattern, which is a genuine ambiguity a person must settle; and a LOST assignment, meaning the superset test above fails. Every other outcome, including a rule that could not be promoted, is printed, counted and exits 0, because a rule left safely in place is not a reason to block a deploy. A test asserts the routine issues no UPDATE and no DELETE against any pattern written under the ACCOUNT namespace and never rewrites a descriptor pattern into an account one, so promotion is additive and the declaration the owner made survives the run verbatim, which is what answers pulse-domain section 2's classification of MerchantRule as a declaration the engine does not rebuild. THE TWO BLOCKING CONDITIONS HAVE AN ACKNOWLEDGE PATH, decided deliberately rather than left as an unreachable green: the routine accepts a flag naming the specific rule ids whose conflict or lost assignment a person has seen and accepted, exits 0 for exactly those, and prints them as accepted; a test asserts the flag clears only the ids it names and clears nothing else. No criterion in this phase is met by a run that removed a rule row or lost an assignment.
- id: 12.8
  criterion: THE RE-DERIVATION IS IDEMPOTENT, AND IDEMPOTENT MEANS THE SAME ANSWER RATHER THAN A QUIET ONE. Running the script a second time rewrites zero patterns, adds zero rules, and prints the same DECISION REPORT as the first run, byte for byte, that report being the rule id, the pass that touched it, the resulting basis and the outcome for every rule; and it returns the SAME exit code. The matched-count columns criterion 12.7 requires are EXCLUDED from that comparison, and the criterion says why rather than leaving it to be rediscovered: on the second run a rule's old pattern is the pattern the first run wrote, so for any rule whose rows split across the two bases the counts legitimately differ while the decision does not, and comparing them would turn a CORRECT run red and push the implementer toward a seed containing no split rule, which is the dataset-choosing this criterion exists to forbid. The full merchant_rules table is still compared in full. The test runs against a database seeded to contain at least one rule the routine cannot promote, at least one rule whose matched rows split across the two bases, and at least one merchant-conflict. Requiring exit 0 on the second run would contradict criterion 12.7 on any database holding a conflict, since the routine deletes nothing and the condition therefore persists; an implementer who satisfies the two criteria against two different seeded databases has not met this one.
- id: 12.9
  criterion: FACTS ARE NOT REWRITTEN AND THE CHANGE IS A DERIVATION PLUS A RECOMPUTE. A test asserts the re-derivation issues no write against the transactions table at all, and grep over this phase's steps shows no step that updates a transaction fact field. Separately, the pulse-domain section 2 test: a test clears every transactions.merchantId, runs the existing recompute, and asserts the identical assignment set returns, so the naming survives entirely as a declaration plus a derivation.
- id: 12.10
  criterion: PREFIX AND PATTERN ARE SETTLED. A unit test asserts that a PREFIX rule whose pattern is a proper prefix of an ACCOUNT-basis key returns undefined from matchRules, that a PATTERN rule whose glob matches an account-basis key returns undefined, and that both kinds still match a descriptor-basis key as they do today. A test asserts assignMerchant writes kind EXACT and only EXACT. git diff of the baseline shows NO change to the MerchantRuleKind enum in prisma/schema/merchants.prisma, and grep of prisma/schema/merchants.prisma and src/modules/merchants/domain/merchant-rule.ts shows the stated disposition, that no product surface writes either kind today, in both files.
- id: 12.11
  criterion: THE TWO SCREENS AGREE WHERE THEY ARE MEANT TO. A test runs the merchant review builder and the overview fold over ONE dataset drawn from a single month and asserts that for every row NOT matched by the overview's cash predicate and with options.useTags false, the two produce the same set of unresolved group keys and the same row count per key. Three divergences are named as expected exceptions rather than avoided by choosing a dataset without them, which would be the dataset-choosing hazard H12.8 exists to prevent: the fold branches on cash FIRST into one shared key (src/modules/overview/domain/month-projection.ts:63 through :66) and the review has no cash concept at all (src/modules/merchants/domain/merchant-review.ts:77 through :98); the fold regroups by primary tag when useTags is set (src/modules/overview/domain/month-projection.ts:67 through :74) and the review never does; and the two differ in SCOPE, the overview bounding by booking date (src/modules/overview/adapters/overview-repository.ts:130 through :131) where listCountedTransactions has no date bound (src/modules/merchants/adapters/merchant-repository.ts:229 through :243). The test asserts each divergence at its named site. The SQL pin in test/domain/merchant-review.test.ts is updated to the new fragment and still asserts that fragment appears exactly once in src/modules/overview/adapters/overview-repository.ts and that both reads use it.
- id: 12.12
  criterion: THE MODULE BOUNDARY HOLDS. The MerchantResolver port still has exactly one member, asserted by the existing key-set assertion in test/application/resolve-merchants.test.ts updated to the new member name, so no code path in interpretation can write a MerchantRule. The ledger's own counterpartyKey (src/modules/ledger/domain/corrections.ts:209) is unchanged, asserted by git diff showing no change to src/modules/ledger/domain/corrections.ts, so no flow classification moves.
- id: 12.13
  criterion: NOTHING OF THE OWNER'S DATA REACHES THE REPOSITORY. npm run gate:privacy passes; every identifier in the new fixture is listed in test/fixtures/allowed-identifiers.txt with its provenance; the phase work history reports counts only and quotes no descriptor, counterparty, place, amount or date from either real document; and the branch's commit messages carry no data of any kind.
- id: 12.14
  criterion: THE STANDING GATE. npm run typecheck, npm run lint, npm test and npm run gate:privacy all exit 0, and npm run test:e2e exits 0, each with its captured output in the phase work history.
- id: 12.15
  criterion: THE WHOLE-CORPUS EFFECT IS RECORDED, NOT ONLY THE HAPPY FIXTURE. The phase work history carries one line per committed fixture with the distinct merchant-group count under the baseline derivation and under the new one, produced by a committed script so the numbers can be regenerated. Every fixture whose new count is HIGHER than its baseline count is listed with the reason, and for each such fixture a test asserts that naming both of the split groups with the SAME merchant name lands both under ONE merchant id, so the split is recoverable by the owner rather than permanent.
- id: 12.16
  criterion: THE ACCOUNT BASIS FAILS CLOSED, AND THIS IS THE GUARD ON H12.1 RATHER THAN CRITERION 12.4. A unit test over WHOLLY INVENTED inputs asserts that each of the following yields a DESCRIPTOR-basis key and never an account-basis one: an account that is empty or whitespace after uppercasing and whitespace removal; an account whose country code the pinned country-length table does not carry; an account whose length differs from the length that table assigns its country code; and an account that fails the ISO 7064 mod-97 check. The TRUNCATION case is asserted end to end rather than only as a predicate: the fixture row whose description carries a longer-than-Belgian account written spaced is parsed through the SHIPPED importer, the test asserts the stored account is a strict PREFIX of the invented source value, and asserts that row takes the descriptor basis, so two rows whose sources differ only after the twelfth digit can never share an identity key. THE TABLE CLOSES TRUNCATION DETERMINISTICALLY RATHER THAN PROBABILISTICALLY, and the reason is one sentence: truncation can only ever emit a SIXTEEN-CHARACTER value, so it only reaches accounts whose true length exceeds sixteen, and such a value always carries a country code whose table length is not sixteen. mod-97 alone would leave a residual of roughly one in ninety-seven, measured uniform across source lengths, which is why both tests are required and not either. FIFTH CASE, pinning a behaviour rather than a guard: the fixture row whose description carries two distinct account-shaped tokens is asserted end to end, the test stating which token the generator wrote FIRST and asserting the stored account, and therefore the identity key, is that one, so the first-wins rule at src/modules/import/domain/belfius-current-account-template.ts:266 through :272 is PINNED rather than incidental. The assertion names the parked item that owns the question, so a later change from first-wins to last-wins or longest-wins is red here before it silently moves 4 of the owner's 39 rows. Measured on the real month before this criterion was written, so it is known to cost nothing: all 11 stored accounts pass all three tests and the trusted distinct count is still 6. Every value used is invented and listed in test/fixtures/allowed-identifiers.txt.
- id: 12.17
  criterion: THE RE-DERIVATION HAS ONE NAMED INVOCATION POINT AND ONE STATED ORDER. package.json carries a script that runs scripts/rederive-merchant-rules.ts, asserted by a test that reads package.json and finds it; decision D-46 states that it runs AFTER the code deploy and why that is forced rather than chosen; and the phase work history records the command actually run against the deployed database with its exit code and its printed before-and-after assignment-set sizes, with no pattern content. A phase that ships the routine with no invocation point does not meet this criterion, and neither does one whose work history records only that the routine exists.
- id: 12.18
  criterion: THE RULE SUBJECT IS VALIDATED AT THE WRITE BOUNDARY. assignMerchant returns a typed error, and writes nothing, for a counterpartyText that does not begin with one of the two known namespaces, and for an account-basis subject whose remainder is empty after uppercasing and whitespace removal or fails the trust gate. A test asserts each case, and an e2e test asserts that submitting a PRE-MIGRATION un-namespaced key, which is what a page left open across the deploy submits, surfaces that error to the reader rather than silently writing a rule that can never match anything. This replaces the guard at src/modules/merchants/application/assign-merchant.ts:54 through :57 that step 4 removes, and the phase does not remove that guard without putting this one in its place.
- id: 12.19
  criterion: THE GOVERNING DOCUMENT SAYS WHAT THE CODE DOES. pulse-domain section 7's resolution chain is amended in the same change to state that resolution keys on a namespaced counterparty IDENTITY with two bases, the counterparty account where the row carries a TRUSTED one and the normalised descriptor otherwise, and that PREFIX and PATTERN never apply to an account basis. grep of .claude/skills/pulse-domain/SKILL.md shows the account basis inside that chain and shows no remaining sentence saying the key is the normalised counterparty string.
- id: 12.20
  criterion: THE RESIDUE IS COUNTED AND NAMED, so the size of the problem this phase does NOT solve is a number rather than a decision's prose. The phase work history records, for each real document and for the committed corpus, the number of rows whose identity key is shared with no other row after the change and the number of DISTINCT such keys, alongside the same two counts at the baseline. The record states plainly that a row in that set still needs naming per row, and it names the two documents separately, since the card document is in exactly the same position and the earlier draft of this plan did not say so. No content is recorded.
- id: 12.22
  criterion: THE TRUST TABLE IS PINNED AND SOURCED, in the shape this codebase already uses one tier down for exactly this kind of object (src/modules/merchants/domain/normalise-counterparty.ts:127 through :132: pin the accepted shapes, never widen, with test/domain/normalise-counterparty.test.ts as the pin that makes an accidental edit red). The country-length table is a committed constant in the merchants domain, each entry carrying a country code and a length, with the ISO 13616 registry named as its source in a comment beside it and populated from that registry rather than from the countries seen so far. A regression test pins its FULL contents, so adding, removing or altering an entry is red rather than silent. A separate test asserts the entry for the country of the committed fixtures resolves to the length those fixtures use, so a wrong entry fails the FAST gate rather than only the work-history measurement in criterion 12.2.
- id: 12.21
  criterion: PASS ONE CANNOT LOSE A RULE'S MEANING, FOR ANY KIND. A property test over generated (pattern, key) pairs asserts that for every kind, matchRules applied to the namespaced pattern and the namespaced key returns exactly what matchRules applied to the bare pattern and the bare key returns, and the generator INCLUDES the empty pattern and an already-namespaced pattern among the cases it produces, so pass one's two guards are red rather than unreached: EXACT because equality is preserved under a common prefix, PREFIX because ("descriptor:" + K).startsWith("descriptor:" + P) holds precisely when K.startsWith(P), and PATTERN because the glob is anchored at both ends. A separate assertion covers the case the property test cannot generate: no PREFIX or PATTERN rule produced by pass one ever matches an ACCOUNT-basis key, which is D-40's refusal.

### hazard-classes
- id: H12.1
  statement: The key collapses so far that two genuinely different counterparties become one group, which silently merges the owner's money and is worse than today because today's failure is visible and this one is not. It does NOT enter through stripping, where this phase changes nothing; it enters through the account basis this phase adds, which is a regex scrape out of free text that nothing validates.
  addressed-by: criterion 12.16
- id: H12.2
  statement: Convergence is proved on a fixture built to converge, so the criterion passes and the owner's own month still does not.
  addressed-by: criterion 12.2
- id: H12.3
  statement: The naming the owner has already made is lost when the key changes, because the stored pattern no longer reproduces and nothing notices.
  addressed-by: criterion 12.7
- id: H12.4
  statement: The key is fixed by rewriting stored transaction rows, breaking the rule that facts are immutable.
  addressed-by: criterion 12.9
- id: H12.5
  statement: Real descriptor content from the owner's statements reaches the plan, a fixture, a commit message or a work history while the shape is being reproduced.
  addressed-by: criterion 12.13
- id: H12.6
  statement: A row whose counterparty cannot be identified is given a shortened or bucketed key that quietly groups it with an unrelated row.
  addressed-by: criterion 12.6
- id: H12.14
  statement: A longer-than-Belgian account written spaced is scraped as a sixteen-character PREFIX of itself (src/modules/import/domain/belfius-current-account-template.ts:88), so two different accounts differing only after the twelfth digit are stored as one value and merge into one counterparty. Demonstrated on invented values: both scrape to one identical sixteen-character value.
  addressed-by: criterion 12.16
- id: H12.15
  statement: A stored account that is empty or whitespace only keys every such row on the bare namespace, collapsing unrelated rows into one group, which is the hazard the descriptor side already guards at src/modules/merchants/domain/normalise-counterparty.ts:462.
  addressed-by: criterion 12.6
- id: H12.16
  statement: A description offering two account-shaped tokens has its identity decided by which one the bank printed first (src/modules/import/domain/belfius-current-account-template.ts:266 through :272), measured on 4 of the owner's 39 rows.
  addressed-by: judgment-property-of-prose: choosing between two account-shaped candidates is an IMPORTER decision about a fact column, so it is a template version bump and a re-parse rather than a derivation change, and it cannot be answered inside this phase without rewriting facts. It is carried on the plan's parked surface with its measurement, and until it is answered the trust gate in step 2 means a wrongly chosen candidate that is not a complete valid account takes the descriptor basis rather than merging.
- id: H12.17
  statement: The convergence proof is self-certifying, because the expected row-to-counterparty mapping is transcribed from the implementation's own output rather than authored from the fixture's intent.
  addressed-by: criterion 12.4
- id: H12.25
  statement: Pass one namespaces a pattern that already carries a namespace, so a naming the owner made inside D-46's window is killed on the FIRST run, where a second-run comparison would never see it.
  addressed-by: criterion 12.21
- id: H12.26
  statement: Pass one turns a stored empty pattern, inert today under src/modules/merchants/domain/merchant-rule.ts:65, into a bare namespace that a PREFIX rule matches every descriptor key with.
  addressed-by: criterion 12.21
- id: H12.27
  statement: The idempotence check compares matched counts that legitimately differ between runs, so a CORRECT run goes red and the implementer seeds around it with a database containing no split rule.
  addressed-by: criterion 12.8
- id: H12.28
  statement: The country-length table is edited, trimmed or mistyped and nothing goes red, so a country silently leaves the account basis and every row of that counterparty stops converging.
  addressed-by: criterion 12.22
- id: H12.29
  statement: A later change to the importer's first-wins candidate selection silently moves the identity of 4 of the owner's 39 rows, because the behaviour is parked as a question and pinned by nothing.
  addressed-by: criterion 12.16
- id: H12.18
  statement: A rule survives as a row while its EFFECT dies, because the key changed under it, and a row-count check reports the migration clean.
  addressed-by: criterion 12.7
- id: H12.19
  statement: The re-derivation blocks a deploy that can never go green again, because a condition it can never clear returns a non-zero exit forever and no acknowledge path exists.
  addressed-by: criterion 12.7
- id: H12.20
  statement: The routine is shipped with nowhere to run from, so the migration is described rather than performed and criterion 12.7's exit code is observed by nobody.
  addressed-by: criterion 12.17
- id: H12.21
  statement: assignMerchant loses its normalisation and gains no replacement guard, so a stale page writes a rule subject that can never match.
  addressed-by: criterion 12.18
- id: H12.22
  statement: pulse-domain section 7 keeps describing a resolution chain the code no longer implements, and it is loaded into every task's context.
  addressed-by: criterion 12.19
- id: H12.23
  statement: The headline numbers are recorded against a harness nobody else can run, so the measurement cannot be checked without rewriting it.
  addressed-by: criterion 12.2
- id: H12.24
  statement: The rows that still cannot converge are never counted, so the owner is told the promise is kept while a bounded number of rows on their own month still need naming per row.
  addressed-by: criterion 12.20
- id: H12.7
  statement: A new descriptor family is induced from one month of one bank and over-fires on a shape nobody has seen, which is the failure src/modules/merchants/domain/normalise-counterparty.ts:127 through :132 already forbids one tier down.
  addressed-by: criterion 12.5
- id: H12.8
  statement: The merchant review and the month view disagree about what a group is, because the rule is written once in TypeScript and once in SQL and only one of them changes.
  addressed-by: criterion 12.11
- id: H12.9
  statement: Moving CSV rows from name-keyed to account-keyed splits a merchant that is paid through two accounts, and the split is discovered by the owner rather than by this phase.
  addressed-by: criterion 12.15
- id: H12.10
  statement: The resolver is handed a raw text somewhere that was missed, and it silently resolves nothing rather than failing, because the port still accepts a string.
  addressed-by: criterion 12.12
- id: H12.11
  statement: The identity change reaches flow classification through the ledger's own counterparty key, so resolution reclassifies instead of only renaming and regrouping.
  addressed-by: criterion 12.12
- id: H12.12
  statement: The re-derivation is run twice, by a redeploy or by hand, and the second run mangles patterns the first run already rewrote.
  addressed-by: criterion 12.8
- id: H12.13
  statement: A PREFIX or PATTERN rule, written by hand or by a later slice, matches an account-basis key on a prefix of an account number and merges two counterparties.
  addressed-by: criterion 12.10

### migrations
None. The identity is carried in the pattern string's namespace prefix rather than in a new column, so MerchantRule keeps its shape and the MerchantRuleKind enum is unchanged. What this phase ships instead is a one-off re-derivation of DECLARATION rows (merchant_rules patterns), run by a committed idempotent script, followed by the existing recompute. No DDL, no Prisma migration, no schema drift.

### conflicts-with
- M3-P8, M3-P10 and M3-P11 (same component, src/modules/merchants/ui/merchant-review.tsx, which all three edit; M3-P11 also src/modules/merchants/ui/actions.ts): runs strictly BEFORE all three, never beside them, per decision D-44.
- M3-P9 (no shared file: M3-P9's set is styles/tokens.css, src/app/globals.css, playwright.config.ts and test/e2e/, and this phase touches none of them): recorded as checked rather than left to be assumed, since decision D-44 rests on it.

### parallelizable
false

### citations
- R-005
- R-010a
- DR-0027

# Environment warnings

# Fleet environment warnings

Appended to every composed brief. Facts, measured in this fleet's container.

1. AMBIENT DATABASE CREDENTIALS BELONG TO ANOTHER PROJECT. The shell
   environment carries DATABASE_URL, DIRECT_URL and SUPABASE_* variables
   pointing at a deployed Supabase pooler for a different project (Hemma).
   Shell env OVERRIDES .env for Prisma. Never run a database command with
   ambient env: pin connection strings explicitly to the local stack (or
   the pulse deployed project when, and only when, the task is
   deploy-verify). The first unpinned migrate attempt in M1-P1 targeted
   the foreign host and failed with P1001; nothing executed, but only
   because the host was unreachable.
2. Node: the container default is Node 22; the tiphys CLI needs Node 26.
   For any tiphys command run first: export NVM_DIR=/opt/nvm &&
   . /opt/nvm/nvm.sh
3. Prisma 6.19 has an AI-agent consent guard on migrate reset; npm 11.19
   blocks lifecycle scripts unless package.json allowScripts covers them
   (committed in the repo's package.json). Both are handled in the
   repository; do not fight them ad hoc.
4. Outbound HTTPS goes through a TLS-reterminating proxy with CA bundle
   /root/.ccr/ca-bundle.crt. npm is pre-wired. Do not disable TLS
   verification anywhere.
5. Deployed database endpoints for the pulse Supabase project: the
   direct connection AND the transaction pooler both live on the
   IPv6-only db.ygsarzjqosqmkqibqogk.supabase.co host and are
   unreachable from IPv4-only environments (Vercel included). The
   SESSION POOLER (aws-0-eu-central-1.pooler.supabase.com:5432, project
   ref in the username) is the only IPv4 endpoint and serves BOTH
   DATABASE_URL and DIRECT_URL in deployed environments. Local work
   keeps using the local supabase stack, pinned per warning 1.
6. Ambient foreign SUPABASE_* and DATABASE_URL variables override .env for
   the Playwright webServer as well as Prisma: when running npm run
   test:e2e, pin all five values (DATABASE_URL, DIRECT_URL,
   NEXT_PUBLIC_SUPABASE_URL, the publishable key and the secret key) to
   the local stack in the invoking shell, not only the Prisma pair.
7. The local auth stack accumulates e2e users across runs: any supabase
   admin listUsers existence check must paginate (the one-page check in
   prisma/seed.ts broke db:reset past 50 auth users; fixed in M1-P4).
8. Playwright positional test filters substring-match the full path
   INCLUDING the worktree directory name; in fleet worktrees use -g to
   target tests. After sudo dockerd, the supabase auth container needs
   roughly 30 seconds before seeding or admin API calls succeed. Next.js
   infers a workspace root when multiple lockfiles are visible; fleet
   worktrees can trip this, pin turbopack.root or ignore the warning
   knowingly.
9. The real statement uploads' FILE NAMES themselves embed identifiers
   (an IBAN plus statement date; a document reference). Never write the
   full filenames into any note, commit, or report: refer to the uploads
   by their 8-hex prefix only (0f79fa3d = KBC card, 39bada64 = Belfius
   current account; the M3-P2 dispatch had this mapping backwards). One
   leak via notes happened in M3-P2 and was scrubbed with a history
   rewrite before anything consumed the branch.
10. The container's disk fills up: each worktree clone carries ~1GB of
    node_modules, and a full root filesystem manifests as MOVING
    chromium "Page crashed" e2e failures (CR-903 root cause, 54MB free
    at the time), not as a disk error. Before dispatching gate or e2e
    work, check df; delete node_modules/.next from closed-phase
    worktrees freely (regenerable; commits live in git).
11. HARD RULE, owner 2026-08-22: no data of any kind goes into a commit
    message. No amount, no counterparty, no date from a row, no account
    or card number, not even an invented one. A message says what
    changed and why. It never carries a sample of the data, because a
    reviewer reading a message cannot tell an invented figure from a
    real one, and that is exactly how the M3-P3 leak survived three
    pushes. The same applies to prose in reports, verdicts and notes.
    Invented values live in fixtures only, and every account or card
    number in the tree is listed with its provenance in
    test/fixtures/allowed-identifiers.txt. `npm run gate:privacy`
    enforces both halves, joins the standing gate line in CLAUDE.md, and
    fails on any identifier that is not on that list, so a value taken
    from a real statement stops the build rather than reaching a review.
12. THE PULSE REPOSITORY IS PUBLIC and the owner has decided on
    2026-08-22 (DR-0024) that it stays public. Everything you commit is
    world-readable the moment it is pushed, and history keeps it after
    any later correction. Two real merchant descriptors, naming a shop
    and a parking location taken from a real statement while drafting a
    design mockup, reached it that way and were found by BOTH clean-room
    lanes on M3-P3, not by any gate. `npm run gate:privacy` cannot see a
    merchant name, a place name, a date or an amount inside a file,
    because those look exactly like invented ones; its own header now
    says so. Before you commit anything you wrote while looking at a
    real document, read it back line by line and check every string
    yourself. Checking one file of a set and generalising is exactly how
    this got through.
13. `npx supabase start` fails in this container and the error names the
    wrong component: an rlimit failure is printed right after "Starting
    database from backup", but the process actually asking for a nofile
    limit above the container's hard ceiling of 20000 is the
    edge-runtime container, and `cap_sys_resource` is dropped so nothing
    can raise it. Workaround, found in M3-P7: set `enabled = false`
    under `[edge_runtime]` in supabase/config.toml, start the stack,
    then revert. That file is TRACKED, so revert it before committing or
    the change lands in the repository.
