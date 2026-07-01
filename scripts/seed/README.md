# Seed Scripts

Seed validation, add, dry-run, import, and search smoke commands are reserved for
`[M1-T06]` through `[M1-T09]`.

Current state after `[M1-T06]`:

- `npm run seed:validate` validates the default `seed/` directory.
- `npm run seed:validate -- --seed-dir path/to/fixture` validates another seed
  directory with the same four CSV files.
- Validation errors are printed with `file row N` where a row is involved.
- Any error exits non-zero. Warning-only validation exits zero.
- `last_verified_at` values older than 180 days are warnings.
- Seed add, dry-run/import, and search smoke commands are not implemented yet.
- Scripts must treat `seed/*.csv` headers as the source of truth for column order.
- Provider rows must be read from CSV/DB data. Do not hardcode specific provider names or IDs.
- Future add/import commands must preserve existing CSV headers and avoid adding placeholder data.
