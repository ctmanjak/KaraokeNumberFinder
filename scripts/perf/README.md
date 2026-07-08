# Perf Scripts

See `scripts/perf/search-optimization-decision.md` for the `[M2-Perf-04]`
decision that synthesizes baseline, EXPLAIN, and Prisma query-shape findings.
See `scripts/perf/synthetic-scale-plan.md` for the `[M2-Perf-08]` measurement
standard before running or interpreting synthetic-scale search perf results.
See `scripts/perf/synthetic-dataset-contract.md` for the `[M2-Perf-09]`
synthetic dataset generation/import, fixture, and validation contract that must
be implemented before synthetic-scale measurements are trusted.
See `scripts/perf/search-index-strategy-spike.md` for the `[M2-Perf-14]`
local-only PostgreSQL index strategy spike on the
`synthetic-10k-songs-100k-aliases` dataset.

Current-seed runs and synthetic-scale runs must be interpreted separately:

- `current-seed` is for correctness, fixture coverage, noise-floor, route/query
  count, and remote round-trip diagnosis.
- `synthetic-1k-songs-10k-aliases` and
  `synthetic-10k-songs-100k-aliases` are future isolated local/sandbox datasets
  for index, trigram, query rewrite, payload trimming, and pagination gates.
- Synthetic data generation/import must follow the synthetic dataset contract;
  do not load synthetic data into Neon or use broad iterations against Neon.

## Synthetic Dataset Generation and Import

`perf:dataset-generate` creates deterministic synthetic CSV datasets for local
or sandbox search-scale work. It writes generated output under
`tmp/synthetic-datasets/<dataset_label>/` by default; this directory is ignored
by git and the generated CSV files should not be committed.

```sh
npm run perf:dataset-generate -- --dataset-label synthetic-1k-songs-10k-aliases
npm run perf:dataset-generate -- --dataset-label synthetic-10k-songs-100k-aliases
npm run perf:dataset-generate -- --dataset-label synthetic-1k-songs-10k-aliases --output-root /private/tmp/karaoke-synthetic-datasets
```

Each generated dataset directory contains:

- `karaoke_providers.csv`
- `songs.csv`
- `song_aliases.csv`
- `karaoke_entries.csv`
- `search-synthetic-scale.csv`
- `dataset-metadata.json`

Supported dataset labels:

| Dataset label                      |  Songs | Aliases | Providers | Entry target  |
| ---------------------------------- | -----: | ------: | --------: | ------------- |
| `synthetic-1k-songs-10k-aliases`   |  1,000 |  10,000 |         6 | 2,000-5,000   |
| `synthetic-10k-songs-100k-aliases` | 10,000 | 100,000 |        12 | 20,000-50,000 |

`dataset-metadata.json` records `dataset_label`, `generator_version`, fixed
`random_seed`, deterministic `generated_at`, row counts, fixture path, required
case IDs, and safety notes. `search-synthetic-scale.csv` includes all required
case IDs from the contract, including exact, prefix, contains, chosung,
suggestion, provider-filter, partial-pressure, and payload-fanout cases.

Synthetic import is local/sandbox only. Use the synthetic import wrapper:

```sh
npm run perf:dataset-import -- \
  --seed-dir tmp/synthetic-datasets/synthetic-1k-songs-10k-aliases \
  --db-label local \
  --dry-run

npm run perf:dataset-import -- \
  --seed-dir tmp/synthetic-datasets/synthetic-1k-songs-10k-aliases \
  --db-label local
```

The wrapper reuses the existing seed import logic after enforcing synthetic
guards. `--db-label local` or `--db-label sandbox` is required unless
`--allow-synthetic-import-to-local` is passed. Labels such as `neon`,
`production`, `prod`, and `live` are rejected, and a `DATABASE_URL` that looks
like Neon/live/prod-like infrastructure is rejected even when a local label is
provided. The same guard also runs when `seed:import -- --seed-dir <generated>`
points at a synthetic dataset directory.

Validate generated synthetic datasets before any synthetic-scale search work:

```sh
npm run perf:dataset-validate -- \
  --dataset-label synthetic-1k-songs-10k-aliases \
  --seed-dir tmp/synthetic-datasets/synthetic-1k-songs-10k-aliases \
  --files-only

npm run perf:dataset-validate -- \
  --dataset-label synthetic-1k-songs-10k-aliases \
  --seed-dir tmp/synthetic-datasets/synthetic-1k-songs-10k-aliases \
  --db-label local
```

