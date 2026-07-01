# Seed Scripts

Seed validation, add, dry-run, import, and search smoke commands are reserved for
`[M1-T06]` through `[M1-T09]`.

Current state for `[M1-T04]`:

- No seed CLI is implemented in this directory yet.
- Scripts must treat `seed/*.csv` headers as the source of truth for column order.
- Provider rows must be read from CSV/DB data. Do not hardcode specific provider names or IDs.
- Future add/import commands must preserve existing CSV headers and avoid adding placeholder data.
