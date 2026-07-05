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
