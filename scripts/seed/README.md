# Seed Scripts

Seed validation, add, dry-run, import, and search smoke commands are reserved for
`[M1-T06]` through `[M1-T09]`.

Current state after `[M1-T07]`:

- `npm run seed:validate` validates the default `seed/` directory.
- `npm run seed:validate -- --seed-dir path/to/fixture` validates another seed
  directory with the same four CSV files.
- `npm run seed:add-song` appends a generated-ID song row to `songs.csv`.
- `npm run seed:add-alias` appends a generated-ID alias row to
  `song_aliases.csv`.
- `npm run seed:add-entry` appends a generated-ID entry row to
  `karaoke_entries.csv`.
- Validation errors are printed with `file row N` where a row is involved.
- Any error exits non-zero. Warning-only validation exits zero.
- `last_verified_at` values older than 180 days are warnings.
- Dry-run/import and search smoke commands are not implemented yet.
- Scripts must treat `seed/*.csv` headers as the source of truth for column order.
- Provider rows must be read from CSV/DB data. Do not hardcode specific provider names or IDs.
- Add/import commands must preserve existing CSV headers and avoid adding
  placeholder data.

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
