-- Canonical backfill of stored account-number DECLARATIONS (M3-P18,
-- criterion 18.4; review finding P14-001's live exposure closed).
--
-- WHY. Account rows written before M3-P14 hold whatever the import path
-- wrote, verbatim from a delimited cell, and a Belgian statement prints
-- its accounts SPACED. The built lookup canonicalises the probe and
-- exact-matches the stored column, so a pre-P14 spaced rendering never
-- matches and a statement for an account the household in fact holds is
-- refused as unregistered with no remedy any screen names. This
-- migration rewrites every stored accounts.iban to the canonical form.
--
-- WHAT MAY MOVE. Account.iban is a DECLARATION, which is what makes the
-- rewrite legal (pulse-domain section 2); this migration touches the
-- accounts table only and NO transaction column. A fact column, the
-- stored counterparty included, is never rewritten.
--
-- THE CANONICAL FORM IS AN SQL MIRROR of canonicalAccountNumber in
-- src/platform/account-number.ts: uppercase, every whitespace character
-- removed. The whitespace class is written [[:space:]] and not a
-- backslash-s on purpose, the same POSIX-class rule the overview
-- repository's reserves join records at
-- src/modules/overview/adapters/overview-repository.ts (the mirror rule
-- and the whitespace-class lesson); the agreement between this
-- expression and the platform function is asserted BY TEST over the
-- committed SQL (test/e2e/canonical-backfill.spec.ts), never by reading.
--
-- CANONICALISATION WITHOUT VALIDATION, deliberately (review findings
-- P14-006 and P17-004): canonicalisation is total and returns a string
-- for any input, so a stored number that FAILS the validity test is
-- backfilled to its canonical form and goes on working. Nothing here
-- validates, refuses or nulls a row.
--
-- ORDERING, and why the duplicate check comes first: where two rows of
-- one household share one canonical form, an unconditional rewrite makes
-- the unique index on (householdId, iban) fire mid-migration and the
-- deploy die on data. So the NOT EXISTS below detects such a pair FIRST,
-- leaves BOTH of its rows exactly as they are, and the statement
-- completes over every other row. The pair is left DETECTABLE rather
-- than named into a channel nothing captures: prisma migrate deploy
-- surfaces no output this repository may point at, so the naming lives
-- in the committed read-only script scripts/detect-account-collisions.ts
-- and this migration stays silent. Repairing the pair (a merge that
-- moves transactions) is real migration work this phase deliberately
-- does not carry.
--
-- IDEMPOTENT AND A NO-OP WHERE THERE IS NOTHING TO DO: a second run
-- finds every rewritten row already canonical (the IS DISTINCT FROM
-- filter matches nothing), and over a household whose stored numbers are
-- already canonical it changes nothing. A card account's NULL iban is
-- untouched throughout.

UPDATE "accounts" a
SET "iban" = upper(regexp_replace(a."iban", '[[:space:]]', '', 'g'))
WHERE a."iban" IS NOT NULL
  AND a."iban" IS DISTINCT FROM upper(regexp_replace(a."iban", '[[:space:]]', '', 'g'))
  AND NOT EXISTS (
    SELECT 1
    FROM "accounts" b
    WHERE b."householdId" = a."householdId"
      AND b."id" <> a."id"
      AND b."iban" IS NOT NULL
      AND upper(regexp_replace(b."iban", '[[:space:]]', '', 'g'))
          = upper(regexp_replace(a."iban", '[[:space:]]', '', 'g'))
  );
