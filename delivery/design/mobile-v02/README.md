# Mobile month view, owner-approved mockup (v0.2)

Static design reference for the mobile-first rebuild of the month view and
the merchant review screen. Approved by the owner on 2026-08-22 ("mobile ok
and a go") after the shipped desktop-only month view was graded unusable on
a phone. Recorded as DR-0022 in the fleet.

These files are a reference, not a component library and not a source of
truth for copy. They are hand-written HTML with inline styles so they can be
opened in a browser with no build step. The product implements the same
layout using design tokens from `src/app/globals.css`; no value here is
copied into a component as a literal.

| File | Screen |
|---|---|
| `Main.dc.html` | Month view, books close |
| `BooksDoNotClose.dc.html` | Month view, reconciliation gap present |
| `MerchantReview.dc.html` | Merchant review |
| `DenseAlternate.dc.html` | Month view, denser row variant considered and not chosen |
| `canvas.json` | Layout of the four frames as reviewed |

All names, amounts and account numbers are invented. `BE00 0000 0000 0000`
is deliberately not a valid IBAN.

Correction, 2026-08-22: that sentence was false when first written. Two
merchant descriptors in `MerchantReview.dc.html` named a real shop and a real
parking location, carried over from reading a real statement while drafting
the frames, and they were committed to this public repository before anyone
noticed. A hazard review found them. They are replaced above, but they remain
in this repository's history at commit b560e85 until that history is dealt
with. Treat the claim in the paragraph above as something to verify against
each frame, not as something that was checked once.

What the mockup fixes, in order of why it exists:

1. Two-line rows. Name and amount on line one, row count and month-over-month
   delta on line two. The desktop three-column row does not survive 360px.
2. Tap targets of at least 44px on every row that navigates or opens.
3. Amounts right-aligned in the mono face, so a column of figures reads as a
   column at any width.
4. Tag names as subheads inside the spend card rather than a separate level
   of nesting.
5. The reconciliation panel high on the page, not below the fold: whether the
   books close is the first thing the screen answers.
6. One column throughout. Income, spend and reserves stack in that order;
   the rail is a widening of this layout, not the other way round.
