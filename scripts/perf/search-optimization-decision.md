# M2-Perf-04 Search Optimization Decision

Last updated: 2026-07-07

## Scope

This document closes `[M2-Perf-04] 검색 쿼리 최적화안 정리 및 적용 범위 결정`.
It synthesizes `[M2-Perf-01]`, `[M2-Perf-02]`, and `[M2-Perf-03]` results and
decides what to apply now, what to defer, and what requires synthetic scale
measurement first.

This ticket intentionally does not change search behavior, Prisma schema,
migrations, indexes, generated Prisma Client, DB data, or `.env`.

## Inputs

| Source                          | Evidence used                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `[M2-Perf-01]` baseline harness | `npm run perf:baseline` exists and emits `schema_version: 1`, DB/dataset labels, current seed row counts, p50/p95/min/max/avg latency, wrapper-level query count, response size, and route/service scenario rows. A low-iteration Neon rerun was captured at `/private/tmp/karaoke-perf-baseline-neon-current-seed-rerun-m2-perf-04.json` after user-reported about 1300ms search latency. |
| `[M2-Perf-02]` EXPLAIN          | `/private/tmp/karaoke-perf-explain-neon-current-seed-case-limit-4.json`, Neon current seed, case limit 4. Counts: songs 15, song_aliases 100, karaoke_entries 16, karaoke_providers 4.                                                                                                                                                                                                     |
| `[M2-Perf-03]` query shape      | `/private/tmp/karaoke-perf-query-shape-neon-current-seed-case-limit-2.json`, Neon current seed, case limit 2. Counts: songs 15, song_aliases 100, karaoke_entries 16, karaoke_providers 4.                                                                                                                                                                                                 |
| Current code                    | `lib/search/search.ts`, `lib/providers/providers.ts`, `prisma/schema.prisma`, `scripts/perf/README.md`, `seed/search-smoke.csv`.                                                                                                                                                                                                                                                           |
| Product/technical plan          | MVP v0.1 starts with PostgreSQL `ILIKE` over `SongAlias.normalized_alias` and `chosung_alias`; trigram, full-text search, and external search are explicitly deferred until real data/search evidence exists.                                                                                                                                                                              |

## Current Seed vs Future Scale

Current seed:

| Table               | Rows |
| ------------------- | ---: |
| `songs`             |   15 |
| `song_aliases`      |  100 |
| `karaoke_entries`   |   16 |
| `karaoke_providers` |    4 |

Current seed conclusions are only valid for the small inspected dataset. At this
scale, seq scans over 100 aliases and 4 providers are cheap enough that
index/migration work is not the first fix. However, Neon current-seed baseline
does show user-visible latency from network round trips and the current
multi-query shape: a single provider query took about 70ms, while successful
search paths took about 360-423ms in the in-process harness with one measured
iteration. If the app is observed around 1300ms, the likely delta is cold
connection, Next.js/dev-server/browser overhead, or multiple search/provider
requests layered on top of the same remote DB round-trip cost.

Future synthetic scale must be treated separately. The risk profile changes when
aliases grow to 10k/100k rows, entries grow per provider, or partial-match terms
return large candidate sets. Any optimization that changes schema, ranking,
candidate selection, or payload should wait for synthetic runs with explicit
dataset labels such as `synthetic-1k-songs-10k-aliases` and
`synthetic-10k-songs-100k-aliases`.

## Observed Search Shape

Current `searchSongs()` does the following:

1. Reads active providers on every search to validate optional `provider_id` and find the default provider.
2. Builds alias candidate conditions for normalized exact, normalized prefix, normalized contains, and optional chosung prefix.
3. Runs candidate ID lookups with `Promise.all`.
4. Dedupes alias IDs and performs a detail lookup by `song_aliases.id IN (...)`.
5. Lets Prisma load selected `song` and `karaokeEntries` relations in batched relation SQL.
6. Ranks in application code and serializes API JSON.
7. Runs suggestions only when search returns no items.

The query-shape run observed:

