# Initial Seed Staging CSV

`initial_songs.csv` is a working CSV for `[M1-T16a]` only. It is not a DB import
input, and seed scripts must continue to validate and import the normalized CSV
set in `seed/`:

- `karaoke_providers.csv`
- `songs.csv`
- `song_aliases.csv`
- `karaoke_entries.csv`

Use this file to draft 10-20 candidate songs in one row per song before human
review. AI may help fill candidate song metadata and alias candidates, but AI
output is not verified seed data. Do not copy any karaoke number, availability
status, source, or verification field into the final seed CSVs until a person
has checked the source.

## Columns

- `seed_song_key`: staging-only stable key, such as `candidate_001`. It can be
  used to derive the final `songs.csv.id`, but is not imported directly.
- `original_language`: ISO 639-1 language code for the original song, such as
  `ja`, `en`, `zh`, or `ko`.
- `canonical_title`: original or canonical title.
- `display_title`: Korean-user-facing title. Use the common Korean title only
  after review; otherwise keep the canonical title.
- `canonical_artist`: representative artist name.
- `release_year`: four-digit release year when verified; otherwise blank.
- `tie_in`: short content context such as work title, OP, ED, or insert song.
- `aliases`: semicolon-separated alias candidates in
  `alias|language|alias_type|source_name|source_url|note` form. Allowed
  `alias_type` values are the values accepted by `song_aliases.csv`.
- `provider_entries`: semicolon-separated provider entry candidates in
  `provider_id|karaoke_number|version_info|availability_status|last_verified_at|source_name|source_url|verified_by|note`
  form. `provider_id` must already exist in `karaoke_providers.csv` before final
  conversion.
- `song_source_url`, `song_source_name`: source used to verify song metadata.
- `entry_source_url`, `entry_source_name`: source used to verify provider entry
  status or karaoke number. Prefer the provider's official/public search.
- `entry_last_verified_at`: `YYYY-MM-DD` date for provider entry review when a
  row uses a shared verification date. Per-entry dates in `provider_entries`
  override this field.
- `verified_by`: human reviewer identifier. Leave blank until a person has
  checked the relevant source.
- `verification_note`: review notes, ambiguity, or reason a candidate should not
  be converted yet.

## Writing Rules

- Treat every row as unverified until `verified_by` and the relevant source
  fields are filled by a person.
- AI-generated karaoke numbers are prohibited. Leave `karaoke_number` blank
  until a person verifies a provider source.
- AI-generated availability is not authoritative. Use `unknown` for unverified
  provider entries, or leave `provider_entries` blank.
- Use `not_available` only when a person explicitly verified that the provider
  does not list the song.
- Use `available` only when `karaoke_number`, `last_verified_at`, `source_name`,
  and `verified_by` are human-verified.
- Do not add lyrics, album art, audio links, or scraped bulk data.
- Do not hardcode provider names, provider IDs, or provider count in scripts,
  tests, API code, or UI code. Provider IDs come from `karaoke_providers.csv`.

## Conversion Procedure

1. Confirm provider rows first in `karaoke_providers.csv`. There must be exactly
   one active default provider, and provider values must remain data-driven.
2. For each reviewed staging row, add one row to `songs.csv`. Use stable IDs,
   fill required fields, and copy only verified song source fields.
3. Split `aliases` into one or more `song_aliases.csv` rows. Generate
   `normalized_alias` and `chosung_alias` with `npm run seed:add-alias` or the
   shared normalization rules; do not hand-enter guessed search fields.
4. Split each verified `provider_entries` item into `karaoke_entries.csv`.
   `available` rows require `karaoke_number`, `last_verified_at`, and
   `verified_by`. `not_available` and `temporarily_unavailable` rows must keep
   `karaoke_number` blank. Unverified rows should stay out of the final CSVs or
   remain `unknown` without a guessed number.
5. Run `npm run seed:validate`. Fix any validation errors before import or
   dry-run.
6. Optionally run `npm run seed:import -- --dry-run` after validation when the
   DB is available.

The conversion can be scripted in a later ticket. For T16a, this staging file
and procedure are the source of truth for manual review and conversion.
