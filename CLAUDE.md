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

## Commands

```bash
npm run dev           # local dev server
npm run typecheck     # tsc --noEmit
npm run lint
npm test              # fast gate: unit and property tests
npm run test:e2e      # slow gate: Playwright
npm run db:reset      # prisma migrate reset against local Docker Postgres
npm run db:migrate    # prisma migrate dev
```

`npm run typecheck && npm run lint && npm test` must pass before any slice is considered done. `npm run test:e2e` must pass before a slice is closed.

## Stack

Next.js App Router, TypeScript, Prisma, Postgres (Supabase in deployed environments, Docker locally), Tailwind v4, Playwright, Vitest. Claude API server side only, and only from slice 5 onward.

## Scope discipline

The plan is deliberately lean and the list of things left out is deliberate, not an oversight. Do not add: a queue, cron, an event bus, caching, a state management library, a component library, per-transaction overrides, or goal and budget features. If a task seems to need one, say so and stop rather than adding it.