| Scenario                     | Client calls | SQL events | Candidate groups | Unique alias IDs | Relation load                  |
| ---------------------------- | -----------: | ---------: | ---------------: | ---------------: | ------------------------------ |
| direct/API successful search |            6 |          8 |                4 |                1 | Batched relation load, not N+1 |
| valid provider filter        |            6 |          8 |                4 |                1 | Batched relation load, not N+1 |
| invalid provider API         |            1 |          1 |                0 |                0 | Candidate/detail not executed  |
| no-result suggestions        |            6 |          6 |                4 |                0 | Detail not executed            |
| provider list direct/API     |            1 |          1 |                0 |                0 | Not applicable                 |

The successful search response size in the sampled Neon query-shape run was
about 839-855 bytes for 1 result. Provider list response size was about 454-464
bytes for 3 active providers.

The low-iteration Neon baseline rerun observed:

| Scenario                            |         Latency | Query count | Interpretation                                                   |
| ----------------------------------- | --------------: | ----------: | ---------------------------------------------------------------- |
| single provider list query          |   about 70-76ms |           1 | Approximate remote DB round-trip floor from this environment     |
| successful search service/API paths | about 360-423ms |           6 | Mostly round-trip fan-out rather than DB execution time          |
| invalid provider API                |      about 71ms |           1 | Confirms one-query path follows the provider-query latency floor |

This means current seed latency is real even though current seed DB execution is
cheap. The primary current-seed bottleneck is not alias table scan cost; it is
the number of DB calls made against Neon and any cold/server/browser overhead
around them.

Additional `x-perf-timing: 1` API route diagnostics against the running Next dev
server reproduced the user-observed latency and narrowed the cause further:

| Request                               | HTTP total | Route total | Key server-side timing                                                                  |
| ------------------------------------- | ---------: | ----------: | --------------------------------------------------------------------------------------- |
| first debug search after route change |     2611ms |      2576ms | `search.providers` 1780ms, `search.candidates.total` 793ms, `search.alias_detail` 249ms |
| repeated debug search                 |     1290ms |      1273ms | `search.providers` 521ms, `search.candidates.total` 751ms, `search.alias_detail` 221ms  |
| repeated debug search                 |     1317ms |      1300ms | `search.providers` 521ms, `search.candidates.total` 779ms, `search.alias_detail` 218ms  |
| provider-only API                     |       92ms |         n/a | Confirms provider list endpoint alone is not the 1300ms path                            |

Therefore the 1300ms path is inside the search route handler, not browser
rendering or response serialization. The stable pattern is: provider lookup
around 520ms, then a candidate lookup phase where one candidate query is about
80ms but the other parallel candidate queries are about 530-560ms, then alias
detail/relation load around 218ms. The most likely concrete mechanism is
connection/pool acquisition or Neon connection fan-out caused by the current
`Promise.all` candidate query structure plus remote DB round-trip latency.

## EXPLAIN Summary

On Neon current seed, representative alias candidate plans scanned all 100
`song_aliases` rows and usually sorted the result:

| Query shape                                | Current plan                                                                                                | Current cost interpretation                                         | Scale risk                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `normalized_alias` equals, insensitive     | seq scan + sort, index not selected                                                                         | Fine at 100 aliases; mostly <1ms execution in sampled plans         | Medium/high if case-insensitive equality keeps bypassing btree indexes at 10k+ aliases |
| `normalized_alias` startsWith, insensitive | seq scan + sort, index not selected                                                                         | Fine at 100 aliases                                                 | High if prefix search remains common and row count grows                               |
| `normalized_alias` contains, insensitive   | seq scan + sort, index not selected                                                                         | Fine at 100 aliases; inherently index-hostile with plain btree      | High at 10k/100k aliases                                                               |
| `chosung_alias` startsWith, insensitive    | seq scan + sort, index not selected                                                                         | Fine at 100 aliases                                                 | High if chosung search is a core path at scale                                         |
| `song_aliases.id IN (...)` detail          | seq scan on `song_aliases` in sampled small table                                                           | Fine for `id_in_count` 1; planner may prefer seq scan on tiny table | Medium if candidate IDs grow and detail lookup still sorts many aliases                |
| detail with `songs` and `karaoke_entries`  | `songs_pkey` and `karaoke_entries_song_provider_version_number_key` used, with seq scan on tiny alias table | Relation side is not the current problem                            | Medium if entries per song/provider grow and payload is not trimmed                    |
| active provider lookup                     | seq scan + sort over 4 providers                                                                            | Fine                                                                | Low until providers grow materially                                                    |
| `GET /api/providers` country/active/order  | `karaoke_providers_country_active_order_idx` selected                                                       | Healthy                                                             | Low                                                                                    |

