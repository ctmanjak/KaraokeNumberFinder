# M2-Perf-12 Local Synthetic Measurement Results

Last updated: 2026-07-07

This directory contains the `[M2-Perf-12]` local synthetic search performance
artifacts used by `[M2-Perf-13]` to draft the next search/index optimization
decision. These files are measurement evidence only; they do not imply schema,
migration, index, or search-code changes.

## Artifacts

| Dataset                            | Baseline                                                                | Query shape                                                                | EXPLAIN                                                                |
| ---------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `synthetic-1k-songs-10k-aliases`   | `baseline-local-synthetic-1k-songs-10k-aliases-20260707T125027Z.json`   | `query-shape-local-synthetic-1k-songs-10k-aliases-20260707T125027Z.json`   | `explain-local-synthetic-1k-songs-10k-aliases-20260707T125027Z.json`   |
| `synthetic-10k-songs-100k-aliases` | `baseline-local-synthetic-10k-songs-100k-aliases-20260707T130129Z.json` | `query-shape-local-synthetic-10k-songs-100k-aliases-20260707T130129Z.json` | `explain-local-synthetic-10k-songs-100k-aliases-20260707T130129Z.json` |

Fixture projections:

- `search-measurement-fixture-synthetic-1k-songs-10k-aliases.csv`
- `search-measurement-fixture-synthetic-10k-songs-100k-aliases.csv`

The fixture files use the current measurement projection
`query,expected_song_id,label`. They are not yet the full synthetic fixture
contract with `case_id`, `expected_match_type`, `provider_id`, and
`dataset_label`.

## Run Metadata

| Dataset                            | Started at           | DB label | Iterations | Warmup |  Songs | Aliases | Entries | Providers |
| ---------------------------------- | -------------------- | -------- | ---------: | -----: | -----: | ------: | ------: | --------: |
| `synthetic-1k-songs-10k-aliases`   | 2026-07-07T12:51:34Z | `local`  |         10 |      3 |  1,000 |  10,000 |   2,258 |         6 |
| `synthetic-10k-songs-100k-aliases` | 2026-07-07T13:02:59Z | `local`  |         10 |      3 | 10,000 | 100,000 |  22,520 |        12 |

Validation note:

- A standalone validation JSON artifact is not present in this directory.
- The measurement artifacts record expected synthetic row counts and completed
  scenarios.
- The baseline artifacts still report `dataset.scale_scenario` as
  `current_seed`; treat that as stale metadata for these synthetic runs.

## Baseline P95

API p95 latency in milliseconds:

| Case                         | 1k songs / 10k aliases | 10k songs / 100k aliases |
| ---------------------------- | ---------------------: | -----------------------: |
| Normalized exact             |                  21.79 |                    85.80 |
| Normalized prefix            |                  20.30 |                    93.21 |
| Normalized contains          |                  14.37 |                    85.99 |
| Hangul chosung prefix        |                  16.19 |                    83.92 |
| No-result suggestions        |                  26.12 |                   110.24 |
| Valid provider filter        |                  17.99 |                    50.33 |
| High candidate partial query |                  40.47 |                    43.80 |
| High entry-count payload     |                  12.28 |                    49.98 |

The local synthetic p95 results stay below the M2-Perf-08 decision gates:
300ms for the 10k-alias threshold and 500ms for the 100k-alias threshold.

## Query Shape

The representative query-shape counts were stable across both dataset sizes.

| Case                         | SQL queries | Client calls | Candidate groups | Unique alias IDs | Relation load    |
| ---------------------------- | ----------: | -----------: | ---------------: | ---------------: | ---------------- |
| Normalized exact             |           6 |            4 |                2 |                1 | Batched, not N+1 |
| Normalized prefix            |           7 |            5 |                3 |                1 | Batched, not N+1 |
| Normalized contains          |           7 |            5 |                3 |                1 | Batched, not N+1 |
| Hangul chosung prefix        |           8 |            6 |                4 |                1 | Batched, not N+1 |
| No-result suggestions        |           5 |            5 |                3 |                0 | Detail skipped   |
| Valid provider filter        |           6 |            4 |                2 |                1 | Batched, not N+1 |
| High candidate partial query |           6 |            4 |                2 |              100 | Batched, not N+1 |
| High entry-count payload     |           6 |            4 |                2 |                1 | Batched, not N+1 |
| Invalid provider API path    |           1 |            1 |                0 |                0 | Detail skipped   |

Scale pressure in these runs comes from rows scanned and payload size, not from
additional Prisma round trips.

## EXPLAIN Summary

| Shape                             | 1k/10k alias run | 10k/100k alias run | Index usage                              |
| --------------------------------- | ---------------: | -----------------: | ---------------------------------------- |
| Exact `normalized_alias ILIKE $1` |   10,000 scanned |    100,000 scanned | No index                                 |
| Prefix representative cases       |   10,000 scanned |    100,000 scanned | No index                                 |
| Contains representative cases     |   10,000 scanned |    100,000 scanned | No index                                 |
| Chosung representative case       |   10,000 scanned |    100,000 scanned | No index                                 |
| High-candidate `star` prefix      |    2,355 scanned |     22,605 scanned | `song_aliases_normalized_alias_idx`      |
| High-candidate `star` contains    |    2,455 scanned |     22,705 scanned | `song_aliases_normalized_alias_idx`      |
| Alias detail by ID                |        1 scanned |          1 scanned | `song_aliases_pkey`                      |
| Detail with song and entries      |        4 scanned |          4 scanned | PK and `karaoke_entries_song_status_idx` |

