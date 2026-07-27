ALTER TABLE "songs"
  DROP CONSTRAINT IF EXISTS "songs_normalized_canonical_title_artist_key";

ALTER TABLE "songs"
  DROP COLUMN IF EXISTS "normalized_canonical_title",
  DROP COLUMN IF EXISTS "normalized_canonical_artist";