## Bottleneck Classification

| Category                         | Current seed classification | Future scale classification | Rationale                                                                                                                                                                 |
| -------------------------------- | --------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB plan bottleneck               | Observe only                | Likely risk                 | Candidate `ILIKE` shapes do not use current btree indexes in sampled plans, but the scanned table is only 100 rows and sampled DB execution is mostly sub-ms.             |
| Query shape bottleneck           | Confirmed current issue     | Medium/high risk            | Search does provider lookup, 4 candidate lookups, alias detail lookup, and Prisma relation loads. Route diagnostics reproduced about 1300ms inside the handler.           |
| Network/Neon latency bottleneck  | Confirmed current issue     | Medium/high risk            | Provider-only endpoint is about 92ms, while search multiplies remote DB work across staged and parallel query groups.                                                     |
| Connection/cold start bottleneck | Confirmed current issue     | Medium risk                 | Route diagnostics show first provider lookup can take 1780ms after route change and repeated search provider/candidate phases still take about 520-560ms in the app path. |
| Application CPU bottleneck       | Not indicated               | Low/medium risk             | Ranking and serialization are small at 1 result and sub-KB responses. CPU may grow with candidate count.                                                                  |
| Payload/serialization bottleneck | Not indicated               | Medium risk                 | Current payload is small, but detail lookup includes all selected entries for matched songs. Songs with many provider/version rows can inflate API responses.             |
| Data scale bottleneck            | Not current                 | High risk                   | Current seed is intentionally tiny; alias partial/prefix scans are the main non-linear risk.                                                                              |
| Measurement noise                | Present                     | Present                     | Query event logging can distort timing. Use `perf:baseline` for latency and `perf:query-shape` for shape only.                                                            |

## Optimization Candidates

| Candidate                                              | Expected effect                                                                        | Cost        | Risk                                                                                            | Schema/migration impact                                  | Verification                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL index strategy for normalized/prefix search | Reduce exact/prefix candidate scans at scale if SQL operator/index class matches query | Medium      | Wrong index can be unused or add write overhead                                                 | Yes, likely expression or operator-class index migration | Synthetic EXPLAIN on 10k/100k aliases; confirm `index.used=true`, lower rows scanned, no ranking regression                    |
| PostgreSQL trigram (`pg_trgm`)                         | Best in-DB fit for `ILIKE '%query%'` contains and tolerant matching                    | Medium/high | Extension availability, index size, different ranking expectations                              | Yes, extension plus GIN/GiST indexes                     | Synthetic contains-heavy suite; compare p50/p95, rows scanned, index size, write/import cost                                   |
| PostgreSQL full-text search                            | Useful for tokenized text search                                                       | Medium/high | Poor fit for normalized no-space aliases, Japanese/Korean romanization/chosung, substring needs | Yes, tsvector/index/migration likely                     | Prototype only after query logs show token search need; compare recall with smoke/search fixtures                              |
| Query rewrite                                          | Could collapse candidate queries, use raw SQL/CTE, or push ranking into DB             | Medium/high | Behavioral/ranking regressions, Prisma abstraction loss                                         | Maybe                                                    | Golden search fixture plus query-shape and EXPLAIN comparison; out of scope for this ticket                                    |
| Candidate 조회 구조 변경                               | Reduce fixed 4 candidate group queries or avoid detail lookup for low-value candidates | Medium      | Ranking changes and missed matches                                                              | Maybe no schema, but code behavior changes               | Synthetic plus existing smoke; track candidate counts and result order                                                         |
| Provider 조회 cache/request-scope reuse                | Avoid active provider read on every search, reduce one remote round trip               | Low/medium  | Stale provider state if cached globally without invalidation                                    | No schema impact                                         | Query-shape should drop client method/SQL count on repeated searches; API tests for invalid provider/default provider behavior |
| Relation/payload trimming                              | Lower detail SQL payload, Prisma relation load, JSON serialization                     | Low/medium  | UI may lose needed expanded-card fields                                                         | No schema impact                                         | API contract tests, response byte comparison, UI fixture coverage                                                              |
| Pagination/cursor strategy                             | Prevent large result responses and ranking work beyond first page                      | Medium      | Cursor semantics must preserve rank determinism                                                 | Possibly no schema                                       | Add result-count stress tests; verify stable ordering and `next_cursor` behavior                                               |
| External search engine                                 | Powerful search/ranking and typo tolerance at larger scale                             | High        | Operational complexity, sync consistency, extra infra for MVP                                   | No DB schema required, but infra/data pipeline required  | Only after in-DB options fail synthetic/user-log targets; compare quality and ops burden                                       |

