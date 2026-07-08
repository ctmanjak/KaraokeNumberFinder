-- Enable trigram operator support for ILIKE candidate searches.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Apply the M2-Perf-14 recommendation for normalized alias exact/prefix/contains ILIKE.
CREATE INDEX CONCURRENTLY "song_aliases_normalized_alias_trgm_idx"
ON "song_aliases" USING gin ("normalized_alias" gin_trgm_ops);

-- Rollback:
-- DROP INDEX CONCURRENTLY IF EXISTS "song_aliases_normalized_alias_trgm_idx";
-- DROP EXTENSION "pg_trgm"; -- only if no other database objects depend on it.