`--files-only` and its alias `--no-db` validate only the generated directory and
do not require `DATABASE_URL`. DB mode is read-only and only runs `count()`
queries scoped by `verificationNote == dataset_label` for songs, aliases,
entries, and providers. DB validation requires `--db-label local` or
`--db-label sandbox`; labels such as `neon`, `production`, `prod`, and `live`
are rejected, and prod-like `DATABASE_URL` values are rejected before a Prisma
client is created.

The JSON report includes dataset label, metadata status, file row counts,
fixture coverage, DB row counts when enabled, and explicit errors/warnings.

`perf:baseline` runs the `[M2-Perf-01]` read-only baseline harness against the
database selected by the current environment. It does not import seed data,
write application rows, create migrations, or change `.env`.

```sh
npm run perf:baseline
npm run perf:baseline -- --db-label local --dataset-label current-seed
npm run perf:baseline -- --db-label neon --dataset-label current-seed --iterations 5 --warmup 1
npm run perf:baseline -- --output perf-results/local-current-seed.json
```

Options:

- `--db-label <label>` records the measured DB target, for example `local` or `neon`.
- `--dataset-label <label>` records the dataset, defaulting to `current-seed`.
- `--fixture <path>` reads representative search terms from `seed/search-smoke.csv` by default.
- `--iterations <n>` sets measured iterations per scenario. Default: `10`.
- `--warmup <n>` sets unrecorded warm-up iterations per scenario. Default: `3`.
- `--output <path>` writes the same JSON report printed to stdout.

The report is JSON with `schema_version: 1`. It includes commit, branch, Node
version, DB label, dataset label, current seed row counts, and scenario rows for:

- `GET /api/search`
- direct `searchSongs()`
- `GET /api/providers`
- direct `listProviders()`

Each scenario records p50/p95/min/max/avg latency, total measured request time,
wrapper-level query count, response size, status, params, and the dataset label.
API scenarios execute route handlers in-process with `Request`/`Response`
objects, so they include route parsing and JSON serialization but exclude
Next.js dev server and network overhead.

Query count is counted by wrapping the Prisma client methods used by the service
interfaces. Prisma SQL query logging is not enabled because logging itself can
distort timings. Nested relation loading may map to more SQL statements than the
wrapper count reports; later `EXPLAIN ANALYZE` and Prisma query-shape tickets
should use this harness output to choose representative cases for SQL-level
inspection.

The output marks `dataset.scale_scenario` as `current_seed` for non-synthetic
dataset labels and `synthetic_future` for labels that start with `synthetic-`.
Synthetic scale runs should use a distinct `--dataset-label` before comparing
those numbers with current seed results.

## EXPLAIN ANALYZE

`perf:explain` runs the `[M2-Perf-02]` read-only PostgreSQL plan inspection for
representative search cases selected from the same search smoke fixture. It does
not change DB rows, Prisma schema, migrations, indexes, `.env`, or generated
Prisma Client files.
The script sets a 30s PostgreSQL `statement_timeout` and a 35s client
`query_timeout` on its `pg` Pool so a single EXPLAIN cannot hold a connection
indefinitely.

```sh
npm run perf:explain
npm run perf:explain -- --db-label local --dataset-label current-seed
npm run perf:explain -- --db-label neon --dataset-label current-seed --case-limit 2
npm run perf:explain -- --output perf-results/local-current-seed-explain.json
```

Options:

- `--db-label <label>` records the DB target, for example `local` or `neon`.
- `--dataset-label <label>` records the dataset, defaulting to `current-seed`.
- `--fixture <path>` reads representative search terms from `seed/search-smoke.csv` by default.
- `--case-limit <n>` limits representative cases. Use this for Neon or shared DBs.
- `--output <path>` writes the same JSON report printed to stdout.

The script emits JSON with `schema_version: 1`, run metadata, current seed row
counts, selected representative cases, and one row per query plan. Each plan row
records:

- query shape and parameterized SQL
- params used for the representative case
- rows planned, rows scanned/filtered, rows returned
- sort occurrence and sort methods
- index usage and index names
- sequential scan occurrence and relation names
- planning/execution time and raw PostgreSQL JSON plan

Search candidate SQL mirrors the current `searchSongs()` candidate `where`,
`orderBy`, and `take` structure:

- `normalized_alias ILIKE $1` for Prisma case-insensitive equals approximation
- `normalized_alias ILIKE ($1 || '%')` for startsWith
- `normalized_alias ILIKE ('%' || $1 || '%')` for contains
- `chosung_alias ILIKE ($1 || '%')` for Korean chosung startsWith
- `song_aliases.id = ANY($1::varchar[])` for detail lookup
- detail lookup joined with `songs` and `karaoke_entries` as an approximation of `aliasRecordSelect()`
- active provider lookup used by `searchSongs()`
- active/default provider lookup for index inspection
- `GET /api/providers` country/active/order lookup