## Decision

### Apply in this milestone

No performance improvement code is applied in this ticket.

Allowed and completed scope:

- Add this decision document.
- Link it from `scripts/perf/README.md`.
- Keep using `perf:baseline`, `perf:explain`, and `perf:query-shape` as the evidence pipeline.

Current seed action:

- Keep the current query shape unchanged.
- Keep existing Prisma schema and indexes unchanged.
- Keep current API payload unchanged.
- Treat current Neon latency as a confirmed issue, but address it in follow-up
  code tickets rather than in this decision-only ticket.
- Prioritize low-risk query round-trip and connection fan-out reduction before
  index/search-engine work: provider lookup reuse/cache, candidate query
  structure changes, and app-path cold/warm timing.

### Defer

| Item                         | Reason                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add/drop/alter indexes       | Current seed latency exists, but EXPLAIN points away from DB execution/index cost as the first cause; synthetic scale is required before migration risk.               |
| Query rewrite                | Current query fan-out is a real latency issue, but ranking/search behavior risk is high; split into a focused follow-up after measuring cold/warm and round-trip cost. |
| Trigram/full-text search     | MVP technical plan already deferred these; current evidence says they are future scale options, not current seed requirements.                                         |
| External search engine       | Operationally too heavy before in-DB options and real query logs are exhausted.                                                                                        |
| Pagination/cursor API change | `next_cursor` is currently `null`; no evidence yet that current result volume needs pagination semantics.                                                              |

### Decide after synthetic scale measurement

| Item                        | Decision trigger                                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prefix/exact index strategy | Synthetic 10k/100k alias EXPLAIN shows seq scans remain dominant and baseline p95 exceeds target.                                                                |
| Trigram index               | Contains queries dominate p95 or rows scanned at 10k/100k aliases.                                                                                               |
| Candidate structure change  | Query-shape shows candidate groups return hundreds of aliases or remote DB round trips dominate latency.                                                         |
| Relation/payload trimming   | Response size or relation SQL grows with entries per song/provider and becomes visible in baseline p95.                                                          |
| Provider cache/reuse        | Current Neon baseline already shows one provider query costs about 70ms; follow-up can be prioritized before synthetic scale if product latency is unacceptable. |

## Required Additional Measurement

Before applying optimization code, define and run a synthetic dataset plan:
`scripts/perf/synthetic-scale-plan.md` is the detailed `[M2-Perf-08]`
measurement standard for dataset labels, case matrix, command usage, Neon load
limits, result naming, and decision gates.

| Dataset label                      |  Songs | Aliases |       Entries | Providers | Purpose                                                   |
| ---------------------------------- | -----: | ------: | ------------: | --------: | --------------------------------------------------------- |
| `current-seed`                     |     15 |     100 |            16 |         4 | Existing small verified seed; correctness and noise floor |
| `synthetic-1k-songs-10k-aliases`   |  1,000 |  10,000 |   2,000-5,000 |      4-10 | First realistic index/query-shape threshold               |
| `synthetic-10k-songs-100k-aliases` | 10,000 | 100,000 | 20,000-50,000 |      4-20 | Stress prefix/contains scans and payload growth           |

