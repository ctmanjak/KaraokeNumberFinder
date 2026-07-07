# M2-Perf-14 Search Index Strategy Spike

Last updated: 2026-07-07

## Decision

Apply a PostgreSQL `pg_trgm` GIN index strategy in a follow-up implementation
ticket for `song_aliases.normalized_alias`, with migration review for extension
availability and write overhead.

Defer a separate `song_aliases.chosung_alias` trigram index until the chosung
query shape is split from the normalized candidate queries or Korean chosung
usage is confirmed to justify the extra index.

Reject `lower(...) varchar_pattern_ops` expression indexes for the current
Prisma SQL shape. They are not used by the existing `ILIKE` candidate SQL and
would require a query rewrite before they help.

This spike does not apply production migrations, Prisma schema changes,
generated client changes, or search-code changes.

## Evidence

Inputs:

- `perf-results/explain-local-synthetic-10k-songs-100k-aliases-20260707T130129Z.json`
- `perf-results/baseline-local-synthetic-10k-songs-100k-aliases-20260707T130129Z.json`
- `perf-results/query-shape-local-synthetic-10k-songs-100k-aliases-20260707T130129Z.json`
- `perf-results/explain-local-synthetic-10k-songs-100k-aliases-index-spike-current-20260707T155245Z.json`
- `perf-results/explain-local-synthetic-10k-songs-100k-aliases-index-spike-pattern-20260707T155245Z.json`
- `perf-results/explain-local-synthetic-10k-songs-100k-aliases-index-spike-trgm-20260707T155245Z.json`
- `perf-results/baseline-local-synthetic-10k-songs-100k-aliases-index-spike-current-20260707T155245Z.json`
- `perf-results/baseline-local-synthetic-10k-songs-100k-aliases-index-spike-trgm-20260707T155245Z.json`

DB scope:

- Local-only PostgreSQL container: `karaoke-synthetic-postgres`
- Connection used only via command-scoped
  `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres`
- `.env` still pointed at Neon and was not used for experiments.
- Synthetic import into the local container was done with container-local CSV
  `COPY` after the guarded Prisma importer hit its documented 30s transaction
  timeout on the 100k dataset.
- Observed local row counts: 10,000 songs, 100,000 aliases, 22,520 entries, 12
  providers.

Local-only setup and measurement commands:

```sh
env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres npx prisma migrate deploy
env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres npm run perf:dataset-import -- --seed-dir tmp/synthetic-datasets/synthetic-10k-songs-100k-aliases --db-label local
docker cp tmp/synthetic-datasets/synthetic-10k-songs-100k-aliases/*.csv karaoke-synthetic-postgres:/tmp/
docker exec karaoke-synthetic-postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "<local staging COPY import>"
env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres npm run perf:explain -- --db-label local --dataset-label synthetic-10k-songs-100k-aliases --fixture perf-results/search-measurement-fixture-synthetic-10k-songs-100k-aliases.csv --output perf-results/explain-local-synthetic-10k-songs-100k-aliases-index-spike-current-20260707T155245Z.json
env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres npm run perf:baseline -- --db-label local --dataset-label synthetic-10k-songs-100k-aliases --fixture perf-results/search-measurement-fixture-synthetic-10k-songs-100k-aliases.csv --iterations 10 --warmup 3 --output perf-results/baseline-local-synthetic-10k-songs-100k-aliases-index-spike-current-20260707T155245Z.json
docker exec karaoke-synthetic-postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE INDEX idx_spike_lower_normalized_alias_pattern ON song_aliases ((lower(normalized_alias)) varchar_pattern_ops); CREATE INDEX idx_spike_lower_chosung_alias_pattern ON song_aliases ((lower(chosung_alias)) varchar_pattern_ops); ANALYZE song_aliases;"
env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres npm run perf:explain -- --db-label local --dataset-label synthetic-10k-songs-100k-aliases --fixture perf-results/search-measurement-fixture-synthetic-10k-songs-100k-aliases.csv --output perf-results/explain-local-synthetic-10k-songs-100k-aliases-index-spike-pattern-20260707T155245Z.json
docker exec karaoke-synthetic-postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE INDEX idx_spike_normalized_alias_trgm_gin ON song_aliases USING gin (normalized_alias gin_trgm_ops); CREATE INDEX idx_spike_chosung_alias_trgm_gin ON song_aliases USING gin (chosung_alias gin_trgm_ops); ANALYZE song_aliases;"
env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres npm run perf:explain -- --db-label local --dataset-label synthetic-10k-songs-100k-aliases --fixture perf-results/search-measurement-fixture-synthetic-10k-songs-100k-aliases.csv --output perf-results/explain-local-synthetic-10k-songs-100k-aliases-index-spike-trgm-20260707T155245Z.json
env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres npm run perf:baseline -- --db-label local --dataset-label synthetic-10k-songs-100k-aliases --fixture perf-results/search-measurement-fixture-synthetic-10k-songs-100k-aliases.csv --iterations 10 --warmup 3 --output perf-results/baseline-local-synthetic-10k-songs-100k-aliases-index-spike-trgm-20260707T155245Z.json
```

