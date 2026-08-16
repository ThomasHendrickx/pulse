---
name: pulse-frontend
description: How Pulse builds its user interface: Next.js App Router conventions, server versus client component rules, server actions, the design token system, money and date rendering, i18n across English, Dutch and French, and the specific UI states this product must handle (partial month, unreconciled books, unresolved counterparties, unmatched transfer legs, empty state). Read this before creating or editing any React component, page, layout, route, server action, form, or stylesheet, and before adding any colour, font size or spacing value. Also read it before rendering a monetary amount anywhere, because Pulse has one mandatory way to do that and getting it wrong is a visible product defect.
---

# Pulse frontend

## 1. Server first

Everything is a React Server Component by default. `"use client"` is an exception that needs a reason, and the reason is one of: local interactive state, an event handler, or a browser API.

When a client component is needed, push it to the leaf. A page is a server component that renders a small client island, never a client component that fetches.

- Data fetching happens in server components, calling the module's **application layer**, never Prisma directly and never a module's repository.
- Mutations are server actions, and a server action does one thing: resolve the household context, call one use case, revalidate. No business logic in a server action.
- No client-side fetching library, no state management library, no `useEffect` for data.

Routes:

```
app/
  (auth)/sign-in/
  (app)/
    layout.tsx           household context, nav
    page.tsx             month view, the default route
    import/
    merchants/
```

URL paths are English only. Never a Dutch or French path segment.

## 2. Where UI code lives

**The frontend is not a separate architecture. It is the `ui/` layer of the same vertical modules.**

DDD splits into two halves here, and only one crosses into the UI.

| DDD | In the frontend |
|---|---|
| Ubiquitous language | Yes, strongly. Components are named in domain terms |
| Bounded contexts, module boundaries | Yes. Same modules, same dependency rule |
| Entities, value objects, aggregates, repositories | No. There is no client-side domain model |

There is no browser-side state worth modelling. Server components call the application layer and render. So there is no frontend repository, no store, no entity class, and above all **no second copy of the domain types**. Import the domain types; do not mirror them into frontend types.

```
app/                          routes: thin composition only
  (app)/page.tsx              calls overview/ui, lays it out
modules/
  overview/ui/                MonthView, IncomeBlock, SpendBlock, ReconciliationPanel
  import/ui/                  UploadDropzone, ProfileConfirmation, AccountDeclaration
  merchants/ui/               MerchantReviewList, UnresolvedBadge
platform/ui/                  Amount, Button, Table, Eyebrow, Field
```

**`app/` routes stay thin.** Next.js imposes a horizontal structure by URL. A route file resolves the household context, calls into module UI, and arranges it. No fetching logic, no domain logic, no substantive markup. That is what stops the framework's structure from becoming the architecture.

**Cross-module UI goes through a published `ui/index.ts`,** the same rule as `application/index.ts`. The overview module may render `merchants`' `UnresolvedBadge`. It may not reach into that module's internals.

**The test for `platform/ui` versus a module: a component in `platform/ui` may not know what a transaction is.** `Amount` takes cents and renders them, so it is a primitive. `SpendBlock` knows about merchants and flow, so it belongs to a module. If a primitive starts needing domain vocabulary, move it.

**Name components in domain language.** `ReconciliationPanel`, not `SummaryCard`. `ReserveMovements`, not `TransfersList`. The ubiquitous language should reach the DOM.

This holds because Pulse is a Next.js monolith with server components and no meaningful client state. A separate SPA against an API would be its own bounded context and the answer would differ. Do not generalise this rule to other projects.

## 3. Design tokens

`tokens.css` defines primitives and semantic tokens. `theme.css` maps them to Tailwind.

**No component may contain a literal `oklch()`, hex colour, px font size, or px spacing value.** If a token is missing, add it to `tokens.css` first, then use it. This rule is what keeps the design system alive past week two.

Use semantic tokens, not primitives. `--color-ink-subtle`, not `--pulse-grey-400`.