Measurement rules:

- Use isolated local/sandbox DB first; do not load-test Neon production-like DB.
- Use `--dataset-label` that names the synthetic scale.
- Keep Neon runs to low `--case-limit` and low iterations.
- Run `perf:baseline` without Prisma SQL event logging for timing.
- Run `perf:explain` for representative exact, prefix, contains, chosung, no-result, and provider-filter queries.
- Run `perf:query-shape` with small case limits to inspect SQL count and relation loading.
- Record row counts, p50/p95, rows scanned/returned, response bytes, candidate counts, unique alias IDs, and relation SQL classification.

Proposed decision gates:

- Current seed: no optimization required unless API p95 becomes user-visible due to network/cold connection.
- 10k aliases: investigate if `song_aliases` candidate scans exceed thousands of rows per search or search API p95 exceeds 300ms in warm local DB.
- 100k aliases: require an index/search strategy if contains/prefix scans remain sequential and p95 exceeds 500ms in warm local DB or low-limit Neon runs.

## M2-Perf-13 Ticket Definition

| Field | Definition |
| ----- | ---------- |
| Title | `[M2-Perf-13] synthetic 1k/10k local perf result summary and search optimization decision draft` |
| Goal | Summarize `[M2-Perf-12]` local synthetic measurement evidence and turn it into a clear next-step decision point for search/index optimization work. |
| Scope | Review existing perf docs, inspect the 1k/10k baseline/query-shape/EXPLAIN artifacts, document row counts, validation status, p95, SQL count, rows scanned, index usage, tooling issues, and next ticket candidates. |
| Non-goals | Do not change schema, migrations, indexes, generated Prisma Client, DB data, `.env`, search behavior, or search optimization code. Do not run DB reads/writes as part of this documentation ticket. |
| Inputs | `scripts/perf/README.md`, `scripts/perf/synthetic-scale-plan.md`, `scripts/perf/search-optimization-decision.md`, `scripts/perf/synthetic-dataset-contract.md`, and the six M2-Perf-12 JSON artifacts under `perf-results/`. |
| Expected output | Updated decision documentation plus an optional `perf-results/README.md` run summary that a follow-up optimization ticket can cite directly. |
| Safety rules | Documentation-only. No `.env` edits, DB connections, DB writes, migrations, Prisma schema edits, index add/drop, generated Prisma Client changes, `next-env.d.ts` edits, or search optimization code changes. |

## M2-Perf-12 Synthetic Local Measurement Summary

Artifacts summarized here:

- `perf-results/baseline-local-synthetic-1k-songs-10k-aliases-20260707T125027Z.json`
- `perf-results/query-shape-local-synthetic-1k-songs-10k-aliases-20260707T125027Z.json`
- `perf-results/explain-local-synthetic-1k-songs-10k-aliases-20260707T125027Z.json`
- `perf-results/baseline-local-synthetic-10k-songs-100k-aliases-20260707T130129Z.json`
- `perf-results/query-shape-local-synthetic-10k-songs-100k-aliases-20260707T130129Z.json`
- `perf-results/explain-local-synthetic-10k-songs-100k-aliases-20260707T130129Z.json`

Run metadata:

| Dataset label | Started at | DB label | Iterations | Warmup | Fixture |
| ------------- | ---------- | -------- | ---------: | -----: | ------- |
| `synthetic-1k-songs-10k-aliases` | 2026-07-07T12:51:34Z | `local` | 10 | 3 | `perf-results/search-measurement-fixture-synthetic-1k-songs-10k-aliases.csv` |
| `synthetic-10k-songs-100k-aliases` | 2026-07-07T13:02:59Z | `local` | 10 | 3 | `perf-results/search-measurement-fixture-synthetic-10k-songs-100k-aliases.csv` |

Observed row counts:

