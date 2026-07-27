-- ADMIN-T03 rollout step 7b: contract.
-- Run only after preflight, idempotent backfill, drift verification, and the
-- null/empty/exact-duplicate gates all report zero violations.
-- This file is intentionally staged outside prisma/migrations. Promote it to a
-- later Prisma migration only after the expand release and data gates finish.
-- First execute create-index-concurrently.sql as a separate database command.

BEGIN;

ALTER TABLE "songs"
  ADD CONSTRAINT "songs_normalized_identity_not_null"
  CHECK (
    "normalized_canonical_title" IS NOT NULL
    AND "normalized_canonical_artist" IS NOT NULL
  ) NOT VALID;

ALTER TABLE "songs"
  VALIDATE CONSTRAINT "songs_normalized_identity_not_null";

ALTER TABLE "songs"
  ALTER COLUMN "normalized_canonical_title" SET NOT NULL,
  ALTER COLUMN "normalized_canonical_artist" SET NOT NULL;

ALTER TABLE "songs"
  ADD CONSTRAINT "songs_normalized_canonical_title_artist_key"
  UNIQUE USING INDEX "songs_normalized_canonical_title_artist_key";

ALTER TABLE "songs"
  DROP CONSTRAINT "songs_normalized_identity_not_null";

COMMIT;
