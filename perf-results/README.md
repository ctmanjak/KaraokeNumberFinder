# M2-Perf-12 Local Synthetic Measurement Results

Last updated: 2026-07-07

This directory contains the `[M2-Perf-12]` local synthetic search performance
artifacts used by `[M2-Perf-13]` to draft the next search/index optimization
decision. These files are measurement evidence only; they do not imply schema,
migration, index, or search-code changes.

## Artifacts

| Dataset | Baseline | Query shape | EXPLAIN |
| ------- | -------- | ----------- | ------- |
| `synthetic-1k-songs-10k-aliases` | `baseline-local-synthetic-1k-songs-10k-aliases-20260707T125027Z.json` | `query-shape-local-synthetic-1k-songs-10k-aliases-20260707T125027Z.json` | `explain-local-synthetic-1k-songs-10k-aliases-20260707T125027Z.json` |
| `synthetic-10k-songs-100k-aliases` | `baseline-local-synthetic-10k-songs-100k-aliases-20260707T130129Z.json` | `query-shape-local-synthetic-10k-songs-100k-aliases-20260707T130129Z.json` | `explain-local-synthetic-10k-songs-100k-aliases-20260707T130129Z.json` |

Fixture projections:

- `search-measurement-fixture-synthetic-1k-songs-10k-aliases.csv`
- `search-measurement-fixture-synthetic-10k-songs-100k-aliases.csv`

The fixture files use the current measurement projection
`query,expected_song_id,label`. They are not yet the full synthetic fixture
contract with `case_id`, `expected_match_type`, `provider_id`, and
`dataset_label`.

## Run Metadata

| Dataset | Started at | DB label | Iterations | Warmup | Songs | Aliases | Entries | Providers |
| ------- | ---------- | -------- | ---------: | -----: | ----: | ------: | ------: | --------: |
| `synthetic-1k-songs-10k-aliases` | 2026-07-07T12:51:34Z | `local` | 10 | 3 | 1,000 | 10,000 | 2,258 | 6 |
| `synthetic-10k-songs-100k-aliases` | 2026-07-07T13:02:59Z | `local` | 10 | 3 | 10,000 | 100,000 | 22,520 | 12 |

Validation note:

- A standalone validation JSON artifact is not present in this directory.
- The measurement artifacts record expected synthetic row counts and completed
  scenarios.
- The baseline artifacts still report `dataset.scale_scenario` as
  `current_seed`; treat that as stale metadata for these synthetic runs.

## Baseline P95

API p95 latency in milliseconds:

| Case | 1k songs / 10k aliases | 10k songs / 100k aliases |
| ---- | ---------------------: | -----------------------: |
| Normalized exact | 21.79 | 85.80 |
| Normalized prefix | 20.30 | 93.21 |
| Normalized contains | 14.37 | 85.99 |
| Hangul chosung prefix | 16.19 | 83.92 |
| No-result suggestions | 26.12 | 110.24 |
| Valid provider filter | 17.99 | 50.33 |
| High candidate partial query | 40.47 | 43.80 |
| High entry-count payload | 12.28 | 49.98 |

The local synthetic p95 results stay below the M2-Perf-08 decision gates:
300ms for the 10k-alias threshold and 500ms for the 100k-alias threshold.

## Query Shape

The representative query-shape counts were stable across both dataset sizes.

| Case | SQL queries | Client calls | Candidate groups | Unique alias IDs | Relation load |
| ---- | ----------: | -----------: | ---------------: | ---------------: | ------------- |
| Normalized exact | 6 | 4 | 2 | 1 | Batched, not N+1 |
| Normalized prefix | 7 | 5 | 3 | 1 | Batched, not N+1 |
| Normalized contains | 7 | 5 | 3 | 1 | Batched, not N+1 |
| Hangul chosung prefix | 8 | 6 | 4 | 1 | Batched, not N+1 |
| No-result suggestions | 5 | 5 | 3 | 0 | Detail skipped |
| Valid provider filter | 6 | 4 | 2 | 1 | Batched, not N+1 |
| High candidate partial query | 6 | 4 | 2 | 100 | Batched, not N+1 |
| High entry-count payload | 6 | 4 | 2 | 1 | Batched, not N+1 |
| Invalid provider API path | 1 | 1 | 0 | 0 | Detail skipped |

Scale pressure in these runs comes from rows scanned and payload size, not from
additional Prisma round trips.

## EXPLAIN Summary

| Shape | 1k/10k alias run | 10k/100k alias run | Index usage |
| ----- | ---------------: | -----------------: | ----------- |
| Exact `normalized_alias ILIKE $1` | 10,000 scanned | 100,000 scanned | No index |
| Prefix representative cases | 10,000 scanned | 100,000 scanned | No index |
| Contains representative cases | 10,000 scanned | 100,000 scanned | No index |
| Chosung representative case | 10,000 scanned | 100,000 scanned | No index |
| High-candidate `star` prefix | 2,355 scanned | 22,605 scanned | `song_aliases_normalized_alias_idx` |
| High-candidate `star` contains | 2,455 scanned | 22,705 scanned | `song_aliases_normalized_alias_idx` |
| Alias detail by ID | 1 scanned | 1 scanned | `song_aliases_pkey` |
| Detail with song and entries | 4 scanned | 4 scanned | PK and `karaoke_entries_song_status_idx` |

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

## Tooling Issues

- Synthetic fixture projection should be upgraded to the full contract before
  automated cross-tool comparison depends on case IDs or dataset labels.
- 10k dry-run/import work needs protection against stack-limit failure.
- Prisma transaction timeout risk remains for large synthetic imports.
- Guarded local batch import is the right direction; keep synthetic import
  local/sandbox only and do not import synthetic data into Neon.
