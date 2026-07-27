-- ADMIN-T03 rollout step 7: contract.
-- Run only after preflight, idempotent backfill, drift verification, and the
-- null/empty/exact-duplicate gates all report zero violations.
-- This file is intentionally staged outside prisma/migrations. Promote it to a
-- later Prisma migration only after the expand release and data gates finish.
ALTER TABLE "songs"
  ALTER COLUMN "normalized_canonical_title" SET NOT NULL,
  ALTER COLUMN "normalized_canonical_artist" SET NOT NULL;

ALTER TABLE "songs"
  ADD CONSTRAINT "songs_normalized_canonical_title_artist_key"
  UNIQUE ("normalized_canonical_title", "normalized_canonical_artist");