The relation detail SQL is intentionally documented as an approximation:
Prisma may load selected relations with internal SQL that differs from the
single JOIN used here. This ticket records the DB plan shape without rewriting
application queries.

For Neon or production-like databases, use a small `--case-limit` and keep the
default one-pass execution. Do not use this script as a load test.

## Prisma Query Shape

`perf:query-shape` runs the `[M2-Perf-03]` read-only Prisma query-shape and
N+1 inspection. It reuses representative search cases from `seed/search-smoke.csv`
and keeps the result separate from the baseline latency and EXPLAIN plan
reports.

```sh
npm run perf:query-shape
npm run perf:query-shape -- --db-label local --dataset-label current-seed
npm run perf:query-shape -- --db-label neon --dataset-label current-seed --case-limit 2
npm run perf:query-shape -- --output perf-results/local-current-seed-query-shape.json
npm run perf:query-shape -- --no-sql-events
```

Options:

- `--db-label <label>` records the DB target, for example `local` or `neon`.
- `--dataset-label <label>` records the dataset, defaulting to `current-seed`.
- `--fixture <path>` reads representative search terms from `seed/search-smoke.csv` by default.
- `--case-limit <n>` limits representative search cases. Use a small value for Neon.
- `--output <path>` writes the same JSON report printed to stdout.
- `--no-sql-events` disables Prisma query event logging and records only client method counts.

The report emits JSON with `schema_version: 1`, run metadata, current seed row
counts, and scenario rows for:

- direct `searchSongs()`
- in-process `GET /api/search`
- direct `listProviders()`
- in-process `GET /api/providers`
- valid provider filter, invalid provider, and no-result suggestions paths

Each scenario separates wrapper-level Prisma client method counts from actual
SQL query event counts:

- `client_method_count` counts service-facing Prisma method calls, grouped by model method and query shape.
- `actual_sql_query_count` counts Prisma `$on("query")` events when SQL events are enabled.
- `candidate_alias_id_groups` records the executed candidate query group count, condition shape, `take`, and returned IDs. Exact/prefix candidate spans may overlap, while lower-priority chosung/contains spans can be skipped or staged; use scenario-level `sql_events` to inspect the emitted candidate SQL.
- `unique_alias_id_count` and `alias_detail_lookup.id_in_count` record the deduped alias IDs used by the detail `song_aliases.id IN (...)` lookup.
- `alias_detail_lookup.sql` records the actual SQL emitted for the detail lookup span.
- `relation_load_observation` classifies `aliasRecordSelect()` relation loading as single join, batched relation load, possible N+1, no candidates, or unavailable.

The expected current Prisma search shapes are:

- active provider lookup before each `searchSongs()` call
- `normalized_alias` equals candidate lookup
- `normalized_alias` startsWith candidate lookup
- `normalized_alias` contains candidate lookup when higher-ranked candidates are insufficient
- `chosung_alias` startsWith candidate lookup when the query has usable two-or-more Korean initials and higher-ranked candidates are insufficient
- deduped `song_aliases.id IN (...)` alias detail lookup with selected `song` and `karaokeEntries`
- suggestions lookup only when no search items are returned
- provider list lookup for `GET /api/providers` and direct `listProviders()`

Prisma query event logging is intentionally limited to this diagnostic script.
It can add observer overhead, allocate extra event objects, and distort latency,
so use `perf:baseline` for timing and `perf:query-shape` for query count/shape.
If Prisma event logging or an adapter version does not emit usable query events,
the report still records client method counts and marks `actual_sql_query_count.available`
as `false` when run with `--no-sql-events`.

For Neon or production-like databases, keep `--case-limit` low and avoid repeated
runs. This script does not import seed data, mutate DB rows, change Prisma schema,
create migrations, add indexes, update `.env`, or modify generated Prisma Client
files.

## API Route Timing

`GET /api/search` can emit diagnostic timing headers when the request includes
`x-perf-timing: 1` or `__perf_timing=1`. Normal requests do not include these
headers and the response body shape is unchanged.

Example against a running dev server:

```sh
curl -sS -D /tmp/search-headers.txt \
  -H 'x-perf-timing: 1' \
  'http://127.0.0.1:3000/api/search?q=잔혹한%20천사의%20테제'
```

The response includes `server-timing` and `x-perf-timing` headers with route
parse/search/json timings and `searchSongs()` substeps such as provider lookup,
candidate lookup group, alias detail lookup, ranking, and response item mapping.
Use this only for diagnostics; it is intended to explain end-to-end API latency
that is not visible from `perf:baseline` or `perf:query-shape` alone.