| Dataset label | Songs | Song aliases | Karaoke entries | Karaoke providers |
| ------------- | ----: | -----------: | --------------: | ----------------: |
| `synthetic-1k-songs-10k-aliases` | 1,000 | 10,000 | 2,258 | 6 |
| `synthetic-10k-songs-100k-aliases` | 10,000 | 100,000 | 22,520 | 12 |

Validation status:

- The measurement artifacts record row counts inside the expected 1k/10k
  contract ranges and all listed baseline/query-shape scenarios completed.
- A standalone validation report artifact was not present in the supplied
  `perf-results/` set, so this document treats validation as evidenced by
  measurement metadata and successful scenario execution rather than by a
  separate validation JSON.
- Both baseline artifacts still report `dataset.scale_scenario` as
  `current_seed`; that metadata label is stale for synthetic runs and should be
  fixed before relying on automated report grouping.

Baseline local p95 summary:

| Case | 1k API p95 ms | 10k API p95 ms | 1k service p95 ms | 10k service p95 ms |
| ---- | ------------: | -------------: | ----------------: | -----------------: |
| Normalized exact | 21.79 | 85.80 | 13.16 | 129.38 |
| Normalized prefix | 20.30 | 93.21 | 23.28 | 97.60 |
| Normalized contains | 14.37 | 85.99 | 19.51 | 84.63 |
| Hangul chosung prefix | 16.19 | 83.92 | 16.42 | 86.37 |
| No-result suggestions | 26.12 | 110.24 | 14.14 | 121.05 |
| Valid provider filter | 17.99 | 50.33 | 17.67 | 47.90 |
| High candidate partial query | 40.47 | 43.80 | 12.96 | 52.17 |
| High entry-count payload | 12.28 | 49.98 | 10.29 | 47.80 |

Interpretation:

- Warm local p95 is below the M2-Perf-08 gates of 300ms at 10k aliases and
  500ms at 100k aliases.
- 10k-song/100k-alias latency is materially higher than 1k-song/10k-alias
  latency for exact, prefix, contains, chosung, and no-result paths.
- High-candidate partial query response bytes grew from 26,386 to 29,328 bytes.
  High-entry payload response bytes grew from 2,834 to 5,533 bytes.

Query-shape SQL count summary:

| Case | Actual SQL queries | Client method calls | Candidate groups | Unique alias IDs | Relation load |
| ---- | -----------------: | ------------------: | ---------------: | ---------------: | ------------- |
| Normalized exact | 6 | 4 | 2 | 1 | Batched, not N+1 |
| Normalized prefix | 7 | 5 | 3 | 1 | Batched, not N+1 |
| Normalized contains | 7 | 5 | 3 | 1 | Batched, not N+1 |
| Hangul chosung prefix | 8 | 6 | 4 | 1 | Batched, not N+1 |
| No-result suggestions | 5 | 5 | 3 | 0 | Detail not executed |
| Valid provider filter | 6 | 4 | 2 | 1 | Batched, not N+1 |
| High candidate partial query | 6 | 4 | 2 | 100 | Batched, not N+1 |
| High entry-count payload | 6 | 4 | 2 | 1 | Batched, not N+1 |
| Invalid provider API path | 1 | 1 | 0 | 0 | Detail not executed |

The 1k and 10k query-shape counts match for the representative cases. Scale
pressure is therefore not from extra Prisma round trips in these runs; it is
from larger alias scans and larger payloads within the same query shape.

EXPLAIN rows scanned and index usage:

