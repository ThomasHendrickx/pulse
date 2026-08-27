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
-- removed, where "whitespace" means EXACTLY the set JavaScript's \s
-- matches. CORRECTED IN THE M3-P18 FIX ROUND (hazard finding
-- HZ-M3P18-01, clause R-087), and the superseded wording is quoted
-- rather than deleted: this comment used to say "The whitespace class is
-- written [[:space:]] and not a backslash-s on purpose" and the
-- statement below stripped bare [[:space:]]. That was NOT a mirror:
-- witnessed live on Postgres 16.13 (C.utf8), [[:space:]] retains U+00A0,
-- U+202F and U+FEFF, all of which \s strips, so an NBSP-spaced stored
-- rendering (0xA0 is one byte in Windows-1252, the common Belgian export
-- encoding) stayed at its SQL fixed point, the canonical lookup still
-- missed it, and the new canonical duplicate check refused the retype: a
-- full lockout for exactly the household this migration exists to let
-- back in. The class now unions the POSIX class with every remaining
-- ECMAScript WhiteSpace and LineTerminator member, as visible ARE
-- escapes (U+200B is deliberately absent: \s does not match it). The
-- one authoritative copy for importable code is
-- ACCOUNT_NUMBER_SQL_WHITESPACE_CLASS in src/platform/account-number.ts;
-- this file cannot import, so test/domain/canonical-backfill.test.ts
-- asserts this inlined class is byte-equal to that constant, and the
-- agreement with the platform function is asserted BY TEST over the
-- committed SQL (test/e2e/canonical-backfill.spec.ts) over renderings
-- that include the divergent characters, never by reading.
--
-- EDITED IN PLACE RATHER THAN FOLLOWED UP: at the time of this fix round
-- the migration existed only on the unmerged phase branch and had been
-- applied to throwaway review clusters only, so no deployed database
-- carries the superseded statement and an in-place correction is the
-- honest form; a shipped migration would instead have needed a follow-up
-- file with the same collision guard.
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
SET "iban" = upper(regexp_replace(a."iban", '[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', '', 'g'))
WHERE a."iban" IS NOT NULL
  AND a."iban" IS DISTINCT FROM upper(regexp_replace(a."iban", '[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', '', 'g'))
  AND NOT EXISTS (
    SELECT 1
    FROM "accounts" b
    WHERE b."householdId" = a."householdId"
      AND b."id" <> a."id"
      AND b."iban" IS NOT NULL
      AND upper(regexp_replace(b."iban", '[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', '', 'g'))
          = upper(regexp_replace(a."iban", '[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', '', 'g'))
  );