The guarded import attempt failed before any rows were committed:

```text
Transaction API error: A query cannot be executed on an expired transaction.
The timeout for this transaction was 30000 ms.
```

This confirms the M2-Perf-13 tooling issue for 100k local imports. It does not
affect the index result because the local container was loaded afterward via
CSV `COPY` and row counts matched the synthetic contract.

## Candidate Comparison

### API p95

API p95 in milliseconds, 10 measured iterations after 3 warmups.

| Case                         | Current local p95 | `pg_trgm` p95 | Change |
| ---------------------------- | ----------------: | ------------: | -----: |
| Normalized exact             |             50.31 |          4.19 | -91.7% |
| Normalized prefix            |             94.15 |          4.62 | -95.1% |
| Normalized contains          |             85.39 |          6.20 | -92.7% |
| Hangul chosung prefix        |             87.27 |         45.90 | -47.4% |
| No-result suggestions        |            107.13 |          2.68 | -97.5% |
| Valid provider filter        |             50.42 |          3.60 | -92.9% |
| High candidate partial query |             41.75 |         16.34 | -60.9% |
| High entry-count payload     |             50.53 |          4.24 | -91.6% |

### EXPLAIN Summary

Representative current SQL shape:

```sql
normalized_alias ILIKE $1
normalized_alias ILIKE ($1 || '%')
normalized_alias ILIKE ('%' || $1 || '%')
chosung_alias ILIKE ($1 || '%')
```

| Case and shape                 | Current rows scanned | Pattern index rows scanned | `pg_trgm` rows scanned | `pg_trgm` index used                  | `pg_trgm` execution ms |
| ------------------------------ | -------------------: | -------------------------: | ---------------------: | ------------------------------------- | ---------------------: |
| Exact equals                   |              100,000 |                    100,000 |                      2 | `idx_spike_normalized_alias_trgm_gin` |                  0.206 |
| Exact prefix                   |              100,000 |                    100,000 |                      2 | `idx_spike_normalized_alias_trgm_gin` |                  0.193 |
| Exact contains                 |              100,000 |                    100,000 |                      2 | `idx_spike_normalized_alias_trgm_gin` |                  0.177 |
| Prefix starts-with             |              100,000 |                    100,000 |                      2 | `idx_spike_normalized_alias_trgm_gin` |                  0.404 |
| Prefix contains                |              100,000 |                    100,000 |                      2 | `idx_spike_normalized_alias_trgm_gin` |                  0.173 |
| Contains contains              |              100,000 |                    100,000 |                    224 | `idx_spike_normalized_alias_trgm_gin` |                  1.979 |
| Chosung starts-with            |              100,000 |                    100,000 |                      2 | `idx_spike_chosung_alias_trgm_gin`    |                  0.071 |
| High-candidate `star` prefix   |               22,605 |                     22,605 |                 22,605 | `song_aliases_normalized_alias_idx`   |                 12.317 |
| High-candidate `star` contains |               22,705 |                     22,705 |                  3,000 | `idx_spike_normalized_alias_trgm_gin` |                  1.441 |

Sort still occurred in the candidate plans because the current query keeps
`ORDER BY normalized_alias ASC, song_id ASC, alias ASC, id ASC`. The index
benefit came from avoiding the full filter scan, not from satisfying the sort.

Sequential scan observations:

- Current and pattern-index runs retained seq scan for representative
  exact/prefix/contains/chosung shapes.
- `pg_trgm` removed seq scan for the selective normalized exact/prefix/contains
  cases and the chosung prefix case.
- The normalized contains query for Hangul chosung input still scanned 100,000
  rows because it probes `normalized_alias ILIKE '%ᄉᄐ%'`, which is not selective
  for the normalized alias trigram index in this dataset. The separate
  `chosung_alias ILIKE 'ㅅㅌ%'` candidate did use the chosung trigram index.

### Index Cost

Local index creation and size on 100,000 aliases:

