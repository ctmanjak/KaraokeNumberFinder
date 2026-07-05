# Perf Scripts

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

The output always marks `dataset.scale_scenario` as `current_seed`. Future
synthetic scale runs should use a distinct `--dataset-label` and update the
scale scenario contract before comparing those numbers with current seed results.

## EXPLAIN ANALYZE

`perf:explain` runs the `[M2-Perf-02]` read-only PostgreSQL plan inspection for
representative search cases selected from the same search smoke fixture. It does
not change DB rows, Prisma schema, migrations, indexes, `.env`, or generated
Prisma Client files.

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
