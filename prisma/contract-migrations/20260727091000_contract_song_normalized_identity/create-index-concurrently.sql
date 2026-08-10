-- ADMIN-T03 rollout step 7a: build the unique index without blocking writes.
-- Run this file as its own database command because PostgreSQL forbids
-- CREATE INDEX CONCURRENTLY inside a transaction block.
CREATE UNIQUE INDEX CONCURRENTLY
  "songs_normalized_canonical_title_artist_key"
  ON "songs" ("normalized_canonical_title", "normalized_canonical_artist");
