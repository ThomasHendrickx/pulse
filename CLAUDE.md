# Pulse

Personal finance overview for a Belgian household. Bank CSV exports in, one month view out: where income came from, what was spent, what moved to reserves.

This file is always in context, so it holds only what applies to every task. Depth lives in skills.

## Skills

| Skill | Read it before |
|---|---|
| `pulse-domain` | Anything touching accounts, imports, transactions, flow, merchants, tags, reconciliation, or module structure |
| `pulse-frontend` | Anything touching React, Next.js, routes, server actions, styling, or the design system |
| `pulse-typescript` | Anything touching types, errors, money values, dates, or test structure |

If a task touches two, read both.

## Non-negotiables

1. **npm.** Never pnpm, never yarn. `npm run`, `npm install`, `npm test`.
2. **English everywhere in the codebase.** Code, types, comments, commits, file and folder names, URL paths, DB columns, API routes. Dutch and French exist only as translated user-facing content. Never a Dutch or French URL path.
3. **Amounts are integer cents.** Never a float, never a JS `number` for a monetary total in the database.
4. **No literal colours, font sizes or spacing in components.** Only design tokens. Missing token means add it to `tokens.css` first.
5. **Facts are immutable.** Imported transaction rows are never updated to fix an interpretation. See `pulse-domain`.
6. **Every table carries `householdId`.** Every query filters on it.
7. **No em dashes** in code comments, docs, commit messages or user-facing copy. Use a comma, colon, parenthesis or a new sentence.
8. **No data in a commit message.** No amount, no counterparty, no date from a row, no account or card number, not even an invented one. A commit message says what changed and why; it never carries a sample of the data. Invented values live in fixtures and nowhere else, and every account or card number in the tree, masked or bare, is listed with its provenance in `test/fixtures/allowed-identifiers.txt`. `npm run gate:privacy` decides three things and must pass with the other gates: commit messages on the branch carry no data, every identifier shape in the tree is on the allow list, and no tracked PDF carries a compressed stream. It decides nothing else. A merchant name, a place name or an amount sitting inside a file is invisible to it, because those look exactly like invented ones. Two real merchant descriptors reached this public repository that way. Before committing anything drawn from a real document, read it back and check it yourself; the gate narrows the hole, it does not close it.

9. **An owner decision is final.** A decision record in `delivery/decisions/` whose status is `decided` is closed. Never ask the owner a question they have already answered. Never re-open a decided decision in a review, a fix round or a plan iteration. Never read its consequences back to the owner as if they had not been weighed, and never ask them to confirm an instruction they gave because the agent who received it did not write it down: the fault there is the missing record, and the fix is to write one. A decided decision is reversed only by the owner, in a NEW record naming the one it supersedes. A reviewer who thinks a decided decision is wrong records the consequence as a finding against the WORK and leaves the decision standing. `npm run gate:decisions` enforces the mechanical half: a decided record whose question or decision changes with nothing superseding it fails, and so does a third adversarial review round on one plan iteration. The judgement half it cannot see, so it is written here instead.

10. **Two review rounds per lane, then build.** Every review lane, adversarial plan review and clean-room review alike, gets at most two rounds. The criteria lane and the hazard lane are counted separately, which is what dual review needs; a third round on either one fails `gate:decisions`. Whatever round two leaves open is carried into the implementer's brief as work. A third round costs the owner delivery and buys a precision they did not ask for.

## Commands

```bash
npm run dev           # local dev server
npm run typecheck     # tsc --noEmit
npm run lint
npm test              # fast gate: unit and property tests
npm run gate:privacy  # no data in commit messages, no unknown identifiers in the tree
npm run gate:decisions # a decided decision is unchanged, and no third review round
npm run test:e2e      # slow gate: Playwright
npm run db:reset      # prisma migrate reset against local Docker Postgres
npm run db:migrate    # prisma migrate dev
```

`npm run typecheck && npm run lint && npm test && npm run gate:privacy && npm run gate:decisions` must pass before any slice is considered done. `npm run test:e2e` must pass before a slice is closed.

## Stack

Next.js App Router, TypeScript, Prisma, Postgres (Supabase in deployed environments, Docker locally), Tailwind v4, Playwright, Vitest. Claude API server side only, and only from slice 5 onward.

## Talking to the owner

This session is compacted and resumed often. Before reporting anything to the
owner, read `/home/user/pulse-fleet/notes/owner-ledger.md`, and append to it
the same turn. It records what they have already been told, what they have
already decided, and which corrections have already been issued. Without it
the same conclusions get re-derived from the same branches and delivered
again as if new, which is what happened up to 2026-08-27.

## Scope discipline

The plan is deliberately lean and the list of things left out is deliberate, not an oversight. Do not add: a queue, cron, an event bus, caching, a state management library, a component library, per-transaction overrides, or goal and budget features. If a task seems to need one, say so and stop rather than adding it.
