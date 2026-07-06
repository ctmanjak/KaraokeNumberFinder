# M2-Perf-08 Synthetic Scale Search Measurement Plan

Last updated: 2026-07-06

## Scope

This document defines the measurement standard for `[M2-Perf-08] synthetic
scale search performance. It is a decision gate for future index, trigram,
query rewrite, payload trimming, and pagination work.

This ticket does not generate or import synthetic data. It does not change
Prisma schema, migrations, indexes, generated Prisma Client, DB data, `.env`,
search behavior, or API payloads.

The generation/import, fixture CSV, deterministic seed, and row-count validation
contract is defined separately in
`scripts/perf/synthetic-dataset-contract.md`. Synthetic-scale measurements must
not start until that contract has an implemented local/sandbox dataset and a
passing validation report.

## Measurement Split

Current-seed and synthetic-scale runs answer different questions and must not be
mixed in the same conclusion.

| Run family       | Dataset labels                                                       | Purpose                                                                                 |
| ---------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Current seed     | `current-seed`                                                       | Correctness, fixture coverage, noise floor, remote DB round-trip and query-count checks |
| Synthetic scale  | `synthetic-1k-songs-10k-aliases`, `synthetic-10k-songs-100k-aliases` | Search strategy, scan pressure, relation payload, and scale decision gates              |
| Future synthetic | `synthetic-50k-songs-500k-aliases`                                   | Placeholder for post-MVP or catalog-size stress checks                                  |

Current-seed latency must be interpreted primarily as app path, network,
connection, and query-count evidence. Synthetic-scale latency and EXPLAIN output
are required before schema/index/search-strategy changes.

## Dataset Labels and Targets

Use the exact dataset label in every perf command and output filename.

| Dataset label                      |  Songs | Aliases |       Entries | Providers | Required before run              | Purpose                                                  |
| ---------------------------------- | -----: | ------: | ------------: | --------: | -------------------------------- | -------------------------------------------------------- |
| `current-seed`                     |     15 |     100 |            16 |         4 | Existing seed only               | Correctness/noise-floor and query-count verification     |
| `synthetic-1k-songs-10k-aliases`   |  1,000 |  10,000 |   2,000-5,000 |      4-10 | Isolated local or sandbox import | First realistic threshold for candidate scan behavior    |
| `synthetic-10k-songs-100k-aliases` | 10,000 | 100,000 | 20,000-50,000 |      4-20 | Isolated local or sandbox import | Prefix/contains/chosung scan pressure and payload growth |
| `synthetic-50k-songs-500k-aliases` | 50,000 | 500,000 |     100k-250k |      4-30 | Future only                      | Placeholder for larger catalog strategy checks           |

Synthetic data generation, import scripts, fixture generation, and load
validation are defined by `scripts/perf/synthetic-dataset-contract.md` but are
not implemented by this measurement-plan ticket. A later implementation ticket
must produce the local/sandbox dataset and validation report before any
measurements are trusted.

## Search Case Matrix

Each synthetic fixture should include stable case IDs that map to the following
search types. The same matrix should be represented in `perf:baseline`,
`perf:query-shape`, and `perf:explain` inputs where practical.

| Case ID                         | Search type                         | Required evidence                                                                 |
| ------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| `normalized-exact`              | Exact normalized alias              | p50/p95, candidate group count, rows scanned/returned, result order               |
| `normalized-prefix`             | Normalized prefix                   | p50/p95, prefix rows scanned, index usage, candidate cap behavior                 |
| `normalized-contains`           | Normalized contains                 | p50/p95, contains rows scanned, sequential scan dominance, returned candidate cap |
| `hangul-chosung-prefix`         | Hangul chosung prefix               | p50/p95, chosung rows scanned, candidate cap behavior                             |
| `no-result-suggestions`         | No-result path with suggestions     | p50/p95, suggestion query execution, response size                                |
| `valid-provider-filter`         | Search with active provider filter  | provider validation behavior, result filtering, query count                       |
| `invalid-provider-filter`       | Search with invalid provider filter | early failure path, provider/cache lookup count, no candidate/detail execution    |
| `high-candidate-partial-query`  | Broad partial query                 | candidate counts, `id IN` detail size, ranking cost, p95                          |
| `high-entry-count-song-payload` | Song with many entry rows           | relation timing, response bytes, JSON serialization cost                          |
| `cold-route-timing`             | First route request after start     | `x-perf-timing` total and step timings with one or two requests only              |
| `warm-route-timing`             | Repeated route request              | `x-perf-timing` total and step timings with low repetition only                   |

The fixture should prefer deterministic queries over random terms. If random
generation is used by a future importer, record the seed in the PR summary and
result file metadata.

## Tool Roles

Use each measurement tool for one job. Do not use one tool's output as a proxy
for another tool's purpose.

| Tool                                | Primary purpose                                                              | Do not use for                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `npm run perf:baseline`             | Latency, p50/p95, response size, wrapper-level query count                   | SQL plan claims or detailed Prisma relation classification            |
| `npm run perf:query-shape`          | Prisma method count, SQL event count, candidate groups, relation load shape  | Timing conclusions when SQL event logging is enabled                  |
| `npm run perf:explain`              | PostgreSQL plan evidence, rows scanned/filtered, seq scan, sort, index usage | End-to-end API latency or browser/dev-server overhead                 |
| `GET /api/search` + `x-perf-timing` | Route-level cold/warm diagnostics and `searchSongs()` step timing            | Load testing, broad iteration sweeps, or replacing baseline reporting |

`perf:baseline` should be the timing source of record. `perf:query-shape` and
`perf:explain` explain why a baseline changed. `x-perf-timing` is only for
low-repeat route diagnosis when in-process baseline numbers do not match the
user-visible app path.

## Commands

Current-seed verification:

```sh
npm run perf:baseline -- --db-label local --dataset-label current-seed --output perf-results/baseline-local-current-seed-YYYYMMDDTHHMMSSZ.json
npm run perf:query-shape -- --db-label local --dataset-label current-seed --case-limit 4 --output perf-results/query-shape-local-current-seed-YYYYMMDDTHHMMSSZ.json
npm run perf:explain -- --db-label local --dataset-label current-seed --case-limit 4 --output perf-results/explain-local-current-seed-YYYYMMDDTHHMMSSZ.json
```

Synthetic-scale local or sandbox verification, after a future import ticket has
created and validated the dataset:

```sh
npm run perf:baseline -- --db-label local --dataset-label synthetic-1k-songs-10k-aliases --iterations 10 --warmup 3 --output perf-results/baseline-local-synthetic-1k-songs-10k-aliases-YYYYMMDDTHHMMSSZ.json
npm run perf:query-shape -- --db-label local --dataset-label synthetic-1k-songs-10k-aliases --case-limit 9 --output perf-results/query-shape-local-synthetic-1k-songs-10k-aliases-YYYYMMDDTHHMMSSZ.json
npm run perf:explain -- --db-label local --dataset-label synthetic-1k-songs-10k-aliases --case-limit 9 --output perf-results/explain-local-synthetic-1k-songs-10k-aliases-YYYYMMDDTHHMMSSZ.json
```

Low-limit Neon diagnostic only:

```sh
npm run perf:baseline -- --db-label neon --dataset-label current-seed --iterations 1 --warmup 0 --output perf-results/baseline-neon-current-seed-low-limit-YYYYMMDDTHHMMSSZ.json
npm run perf:query-shape -- --db-label neon --dataset-label current-seed --case-limit 1 --no-sql-events --output perf-results/query-shape-neon-current-seed-low-limit-YYYYMMDDTHHMMSSZ.json
npm run perf:explain -- --db-label neon --dataset-label current-seed --case-limit 1 --output perf-results/explain-neon-current-seed-low-limit-YYYYMMDDTHHMMSSZ.json
```

Route timing diagnostic:

```sh
curl -sS -D /tmp/search-headers.txt \
  -H 'x-perf-timing: 1' \
  'http://127.0.0.1:3000/api/search?q=fixture'
