# M2-Perf-16 Search Round-Trip Rewrite Plan

Last updated: 2026-07-08

This document defines the next large search performance improvement after
M2-Perf-15. The goal is to reduce the number of remote database round trips on
`GET /api/search` while preserving the existing search response contract and
ranking behavior.

This is a planning and ticket-definition document. It does not apply code,
schema, migration, seed, or production data changes.

## Background

M2-Perf-15 applied the normalized alias trigram index:

```sql
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE INDEX CONCURRENTLY "song_aliases_normalized_alias_trgm_idx"
ON "song_aliases" USING gin ("normalized_alias" gin_trgm_ops);
```

Production post-check confirmed:

- `pg_trgm` installed version: `1.6`
- `song_aliases_normalized_alias_trgm_idx` present, valid, and ready
- `song_aliases` row count after fixture cleanup: 97
- synthetic data was not imported

The remaining latency signal is not primarily index selection. A representative
local dev request against Neon production data showed about 1.27s total route
time, mostly in DB calls:

| Timing event                              | Duration |
| ----------------------------------------- | -------: |
| `search.providers`                       | 526.66ms |
| `search.candidate.normalized_equals`     |  72.57ms |
| `search.candidate.normalized_starts_with` | 522.41ms |
| `search.alias_detail`                    | 217.13ms |
| `route.total`                            | 1267.87ms |

The current application path uses several Prisma calls:

1. Read active providers.
2. Run exact and prefix alias candidate queries.
3. Optionally run chosung and contains candidate queries.
4. Fetch alias detail with song and karaoke entry relations.
5. Rank in application code.
6. Run suggestions only when there are no results.

With a remote Neon database, this shape multiplies network, pool, and adapter
latency even when the database has few rows.

## Problem Statement

The search route needs fewer DB round trips per request. M2-Perf-16 should
replace the current multi-query candidate/detail fan-out with a smaller query
shape, preferably one SQL query for the successful search path plus a separately
measured provider validation/cache strategy.

## Goals

- Reduce successful `searchSongs()` DB calls for normal searches from the
  current multi-call Prisma path to one primary search query where practical.
- Preserve current API response shape:
  - `query`
  - `normalized_query`
  - `items`
  - `next_cursor`
  - `suggestions`
- Preserve ranking semantics for existing smoke/search fixtures.
- Preserve provider filter behavior:
  - inactive or unknown `provider_id` still returns `INVALID_PROVIDER`
  - valid provider filters still limit karaoke entries consistently
  - default provider ranking remains stable
- Keep no-result suggestions behavior intact or explicitly document any
  separate query path for suggestions.
- Keep the M2-Perf-15 trigram index usable for normalized alias predicates.

## Non-Goals

- Do not change Prisma schema or add migrations.
- Do not add more indexes in this ticket.
- Do not add a chosung trigram index.
- Do not introduce external search infrastructure.
- Do not change public API payload fields.
- Do not import synthetic data into Neon or production-like databases.
- Do not change seed data.
- Do not solve deployment region placement in this ticket.

## Candidate Implementation Direction

Use a raw SQL CTE query behind a narrow internal adapter while keeping the
public `searchSongs()` API stable.

The successful search SQL should:

- Build candidate aliases with tier metadata:
  - exact normalized alias
  - normalized prefix
  - chosung prefix when applicable
  - normalized contains only when needed or as a low-priority branch
- Deduplicate by alias and song.
- Apply the same deterministic ordering inputs used by `rankSongs()`:
  - match tier
  - normalized alias ordering
  - song id
  - alias
  - id
- Join songs and karaoke entries in the same round trip.
- Return enough structured rows for the existing response mapper or a new
  equivalent mapper.

Provider handling should be measured separately:

- Keep active provider data cached outside the hot path when possible.
- Avoid a provider lookup for every request if no provider filter is present and
  ranking can use a cached default provider.
- Keep a bounded stale-data tradeoff documented because provider metadata
  changes rarely.

## Acceptance Criteria

- Existing search unit tests pass.
- Add focused regression tests for:
  - exact normalized match
  - normalized prefix match
  - normalized contains match
  - chosung match
  - no-result suggestions
  - valid provider filter
  - invalid provider filter
  - deterministic ordering when multiple aliases match
- Query-shape evidence shows fewer DB client calls and SQL statements on
  successful search paths.
- `x-perf-timing` evidence shows lower `route.search` or `route.total` on the
  current seed Neon path in a small, non-load-test sample.
- Local/sandbox synthetic 100k smoke keeps ranking and payload shape stable.
- No production DDL/DML is run for measurement.

## Verification Plan

Local code validation:

```bash
npm run lint
npm run format
npm run typecheck
npm test
```

Search/perf validation:

```bash
npm run seed:search-smoke
npm run perf:query-shape -- --db-label local --case-limit 4
npm run perf:baseline -- --db-label local --iterations 3 --warmup 1
```

Neon/current-seed validation should be low volume only:

- One normal search with `x-perf-timing`.
- One no-result search.
- One provider-filter search.
- No load test.
- No synthetic import.

## Risks

- Raw SQL can drift from Prisma model names and relation mapping.
- Ranking equivalence is behavior-sensitive and needs golden fixture coverage.
- JSON aggregation in SQL can reduce round trips but may increase query
  complexity and response mapping risk.
- Provider caching can make provider activation/deactivation stale for a bounded
  period.
- Trigram indexes help predicate filtering but do not eliminate remote
  connection or query fan-out costs by themselves.

## Ticket Definition

| Field | Value |
| ----- | ----- |
| Title | `[M2-Perf-16] reduce search DB round-trips with raw SQL query shape` |
| Goal | Collapse the successful search path into fewer DB round trips while preserving ranking, provider behavior, and payload shape. |
| Scope | Design and implement a raw SQL/CTE-backed search path or equivalent lower-round-trip query shape; update tests, query-shape evidence, and small timing smoke. |
| Priority | High |
| Notion | https://app.notion.com/p/3974c60a73038187a57eca2d04bbc2a3 |
| Non-goals | No schema/index changes, no production data writes, no synthetic import to Neon, no deployment-region work. |
| Inputs | `lib/search/search.ts`, `lib/search/timing.ts`, `lib/perf/query-shape.ts`, `scripts/perf/search-index-strategy-spike.md`, this document. |
| Expected output | Implementation PR with behavior tests, query-shape comparison, timing notes, and rollback path to the existing Prisma search path if needed. |
