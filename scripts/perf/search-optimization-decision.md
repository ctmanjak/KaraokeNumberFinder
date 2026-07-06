# M2-Perf-04 Search Optimization Decision

Last updated: 2026-07-06

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
| PostgreSQL search index strategy spike | Synthetic EXPLAIN shows high rows scanned or warm p95 exceeds the defined gate.     |
| Search payload trimming proposal       | Response bytes or relation-load timing grows with entries per song/provider.        |
| Pagination/cursor design               | Result counts exceed first-page needs and stable cursor semantics become necessary. |

## Final Status

For the current seed, the system has a confirmed search route latency issue even
though DB execution is cheap. The immediate current-seed risk is remote DB
round-trip and connection fan-out inside the current query shape, especially the
provider lookup and parallel candidate lookup phase. The main future-scale risk
is still data scale: case-insensitive prefix/contains/chosung candidate searches
are not using existing btree indexes in sampled Neon plans. The next responsible
steps are to reduce current-seed route latency with a focused provider/candidate
query-shape ticket, then run synthetic scale measurement before any
schema/index/search-engine change.