| Candidate index                                                                             | Create time |    Size | Current SQL used it?           | Recommendation           |
| ------------------------------------------------------------------------------------------- | ----------: | ------: | ------------------------------ | ------------------------ |
| `idx_spike_lower_normalized_alias_pattern` on `lower(normalized_alias) varchar_pattern_ops` |       109ms | 4,552KB | No                             | Reject for current shape |
| `idx_spike_lower_chosung_alias_pattern` on `lower(chosung_alias) varchar_pattern_ops`       |        39ms |   696KB | No                             | Reject for current shape |
| `idx_spike_normalized_alias_trgm_gin` on `normalized_alias gin_trgm_ops`                    |       536ms | 5,312KB | Yes                            | Apply in follow-up       |
| `idx_spike_chosung_alias_trgm_gin` on `chosung_alias gin_trgm_ops`                          |        23ms |   136KB | Yes for chosung candidate only | Defer                    |

The local `pg_trgm` extension was available and `CREATE EXTENSION IF NOT EXISTS
pg_trgm` completed in about 24ms. A production implementation must still verify
extension policy on the target PostgreSQL provider before proposing a migration.

## Candidate Recommendations

| Candidate                                                  | Result                                                                                                                                                                                     | Recommendation                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `lower(normalized_alias) varchar_pattern_ops`              | Not selected by current `normalized_alias ILIKE ...` SQL. No rows-scanned improvement.                                                                                                     | Reject for current shape. Reconsider only with a deliberate query rewrite to `lower(normalized_alias) LIKE ...`.                     |
| `lower(chosung_alias) varchar_pattern_ops`                 | Not selected by current `chosung_alias ILIKE ...` SQL. No rows-scanned improvement.                                                                                                        | Reject for current shape. Reconsider only with a deliberate query rewrite.                                                           |
| `normalized_alias gin_trgm_ops`                            | Used by current `ILIKE` exact, prefix, and contains shapes. API p95 improved by about 92-95% for representative normalized exact/prefix/contains cases.                                    | Apply in a follow-up migration ticket, subject to provider extension approval and regression tests.                                  |
| `chosung_alias gin_trgm_ops`                               | Used by the current chosung prefix `ILIKE` shape and reduced that plan to 2 rows scanned, but overall chosung API p95 remained 45.90ms because normalized candidate queries still run too. | Defer until chosung query shape can avoid unnecessary normalized probes or real chosung query volume justifies the write/index cost. |
| Query rewrite with raw SQL/CTE or lower/pattern predicates | Could make btree pattern indexes viable or avoid unnecessary candidate branches. Not applied in this spike.                                                                                | Defer to a separate behavior-sensitive ticket with ranking fixture coverage.                                                         |

## Recommended Next Implementation Ticket

Create `[M2-Perf-15] apply normalized_alias pg_trgm index for synthetic-scale
search`.

Scope:

- Add a migration that enables `pg_trgm` if provider policy permits it.
- Add `song_aliases.normalized_alias` GIN trigram index.
- Do not add the chosung trigram index in the same migration unless the ticket
  also changes candidate branching or adds product evidence for chosung volume.
- Re-run `perf:baseline`, `perf:explain`, and smoke/search tests on local or
  sandbox synthetic 100k aliases.
- Include rollback notes and index size/write overhead in the PR.

Acceptance checks:

- Exact, prefix, and contains representative normalized plans use
  `idx_*normalized_alias*trgm*` or the production migration name.
- No representative normalized candidate query scans 100,000 aliases.
- Search fixture ordering and result sets remain stable.
- Production-like migration review confirms `pg_trgm` extension availability.

## Deferred Options

- Chosung trigram index: defer until candidate branching avoids normalized
  probes for chosung-only input or real usage makes the index cost worthwhile.
- Btree pattern expression indexes: defer unless search SQL is rewritten to
  lowercased `LIKE` predicates.
- Raw SQL/CTE ranking rewrite: defer because it can change candidate selection,
  ranking, and Prisma abstraction boundaries.
- Full-text search or external search: reject for MVP scale until trigram and
  query-shape options fail measured targets.

## Risks

- `pg_trgm` requires extension support in the target PostgreSQL environment.
- GIN indexes add write/import overhead. The local 100k normalized index was
  5.3MB and took about 536ms to build, but production catalog size and hardware
  will differ.
- Current candidate SQL still sorts after index filtering. A later query-shape
  rewrite may be needed if broad candidate sets or ranking work dominate.
- Chosung input still executes normalized candidate probes in the current
  application path, so a chosung-only index does not eliminate all chosung p95
  cost.
- The local 100k import path still needs tooling work because the guarded Prisma
  importer timed out at 30 seconds.

## Open Questions

- Does the deployment PostgreSQL provider permit `CREATE EXTENSION pg_trgm` in
  the target database and migration role?
- Should production add the normalized trigram index concurrently to avoid write
  blocking on larger future catalogs?
- Should the search path skip normalized contains for Hangul chosung-only input
  before adding a chosung-specific index?
- Should synthetic fixture projection be upgraded to the full case-id contract
  before the implementation PR so automated comparisons are less label-based?