```

Use one or two cold/warm route requests only. Do not loop this against Neon.

## Result Files

Write reports under `perf-results/` or `/private/tmp/` unless a PR specifically
requests committed artifacts. Use this filename shape:

```text
<tool>-<db-label>-<dataset-label>-<optional-scope>-<YYYYMMDDTHHMMSSZ>.<extension>
```

Examples:

- `baseline-local-current-seed-20260706T120000Z.json`
- `query-shape-local-synthetic-10k-songs-100k-aliases-case-limit-9-20260706T120000Z.json`
- `explain-neon-current-seed-low-limit-20260706T120000Z.json`
- `route-timing-neon-current-seed-low-limit-20260706T120000Z.json`
- `route-timing-neon-current-seed-low-limit-20260706T120000Z.txt`

Each PR summary must record:

- DB label and whether it was local, sandbox, or Neon.
- Dataset label and observed row counts for songs, aliases, entries, providers.
- Fixture path and case IDs covered.
- Baseline p50/p95 by important case group.
- Query-shape candidate group count, unique alias ID count, and relation-load classification.
- EXPLAIN rows scanned/returned, seq scan/index usage, sort occurrence for prefix, contains, and chosung cases.
- Response bytes for normal result and high-entry-count payload cases.
- `x-perf-timing` cold/warm totals only when route diagnostics were used.
- Any skipped measurement and the reason.

## Neon Load Rules

Synthetic-scale measurement must prefer isolated local or sandbox databases.
Neon runs are allowed only as low-limit diagnostics, not as load tests.

- Do not import synthetic data into a production-like Neon database for this
  ticket.
- Do not run broad iteration sweeps against Neon.
- Use `--case-limit 1` for Neon query-shape and EXPLAIN unless a reviewer asks
  for more.
- Use `--iterations 1 --warmup 0` for Neon baseline smoke checks unless a
  reviewer asks for more.
- Prefer `--no-sql-events` for Neon query-shape unless SQL event evidence is
  necessary.
- Never loop `x-perf-timing` requests against Neon.
- Keep EXPLAIN limited to representative cases; it uses `EXPLAIN ANALYZE`, so it
  executes the read query.

## Decision Gates

Use these gates to decide whether a follow-up optimization ticket is justified.

| Area                      | Gate                                                                                                               | Follow-up action                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Current-seed API latency  | Current-seed API p95 exceeds user-visible target while DB execution remains cheap                                  | Prioritize round-trip, query-count, connection, and route timing work |
| 10k alias prefix/contains | Prefix, contains, or chosung scans touch thousands of rows, or warm local API p95 exceeds 300ms                    | Investigate index/search strategy and query shape                     |
| 100k alias scale          | Warm local API p95 exceeds 500ms, or prefix/contains scans dominate execution                                      | Spike trigram, expression/operator-class index, or query rewrite      |
| Contains search           | Contains query remains sequential and dominates p95 at 10k or 100k aliases                                         | Spike `pg_trgm` or alternative contains strategy                      |
| Prefix/exact search       | Prefix/exact does not use an effective index and scan cost grows with alias count                                  | Spike normalized/search index strategy                                |
| Chosung search            | Chosung prefix scans grow materially and affect p95                                                                | Spike chosung-specific index or query rewrite                         |
| Candidate fan-out         | Candidate group count, unique alias IDs, or DB round trips dominate warm p95                                       | Continue query-shape reduction before schema work                     |
| Payload                   | Response bytes or relation timing grows materially in `high-entry-count-song-payload`                              | Propose payload trimming and UI contract changes                      |
| Result volume             | Users or fixtures frequently require results beyond the first page, or ranking work grows mostly on discarded rows | Design pagination/cursor semantics                                    |

Do not add indexes, enable trigram, rewrite ranking SQL, trim payloads, or add
pagination only because current-seed EXPLAIN shows sequential scans over tiny
tables. Those changes require synthetic-scale evidence.

## Pass/Fail Standard

A measurement PR passes this plan when:

- It uses one of the defined dataset labels.
- It records row counts and fixture coverage.
- It separates current-seed conclusions from synthetic-scale conclusions.
- It includes baseline, query-shape, and EXPLAIN evidence for the selected case
  matrix, or explicitly explains skipped tools.
- Neon usage follows the low-limit rules.
- Any proposed follow-up maps to a decision gate above.

A measurement PR fails this plan when:

- It compares current-seed and synthetic-scale p95 without labeling them.
- It uses SQL event logging numbers as the timing source of record.
- It load-tests Neon.
- It recommends schema, migration, index, trigram, or query rewrite work without
  rows-scanned and p95 evidence from synthetic scale.
