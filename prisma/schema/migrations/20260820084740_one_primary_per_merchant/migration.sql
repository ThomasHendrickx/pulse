-- One primary tag per merchant, enforced STRUCTURALLY (fix round 1,
-- finding CR-401). The adapter's demote-then-promote runs under read
-- committed, where two concurrent promotes can each demote a snapshot
-- that misses the other's uncommitted primary and commit two primaries
-- (witnessed against the pre-fix adapter: 19 of 20 probe rounds). No
-- interleaving defeats a partial unique index: the losing promote fails
-- loudly instead of writing a second primary.
--
-- Hand-authored SQL: Prisma cannot model a partial index, so this
-- migration is deliberately outside the schema file. `prisma migrate
-- diff` ignores index predicates it does not model, so drift detection
-- does not try to drop it (probed empirically in the M1-P4 fix round;
-- see delivery/work-history/m1-p4-notes.md). The index is asserted by
-- name and predicate in test/application/resolve-merchants.test.ts, so
-- losing this statement reddens the fast gate.
CREATE UNIQUE INDEX "merchant_tags_one_primary_per_merchant"
  ON "merchant_tags"("merchantId")
  WHERE "isPrimary";
