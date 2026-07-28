-- ADMIN-T03 rollout step 1: nullable expand.
-- Application dual-write and the explicit preflight/backfill command must run
-- successfully before the contract migration is applied.
ALTER TABLE "songs"
  ADD COLUMN "normalized_canonical_title" VARCHAR(512),
  ADD COLUMN "normalized_canonical_artist" VARCHAR(512);
