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
-- matches. THE CLASS NAMES NO POSIX CLASS; it enumerates code points.
--
-- CORRECTED TWICE, BOTH TIMES LOUDLY (clause R-087), with both
-- superseded wordings quoted rather than deleted.
--
--   FIRST (M3-P14, superseded wording): "The whitespace class is written
--   [[:space:]] and not a backslash-s on purpose". The statement stripped
--   bare [[:space:]] and that was not a mirror: witnessed on Postgres
--   16.13 under the libc C.utf8 ctype, [[:space:]] retains U+00A0,
--   U+202F and U+FEFF, all of which \s strips, so an NBSP-spaced stored
--   rendering (0xA0 is one byte in Windows-1252, the common Belgian
--   export encoding) stayed at its SQL fixed point, the canonical lookup
--   still missed it, and the canonical duplicate check refused the
--   retype: a full lockout for exactly the household this migration
--   exists to let back in.
--
--   SECOND (the M3-P18 fix round's first attempt, hazard finding
--   HZ-M3P18-01; superseded wording): "The class now UNIONS THE POSIX
--   CLASS with every remaining ECMAScript WhiteSpace and LineTerminator
--   member". Keeping [[:space:]] inside the class kept the mirror
--   locale-dependent, because what a POSIX class matches is a property
--   of the CLUSTER'S ctype and not of this file. MEASURED on one
--   Postgres 16.13 cluster, sweeping every code point from 1 to
--   U+10FFFF through the committed expression under two collations: the
--   libc C.utf8 collation stripped exactly the 25 \s members, while the
--   ICU "und" collation stripped 30, adding U+001C, U+001D, U+001E,
--   U+001F and U+0085, none of which \s matches. Over-stripping is the
--   worse failure of the two: this migration would rewrite a stored
--   declaration into a form canonicalAccountNumber can never produce,
--   the row would be permanently unmatchable by the canonical lookup,
--   and the original rendering would be gone, so no re-run could repair
--   it, while the migration reported success.
--
-- THE CLASS BELOW therefore enumerates exactly the 25 members of \s as
-- visible ARE escapes and nothing else (U+200B is deliberately absent:
-- \s does not match it). The one authoritative copy for importable code
-- is ACCOUNT_NUMBER_SQL_WHITESPACE_CLASS in
-- src/platform/account-number.ts; this file cannot import, so
-- test/domain/canonical-backfill.test.ts extracts EVERY regexp_replace
-- pattern below, asserts there are exactly four of them, and asserts
-- each one is byte-equal to that constant (a pin holding one occurrence
-- let single-site drift through, hazard finding HZ2-M3P18-01). The
-- EXECUTED agreement with the platform function is asserted by test over
-- this committed SQL (test/e2e/canonical-backfill.spec.ts), over the
-- UNION of the two whitespace sets code point by code point rather than
-- over a chosen sample, never by reading.
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
SET "iban" = upper(regexp_replace(a."iban", '[\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', '', 'g'))
WHERE a."iban" IS NOT NULL
  AND a."iban" IS DISTINCT FROM upper(regexp_replace(a."iban", '[\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', '', 'g'))
  AND NOT EXISTS (
    SELECT 1
    FROM "accounts" b
    WHERE b."householdId" = a."householdId"
      AND b."id" <> a."id"
      AND b."iban" IS NOT NULL
      AND upper(regexp_replace(b."iban", '[\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', '', 'g'))
          = upper(regexp_replace(a."iban", '[\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', '', 'g'))
  );