| Shape | 1k/10k alias run | 10k/100k alias run | Index usage |
| ----- | ---------------: | -----------------: | ----------- |
| Exact `normalized_alias ILIKE $1` | 10,000 scanned, 1 returned | 100,000 scanned, 1 returned | No index |
| Prefix `normalized_alias ILIKE ($1 || '%')` representative exact/prefix cases | 10,000 scanned, 1 returned | 100,000 scanned, 1 returned | No index |
| Contains `normalized_alias ILIKE ('%' || $1 || '%')` representative cases | 10,000 scanned, 1 returned | 100,000 scanned, 1 returned | No index |
| Chosung `chosung_alias ILIKE ($1 || '%')` | 10,000 scanned, 1 returned | 100,000 scanned, 1 returned | No index |
| High-candidate `star` prefix | 2,355 scanned, 100 returned | 22,605 scanned, 100 returned | `song_aliases_normalized_alias_idx` used |
| High-candidate `star` contains | 2,455 scanned, 200 returned | 22,705 scanned, 200 returned | `song_aliases_normalized_alias_idx` used |
| Detail lookup by alias ID | 1 scanned, 1 returned | 1 scanned, 1 returned | `song_aliases_pkey` used |
| Detail with song and entries | 4 scanned, 2 returned | 4 scanned, 2 returned | PK and `karaoke_entries_song_status_idx` used |
| Provider active lookup | 6 scanned, 5 returned | 12 scanned, 11 returned | No index, small table |
| `GET /api/providers` active country order | 2 scanned, 2 returned | 4 scanned, 4 returned | `karaoke_providers_country_active_order_idx` used |

The strongest scale signal is that exact, representative prefix, representative
contains, and chosung searches scan the full alias table at 100k aliases. The
baseline gate is not crossed locally, but the full-table scan behavior is a
credible precondition for an index/search-strategy experiment.

Tooling issues observed or carried into the M2-Perf-12 handoff:

- Synthetic measurement fixtures are projection fixtures with
  `query,expected_song_id,label`; they do not yet carry the full synthetic
  fixture contract columns such as `case_id`, `expected_match_type`,
  `provider_id`, and `dataset_label`.
- 10k dry-run/import work hit a stack-limit issue before a guarded local batch
  import path was used.
- Prisma transaction timeout risk exists for large synthetic imports; current
  import wrappers use a 30s transaction timeout and should not be treated as
  the final large-load strategy.
- Guarded local batch import was used for synthetic data handling. Keep the
  guard posture: local/sandbox only, no Neon synthetic import, and no broad
  remote load tests.

## Optimization Decision Draft After M2-Perf-12

### Decision

Do not apply schema, migration, index, trigram, or search rewrite changes in
M2-Perf-13. Open a focused optimization experiment ticket that compares the
current 100k-alias baseline against a small set of read-only query/index
strategy prototypes, then decide whether a migration-backed index is justified.

### Evidence

- Warm local API p95 remains below the M2-Perf-08 action gates: the highest 100k
  alias API p95 in the summarized search cases is 110.24ms for no-result
  suggestions, below the 500ms synthetic 100k gate.
- The same query-shape cost repeats at 1k and 10k song scales: successful
  searches issue 6-8 actual SQL queries depending on candidate groups, with
  relation loading batched rather than N+1.
- EXPLAIN shows full alias-table scans for representative exact, prefix,
  contains, and chosung shapes at both 10k and 100k aliases.
- Detail lookup and relation side plans already use primary/entry indexes and
  are not the main scale risk in these artifacts.
- High-candidate and payload cases show response-size pressure but not enough
  latency evidence to justify payload or pagination work before the search scan
  experiment.

### Recommended next experiment

Create `[M2-Perf-14] PostgreSQL search index strategy spike for synthetic 100k
aliases`.

The experiment should run only on an isolated local/sandbox DB and compare:

- Current `ILIKE` plans and p95 from the M2-Perf-12 artifacts.
- Case-insensitive exact/prefix options, such as expression or operator-class
  indexes that the planner actually uses for the current SQL shape.
- A contains-search option, likely `pg_trgm`, measured separately because it has
  extension, index-size, and write-cost implications.
- Existing smoke/search fixtures to catch ranking or recall changes if any query
  rewrite is tested.

Expected output should be an experiment report with before/after baseline p95,
EXPLAIN rows scanned, index names used, index size/write-cost notes, and a clear
recommendation to apply, defer, or reject each option.

### Deferred options

| Option | Reason to defer |
| ------ | ---------------- |
| Direct migration/index application | M2-Perf-12 is enough to justify an experiment, not a production migration. |
| Search query rewrite or raw SQL CTE | Behavioral/ranking risk is higher than a pure plan experiment. |
| Payload trimming | Payload growth is visible, but latency is still below gate and relation loading is batched. |
| Pagination/cursor API | Result volume evidence is limited to capped synthetic cases; user-facing semantics are not defined. |
| External search engine | Operational cost is too high before in-DB options are measured. |