The main optimization signal is full alias-table scanning for representative
exact, prefix, contains, and chosung searches at 100k aliases. The local latency
gate is not crossed, so this evidence supports a focused experiment rather than
an immediate migration.

## Decision Draft

Decision: do not apply schema, migration, index, trigram, query rewrite, payload,
or pagination changes from M2-Perf-13.

Recommended next experiment: create `[M2-Perf-14] PostgreSQL search index
strategy spike for synthetic 100k aliases`.

The experiment should compare current M2-Perf-12 artifacts against local or
sandbox-only prototypes for exact/prefix index behavior and a separately gated
contains-search option such as `pg_trgm`. The output should include before/after
p95, rows scanned, index names used, index-size/write-cost notes, and a clear
apply/defer/reject recommendation.

## M2-Perf-14 Index Strategy Spike Artifacts

M2-Perf-14 added local-only spike artifacts for the
`synthetic-10k-songs-100k-aliases` dataset:

| Candidate state                                     | Baseline                                                                                    | EXPLAIN                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Current indexes only                                | `baseline-local-synthetic-10k-songs-100k-aliases-index-spike-current-20260707T155245Z.json` | `explain-local-synthetic-10k-songs-100k-aliases-index-spike-current-20260707T155245Z.json` |
| `lower(...) varchar_pattern_ops` expression indexes | n/a                                                                                         | `explain-local-synthetic-10k-songs-100k-aliases-index-spike-pattern-20260707T155245Z.json` |
| `pg_trgm` GIN indexes                               | `baseline-local-synthetic-10k-songs-100k-aliases-index-spike-trgm-20260707T155245Z.json`    | `explain-local-synthetic-10k-songs-100k-aliases-index-spike-trgm-20260707T155245Z.json`    |

Summary:

- Pattern expression indexes were not used by the current `ILIKE` SQL shape.
- `normalized_alias gin_trgm_ops` was used by current exact, prefix, and contains
  `ILIKE` candidates and reduced representative normalized API p95 from
  50-94ms to 4-6ms.
- `chosung_alias gin_trgm_ops` was used by the chosung candidate, but the overall
  chosung search path still ran normalized candidate probes.
- The decision document is `scripts/perf/search-index-strategy-spike.md`.

## M2-Perf-15 Normalized Alias Trigram Index Artifacts

M2-Perf-15 applied a SQL-only Prisma migration for the M2-Perf-14 normalized
alias recommendation:

- `CREATE EXTENSION IF NOT EXISTS "pg_trgm";`
- `CREATE INDEX CONCURRENTLY "song_aliases_normalized_alias_trgm_idx" ON "song_aliases" USING gin ("normalized_alias" gin_trgm_ops);`

Artifacts:

| Dataset                            | Baseline                                                                           | EXPLAIN                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `synthetic-10k-songs-100k-aliases` | `baseline-local-synthetic-10k-songs-100k-aliases-m2-perf-15-20260708T034343Z.json` | `explain-local-synthetic-10k-songs-100k-aliases-m2-perf-15-20260708T034343Z.json` |

Run metadata:

| DB scope                                |  Songs | Aliases | Entries | Providers | Concurrent index build time | New index size |
| --------------------------------------- | -----: | ------: | ------: | --------: | --------------------------: | -------------: |
| local-only `karaoke-synthetic-postgres` | 10,000 | 100,000 |  22,520 |        12 |            0.495s wall time |        5,312KB |

The concurrent Prisma migration path was also validated against a fresh local
temporary DB. Manual `CREATE INDEX CONCURRENTLY` operations must be run as a
standalone statement, not grouped with other SQL in one transaction block.

Before/after API p95 in milliseconds, comparing against the M2-Perf-14
current-index baseline:

| Case                         | Before | After | Change |
| ---------------------------- | -----: | ----: | -----: |
| Normalized exact             |  50.31 |  3.76 | -92.5% |
| Normalized prefix            |  94.15 |  5.62 | -94.0% |
| Normalized contains          |  85.39 |  6.71 | -92.1% |
| No-result suggestions        | 107.13 |  3.00 | -97.2% |
| High candidate partial query |  41.75 | 17.28 | -58.6% |

Representative normalized candidate EXPLAIN results:

| Shape                 | Before rows scanned | After rows scanned | After index used                         | After seq scan |
| --------------------- | ------------------: | -----------------: | ---------------------------------------- | -------------- |
| Exact `ILIKE $1`      |             100,000 |                  2 | `song_aliases_normalized_alias_trgm_idx` | No             |
| Prefix `ILIKE $1      |                     |                 %` | 100,000                                  | 2              | `song_aliases_normalized_alias_trgm_idx` | No  |
| Contains `ILIKE %$1%` |             100,000 |                224 | `song_aliases_normalized_alias_trgm_idx` | No             |

The run used only the local synthetic DB. Neon and production-like databases
were not used. M2-Perf-15 did not add a `chosung_alias` trigram index, pattern
index, query rewrite, search-code change, ranking change, generated client
change, API payload change, or pagination/provider behavior change.

## Tooling Issues

- Synthetic fixture projection should be upgraded to the full contract before
  automated cross-tool comparison depends on case IDs or dataset labels.
- 10k dry-run/import work needs protection against stack-limit failure.
- Prisma transaction timeout risk remains for large synthetic imports.
- Guarded local batch import is the right direction; keep synthetic import
  local/sandbox only and do not import synthetic data into Neon.
