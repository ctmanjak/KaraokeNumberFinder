# Seed Scripts

Seed validation, add, dry-run, import, and search smoke commands are reserved for
`[M1-T06]` through `[M1-T09]`.

Current state after `[M1-T09]`:

- `npm run seed:validate` validates the default `seed/` directory.
- `npm run seed:validate -- --seed-dir path/to/fixture` validates another seed
  directory with the same four CSV files.
- `npm run seed:import -- --dry-run` validates the default `seed/` directory
  and prints planned create/update/skip operations without changing the DB.
- `npm run seed:import` validates the default `seed/` directory and upserts the
  CSV set in one transaction.
- `npm run seed:import -- --seed-dir path/to/fixture --dry-run` runs dry-run
  against another seed directory.
- `npm run seed:import -- --seed-dir path/to/fixture` imports another seed
  directory.
- `npm run seed:search-smoke` verifies that imported seed aliases match the
  expected `song_id` values in `seed/search-smoke.csv`.
- `npm run seed:search-smoke -- --fixture path/to/file` uses another smoke
  fixture.
- `npm run seed:add-song` appends a generated-ID song row to `songs.csv`.
- `npm run seed:add-alias` appends a generated-ID alias row to
  `song_aliases.csv`.
- `npm run seed:add-entry` appends a generated-ID entry row to
  `karaoke_entries.csv`.
- Validation errors are printed with `file row N` where a row is involved.
- Any error exits non-zero. Warning-only validation exits zero.
- `last_verified_at` values older than 180 days are warnings.
- Scripts must treat `seed/*.csv` headers as the source of truth for column order.
- Provider rows must be read from CSV/DB data. Do not hardcode specific provider names or IDs.
- Add/import commands must preserve existing CSV headers and avoid adding
  placeholder data.

## Search smoke CLI usage

`seed:search-smoke` expects migrations and seed import to already be applied to
the database selected by `DATABASE_URL`. It does not import seed data itself.

```sh
npm run seed:search-smoke
npm run seed:search-smoke -- --fixture path/to/search-smoke.csv
```

Fixture columns:

```csv
query,expected_song_id,label
잔혹한 천사의 테제,song_ja_0001,hangul display title
Zankoku na Tenshi,song_ja_0001,romanized title
신세기 에반게리온,song_ja_0001,content alias
ㅈㅎㅎ,song_ja_0001,hangul chosung
레몬,song_ja_0006,hangul display title
Kenshi Yonezu,song_ja_0006,artist alias
수평선,song_ja_0011,hangul display title
back number,song_ja_0011,artist alias
```

Each row runs the shared normalization rules against `SongAlias.normalized_alias`
using exact, prefix, and partial matching. Two-or-more-character Hangul chosung
queries also match `SongAlias.chosung_alias` by prefix. One-character chosung
queries, fuzzy matching, and typo correction are intentionally excluded.

Failures exit non-zero and print the fixture row, query, expected `song_id`, and
the actual matched `song_id` list.

## Import CLI usage

`seed:import` always runs seed validation before planning or writing. If
validation has errors, no DB plan is created and no upsert is attempted.

```sh
npm run seed:import -- --dry-run
npm run seed:import
npm run seed:import -- --seed-dir path/to/fixture --dry-run
npm run seed:import -- --seed-dir path/to/fixture
```

Import order is fixed:

1. `karaoke_providers.csv`
2. `songs.csv`
3. `song_aliases.csv`
4. `karaoke_entries.csv`

Rows are upserted by `id`. The import runs as a single file-set transaction, so
one failed row rolls back the full set. Rows removed from CSV are not deleted
from the database.

The report includes file-level `create`, `update`, `skip`, `warning`, and
`error` counts. It also prints a row-level plan so operators can inspect the
planned operation for each CSV row. `--dry-run` performs the same validation and
planning queries but does not write to the database.

## Add CLI usage

All add commands support `--seed-dir path/to/fixture`. Missing required values
are prompted interactively. Optional values are left blank unless passed as
arguments.

```sh
npm run seed:add-song -- \
  --original-language ja \
  --canonical-title "Original Title" \
  --display-title "Display Title" \
  --canonical-artist "Artist" \
  --verified-by ops_member

npm run seed:add-alias -- \
  --song-id song_ja_0001 \
  --alias "Display Title" \
  --language en \
  --alias-type english_title \
  --verified-by ops_member

npm run seed:add-entry -- \
  --song-id song_ja_0001 \
  --provider-id provider_alpha \
  --karaoke-number 12345 \
  --version-info Original \
  --availability-status available \
  --last-verified-at 2026-07-01 \
  --source-name "Generic provider source" \
  --verified-by ops_member
```

`seed:add-alias` derives `normalized_alias` and `chosung_alias` from the alias
text. Non-Hangul aliases get a blank `chosung_alias`.

`seed:add-entry` reads valid providers from `karaoke_providers.csv`. If
`--provider-id` is omitted, the command prints the provider IDs from the CSV
before prompting. Provider names and IDs are never hardcoded in the scripts.

After a row is appended, each command runs seed validation. Validation errors
exit non-zero and include the affected file and row where available.
