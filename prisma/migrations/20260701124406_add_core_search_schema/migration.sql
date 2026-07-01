-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "alias_type" AS ENUM ('canonical_title', 'display_title', 'artist', 'romanized_title', 'english_title', 'translated_title', 'content', 'abbreviation', 'common_name', 'alternate_spelling');

-- CreateEnum
CREATE TYPE "availability_status" AS ENUM ('available', 'not_available', 'temporarily_unavailable', 'unknown');

-- CreateTable
CREATE TABLE "songs" (
    "id" VARCHAR(128) NOT NULL,
    "original_language" VARCHAR(16) NOT NULL,
    "canonical_title" VARCHAR(512) NOT NULL,
    "display_title" VARCHAR(512) NOT NULL,
    "canonical_artist" VARCHAR(512) NOT NULL,
    "release_year" INTEGER,
    "tie_in" VARCHAR(512),
    "source_url" TEXT,
    "source_name" VARCHAR(256),
    "verified_by" VARCHAR(128) NOT NULL,
    "verification_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "songs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "song_aliases" (
    "id" VARCHAR(160) NOT NULL,
    "song_id" VARCHAR(128) NOT NULL,
    "alias" VARCHAR(512) NOT NULL,
    "language" VARCHAR(16) NOT NULL,
    "alias_type" "alias_type" NOT NULL,
    "normalized_alias" VARCHAR(512) NOT NULL,
    "chosung_alias" VARCHAR(512),
    "source_url" TEXT,
    "source_name" VARCHAR(256),
    "verified_by" VARCHAR(128) NOT NULL,
    "verification_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "song_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "karaoke_providers" (
    "id" VARCHAR(128) NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "country" VARCHAR(2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "source_url" TEXT,
    "source_name" VARCHAR(256),
    "verified_by" VARCHAR(128) NOT NULL,
    "verification_note" TEXT,
    "last_catalog_updated_at" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "karaoke_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "karaoke_entries" (
    "id" VARCHAR(192) NOT NULL,
    "song_id" VARCHAR(128) NOT NULL,
    "provider_id" VARCHAR(128) NOT NULL,
    "karaoke_number" VARCHAR(64) NOT NULL DEFAULT '',
    "version_info" VARCHAR(256) NOT NULL DEFAULT '',
    "availability_status" "availability_status" NOT NULL,
    "last_verified_at" DATE,
    "source_url" TEXT,
    "source_name" VARCHAR(256) NOT NULL,
    "verified_by" VARCHAR(128),
    "verification_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "karaoke_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "songs_original_language_idx" ON "songs"("original_language");

-- CreateIndex
CREATE INDEX "songs_display_title_idx" ON "songs"("display_title");

-- CreateIndex
CREATE INDEX "songs_canonical_title_idx" ON "songs"("canonical_title");

-- CreateIndex
CREATE INDEX "songs_canonical_artist_idx" ON "songs"("canonical_artist");

-- CreateIndex
CREATE INDEX "song_aliases_normalized_alias_idx" ON "song_aliases"("normalized_alias");

-- CreateIndex
CREATE INDEX "song_aliases_chosung_alias_idx" ON "song_aliases"("chosung_alias");

-- CreateIndex
CREATE INDEX "song_aliases_language_type_idx" ON "song_aliases"("language", "alias_type");

-- CreateIndex
CREATE UNIQUE INDEX "song_aliases_song_normalized_type_key" ON "song_aliases"("song_id", "normalized_alias", "alias_type");

-- CreateIndex
CREATE INDEX "karaoke_providers_active_default_idx" ON "karaoke_providers"("is_active", "is_default");

-- CreateIndex
CREATE INDEX "karaoke_providers_country_active_order_idx" ON "karaoke_providers"("country", "is_active", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "karaoke_providers_country_name_key" ON "karaoke_providers"("country", "name");

-- CreateIndex
CREATE INDEX "karaoke_entries_provider_status_idx" ON "karaoke_entries"("provider_id", "availability_status");

-- CreateIndex
CREATE INDEX "karaoke_entries_song_status_idx" ON "karaoke_entries"("song_id", "availability_status");

-- CreateIndex
CREATE INDEX "karaoke_entries_last_verified_at_idx" ON "karaoke_entries"("last_verified_at");

-- CreateIndex
CREATE UNIQUE INDEX "karaoke_entries_song_provider_version_number_key" ON "karaoke_entries"("song_id", "provider_id", "version_info", "karaoke_number");

-- AddForeignKey
ALTER TABLE "song_aliases" ADD CONSTRAINT "song_aliases_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "karaoke_entries" ADD CONSTRAINT "karaoke_entries_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "karaoke_entries" ADD CONSTRAINT "karaoke_entries_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "karaoke_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