### Colour semantics

| Token | Used for | Never used for |
|---|---|---|
| `--color-ink`, `-muted`, `-subtle` | All text, including every amount | |
| `--color-flag` | Unresolved counterparty, unmatched transfer leg. Needs attention, is not broken | Errors |
| `--color-alarm` | Books that do not reconcile. That is all | Spending, negative amounts, warnings |
| `--color-link` | Links and focus rings | Emphasis |

**There is deliberately no income colour and no spend colour.** Both render in `--color-ink`. Income and spend are directions, not verdicts. Do not add a green and red pair, do not colour negative amounts red, and do not use arrows or trend indicators that imply a judgement. Pulse reports, the user decides.

## 4. Money rendering

Every monetary amount, everywhere, uses the `.pulse-amount` treatment: mono font, `tabular-nums slashed-zero`, right aligned, no wrapping. No exceptions, including inside sentences and tooltips.

Format with `Intl.NumberFormat` against the Belgian locale so the thousands separator is `.` and the decimal separator is `,`: `1.234,56`. Never hand-roll the formatting, never use `toFixed` for display.

Amounts arrive from the domain as **integer cents**. Convert to a display string at the rendering boundary and nowhere else. Never do arithmetic on a formatted string, and never let a float reach a component.

## 5. The states that matter

The happy path is the easy part. These states are the product, and each has a Playwright assertion.

| State | Requirement |
|---|---|
| **Empty** | Before the first import. It is the first screen anyone sees. Explain what to drop in and that Pulse never connects to a bank |
| **Partial month** | The current month is incomplete. Mark it in progress with the hatch pattern token, and make comparison visibly not apply. It must not read as a collapse in spending |
| **Books do not reconcile** | Show the unexplained difference and name the likely cause. This is the only place `--color-alarm` appears |
| **Unresolved counterparties** | Normal, not an error. Use `--color-flag`. Say plainly that they are already counted in the totals and naming only moves them into the right group |
| **Unmatched transfer leg** | Flagged, excluded from both sides, with a note saying which export is missing |

Never hide an unknown to make a screen look clean. A hidden unknown is what makes totals lie.

## 6. Layout

Income, spend and reserves are not symmetric and must not be rendered as three equal columns. Income is a handful of large stable rows, spend is dozens of grouped rows and is where attention goes, reserves is one to three rows. Spend takes the wide column, income and reserves sit in the rail (`--layout-rail`).

Comparison against the previous month is part of the primary view, not a separate mode.

Desktop first. The import is a desk activity. Mobile is not a v1 target and no effort is spent on it.

## 7. Copy and i18n

Language order everywhere: English, Dutch, French. English is the source, the other two are translations.

Mechanism: next-intl, message catalogs in `/messages/{en,nl,fr}.json`, seeded from the design prototype's copy deck. No user-facing string is hardcoded in a component; a grep gate enforces it. Keys are domain-named (`reconciles`, `unmatchedNote`), not screen-positional (`header2Label`).

Dutch and French run longer than English, often much longer. Nothing may depend on short text: no fixed-width buttons, no single-line labels that cannot wrap, no truncation of anything the user needs.

Copy rules specific to this product:

- Neutral register. Never congratulate, never warn about spending, never imply the user did well or badly.
- A normal-but-incomplete state is described plainly, not apologetically.
- **Never promise that Pulse will never connect to a bank.** It holds only the rows you import, which is true and stays true when bank connections arrive later. Do not write a trust claim the roadmap breaks.

## 8. What not to add

No component library, no card grid dashboard with KPI tiles, no gauges or progress rings, no sparklines without a readable scale, no gradient hero, no animation beyond state transitions that aid comprehension, no dark mode in v1.

Accessibility basics are not optional: real buttons and labels, visible focus rings via `--focus-ring`, and amounts that remain legible at 11px, which is what `slashed-zero` is for.
