# Seed Data

This directory contains the CSV inputs used to seed the MVP karaoke search data.
The CSV files are the contract shared by the later validation, add, dry-run, and
import scripts.

## Files

- `karaoke_providers.csv`: karaoke provider metadata, display order, and default flag.
- `songs.csv`: canonical song records.
- `song_aliases.csv`: searchable aliases for titles, artists, romanization, translations, content names, abbreviations, and common names.
- `karaoke_entries.csv`: provider-specific karaoke numbers, versions, availability, and verification metadata.

Each CSV is UTF-8 and comma-separated. Rows in these four files are treated as
real seed inputs by downstream seed tools, so do not add unverified placeholder
providers, placeholder songs, or sample karaoke numbers here.

## Staging Data

`seed/staging/initial_songs.csv` is an optional working file for drafting the
initial real seed candidate set in one row per song. It is a review aid only and
is not read by `seed:validate`, `seed:import`, or `seed:search-smoke`.

AI may help prepare that staging CSV, but AI-generated karaoke numbers,
availability statuses, sources, and verification fields are not trusted data.
Only rows checked by a person, with source and reviewer metadata recorded, may be
converted into the normalized import CSVs above. See
`seed/staging/README.md` for the column contract and manual conversion
procedure.

## Header Contract

Column names and order follow `데이터 시드 명세 v0.1` exactly. Do not reorder,
rename, or remove columns without updating the seed validation/import scripts and
the spec together.

Expected headers:

```csv
# karaoke_providers.csv
id,name,country,is_active,display_order,is_default,source_url,source_name,verified_by,verification_note

# songs.csv
id,original_language,canonical_title,display_title,canonical_artist,release_year,tie_in,source_url,source_name,verified_by,verification_note

# song_aliases.csv
id,song_id,alias,language,alias_type,normalized_alias,chosung_alias,source_url,source_name,verified_by,verification_note

# karaoke_entries.csv
id,song_id,provider_id,karaoke_number,version_info,availability_status,last_verified_at,source_url,source_name,verified_by,verification_note
```

Provider names and provider counts are data, not application constants. Do not
hardcode specific providers in scripts, application code, or default CSV rows.

## Follow-up Flow

Later milestone tasks will add:

- `seed:validate`: check file presence, headers, required values, enums, FK links, duplicates, and generated normalization values.
- `seed:add-*`: append rows while preserving the existing header and column order.
- `seed:import --dry-run` and `seed:import`: validate first, then upsert the full file set into PostgreSQL in provider, song, alias, entry order.