### Risks

- Local warm measurements understate remote/cold latency, especially with Neon
  connection acquisition and app-route overhead.
- Synthetic aliases may not represent real Korean/Japanese romanization,
  abbreviation, typo, or contains-search distributions.
- `ILIKE` planner behavior depends on collation, expression shape, operator
  class, and parameterization; an index can be created and still remain unused.
- `pg_trgm` may improve contains search while adding extension/index-size/write
  overhead that is not visible in read-only search timings.
- The fixture projection and stale `dataset.scale_scenario` metadata can confuse
  automated report comparisons until fixed.

### Open questions

- What p95 target should be used for local 100k aliases after the product
  chooses an expected catalog size and deployment DB topology?
- Should exact/prefix and contains be optimized independently, with contains
  gated behind evidence that users actually need substring search at scale?
- Should provider lookup reuse/cache and candidate fan-out reduction be
  completed before or after the index strategy spike for remote latency?
- Should the synthetic fixture be upgraded to the full contract before the next
  optimization experiment, or is the current projection acceptable for one more
  local-only spike?
- What is the acceptable index size/import write overhead for MVP seed updates?

## Follow-Up Ticket Candidates

Created Notion tickets:

| Ticket                                                             | Scope                                                                                                                    | Priority | URL                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------- |
| `[M2-Perf-05] 검색 API route-level latency 측정 및 회귀 기준 확정` | Keep the `x-perf-timing` route diagnostics reproducible and define the baseline/acceptance numbers for optimization PRs. | High     | https://app.notion.com/p/3954c60a730381c8bec7c152363c7617 |
| `[M2-Perf-06] active provider 조회 cache/reuse 적용`               | Remove or reduce the provider lookup round trip from every search while preserving provider validation/default behavior. | High     | https://app.notion.com/p/3954c60a730381d9b77fc74bc17271d3 |
| `[M2-Perf-07] 검색 candidate query fan-out 축소`                   | Reduce the `Promise.all` candidate lookup fan-out, especially always-running contains/prefix/chosung lookups.            | High     | https://app.notion.com/p/3954c60a730381618621fc4304b92fb8 |
| `[M2-Perf-08] synthetic scale 검색 성능 측정 기준 설계`            | Define future synthetic scale labels, measurement matrix, and gates for index/trigram/query-rewrite decisions.           | Medium   | https://app.notion.com/p/3954c60a7303813b907de9064c3c4e6d |

Deferred candidate tickets after M2-Perf-08:

| Candidate                              | Trigger                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `[M2-Perf-14] PostgreSQL search index strategy spike for synthetic 100k aliases` | M2-Perf-12 EXPLAIN shows full alias-table scans at 100k aliases, even though warm local p95 remains below gate. |
| `[M2-Perf-16] reduce search DB round-trips with raw SQL query shape` | After M2-Perf-15, production has the normalized trigram index, but current seed timing still shows route latency dominated by provider, candidate, and alias-detail DB round trips. Notion: https://app.notion.com/p/3974c60a73038187a57eca2d04bbc2a3 |
| Search payload trimming proposal       | Response bytes or relation-load timing grows with entries per song/provider.        |
| Pagination/cursor design               | Result counts exceed first-page needs and stable cursor semantics become necessary. |
| Synthetic fixture contract completion  | Fixture projection blocks reliable case ID, provider filter, and dataset-label validation across tools. |
| Synthetic import scalability hardening | Large local imports continue to hit stack, transaction timeout, or batching limits. |

## Final Status

For the current seed, the system still has a confirmed search route latency
issue even though DB execution is cheap. M2-Perf-12 adds the missing local
synthetic-scale evidence: warm local 100k-alias p95 is below the current gate,
but representative exact, prefix, contains, and chosung candidate searches scan
the full alias table. M2-Perf-13 therefore remains documentation-only and should
hand off to a focused local/sandbox index strategy spike before any
schema/index/search-engine change is applied.
