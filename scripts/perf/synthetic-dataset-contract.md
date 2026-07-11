# M2-Perf-09 Synthetic Search Dataset Contract

Last updated: 2026-07-06

## Scope

This document defines the contract for future synthetic search dataset
generation, import, fixture cases, and row-count validation. It exists so later
implementation tickets can build the generator/import flow without changing the
measurement contract from `[M2-Perf-08]`.

This ticket is documentation only. It does not implement synthetic data
generation, import/load scripts, validation commands, Prisma schema changes,
migrations, indexes, generated Prisma Client changes, DB data changes, `.env`
changes, search optimization code, or performance runs.

## Non-goals

- Do not generate or import synthetic rows in this ticket.
- Do not load synthetic data into Neon.
- Do not run synthetic perf measurement.
- Do not change the existing `seed/search-smoke.csv` current-seed fixture.
- Do not add, remove, or tune database indexes.
- Do not change search ranking, query shape, API payloads, or provider behavior.

## Dataset Labels

Every generated dataset, fixture file, validation report, and perf report must
record one of these labels exactly.

| Dataset label                      | Lifecycle          | Purpose                                                 |
| ---------------------------------- | ------------------ | ------------------------------------------------------- |
| `current-seed`                     | Existing           | Real small seed for correctness, smoke, and noise floor |
| `synthetic-1k-songs-10k-aliases`   | Next implement     | First scale threshold for candidate scan behavior       |
| `synthetic-10k-songs-100k-aliases` | Next implement     | Prefix, contains, chosung, and payload growth pressure  |
| `synthetic-50k-songs-500k-aliases` | Future placeholder | Post-MVP or catalog-size stress checks                  |

Synthetic fixture rows and imported DB rows must use the same
`dataset_label`. If they differ, the perf run is invalid and must not start.

## Row-count Targets and Tolerance

Validation must compare observed row counts with these targets before any
synthetic measurement is trusted.

| Dataset label                      | songs target | song_aliases target | karaoke_entries target | karaoke_providers target | Tolerance                                       |
| ---------------------------------- | -----------: | ------------------: | ---------------------: | -----------------------: | ----------------------------------------------- |
| `current-seed`                     |           15 |                 100 |                     16 |                        4 | Exact counts required                           |
| `synthetic-1k-songs-10k-aliases`   |        1,000 |              10,000 |            2,000-5,000 |                     4-10 | Songs/aliases exact; entries/providers in range |
| `synthetic-10k-songs-100k-aliases` |       10,000 |             100,000 |          20,000-50,000 |                     4-20 | Songs/aliases exact; entries/providers in range |
| `synthetic-50k-songs-500k-aliases` |       50,000 |             500,000 |        100,000-250,000 |                     4-30 | Future; same rule unless revised                |

Songs and aliases are exact because they name the dataset label. Entries and
providers are ranges because fan-out distribution is part of the synthetic
shape, but each generated dataset must record the actual observed counts.

## Synthetic Data Shape

The generator must create rows that match the existing Prisma model and seed CSV
shape without requiring schema changes.

### Songs

- IDs must be deterministic and label-scoped, for example
  `synthetic_1k_song_000001` or `synthetic_10k_song_000001`.
- `canonical_title` should be stable machine-friendly source text, while
  `display_title` should include the user-facing variant used by fixture cases.
- `canonical_artist` should include repeated artist families and unique artists
  so artist aliases create both exact and broad partial cases.
- `original_language` should include a realistic mix of `ja`, `ko`, `en`, and
  optional additional languages. The 1k and 10k datasets should include enough
  Korean rows to cover chosung fixtures.
- `release_year` should span a broad range, with nulls allowed only if the
  existing CSV/model contract allows them.
- `tie_in` should be present on a meaningful subset to exercise anime, drama,
  game, movie, and no tie-in paths.
- Source and verification fields must make synthetic origin explicit, for
  example `source_name=synthetic-generator` and
  `verified_by=synthetic-generator`.

Recommended distribution:

| Field area   | Target distribution                                                                 |
| ------------ | ----------------------------------------------------------------------------------- |
| Language     | About 35% Japanese, 35% Korean, 20% English, 10% mixed/other                        |
| Release year | Mostly 1990-current, with a smaller older bucket and deterministic null bucket      |
| Tie-in       | About 40% no tie-in, 20% anime, 15% drama, 10% game, 10% movie, 5% other            |
| Artist reuse | Mix unique artists with repeated families for high-candidate artist partial queries |

### Aliases

Aliases must create predictable coverage for exact, prefix, contains, chosung,
near-match, high-candidate, and artist/title variants. Each song should have a
base alias set plus targeted fixture aliases.

Recommended alias-type distribution:

| Alias type           | Approximate share | Purpose                                         |
| -------------------- | ----------------: | ----------------------------------------------- |
| `canonical_title`    |            10-15% | Exact normalized canonical matches              |
| `display_title`      |            15-20% | User-facing title matches                       |
| `artist`             |            10-15% | Artist search and repeated artist pressure      |
| `romanized_title`    |            15-20% | Latin prefix/contains coverage for JP/KR titles |
| `english_title`      |             5-10% | English exact/prefix cases                      |
| `translated_title`   |             5-10% | Cross-language contains cases                   |
| `content`            |             5-10% | Tie-in and series/title association cases       |
| `abbreviation`       |             5-10% | Short normalized exact and prefix cases         |
| `common_name`        |             5-10% | Alternate user phrasing                         |
| `alternate_spelling` |             5-10% | Near-match and spelling variation cases         |

Required alias patterns:

| Pattern goal                          | Required shape                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Normalized exact                      | At least one fixture alias whose normalized value equals the query exactly                                |
| Normalized prefix                     | At least one fixture alias where many rows share a deterministic prefix and the expected song ranks first |
| Normalized contains                   | At least one fixture alias where the query appears inside the normalized alias, not at the start          |
| Hangul chosung prefix                 | Korean display/common aliases with two-or-more chosung initials, for example a query like `ㅅㅌ`          |
| No-result suggestions                 | Near-match aliases that are close to a missing query but do not produce direct results                    |
| High-candidate partial query pressure | Hundreds or thousands of aliases sharing a prefix or substring such as `star`, `blue`, or a Korean stem   |
| High-entry-count song payload         | A fixture song whose aliases resolve to a song with unusually high karaoke entry fan-out                  |

Generated aliases must preserve the existing normalization rules used by the
application and seed tools. The generator should store both `normalized_alias`
and `chosung_alias` exactly as the app would derive them; validation should flag
rows where generated normalization does not match the shared normalization
helper.

### Karaoke Entries

Entries must exercise normal and high-payload relation loading.

- Most songs should have entries for one to three active providers.
- A smaller subset should have entries for more providers and multiple
  `version_info` values.
- The required `high-entry-count-song-payload` fixture song should fan out to a
  deliberately high entry count while staying within the dataset's total entry
  target range.
- `availability_status` should be mostly `available`, with deterministic
  `not_available`, `temporarily_unavailable`, and `unknown` rows included so the
  payload shape resembles real data.
- `karaoke_number` and `version_info` must be deterministic per provider/song
  pair and must satisfy the existing unique constraint.

Recommended fan-out:

| Entry group           | Share of songs | Entry shape                                                         |
| --------------------- | -------------: | ------------------------------------------------------------------- |
| Sparse/default        |         50-65% | One provider, one version                                           |
| Normal multi-provider |         25-40% | Two to three providers                                              |
| Variant-heavy         |           5-9% | Multiple versions across active providers                           |
| Fixture high-payload  |          1 row | Many provider/version rows for `high-entry-count-song-payload` case |

### Karaoke Providers

Provider setup must support valid and invalid provider filter cases.

- Each synthetic dataset must include at least one active default provider.
- Each synthetic dataset must include multiple active providers ordered by
  `display_order`.
- Include at least one inactive provider when provider count allows it, so
  validation can distinguish active filtering from mere ID existence.
- The fixture `valid-provider-filter` must reference an active provider that has
  entries for the expected song.
- The fixture `invalid-provider-filter` must use a stable non-existent provider
  ID such as `synthetic_missing_provider`.
- Provider IDs must be deterministic and label-scoped, for example
  `synthetic_1k_provider_01`.

## Deterministic Generation Policy

Synthetic generation must be reproducible.

- Use a fixed random seed per dataset label.
- Record the random seed in generator output, validation reports, and perf PR
  summaries.
- Record a generator version string. Increment it whenever the row distribution,
  ID scheme, fixture selection, or normalization behavior changes.
- Record the generated dataset label in every generated CSV/report artifact.
- Keep fixture `case_id` values stable across generator versions unless a
  deliberate breaking change is documented.
- Prefer deterministic fixture song/provider IDs over random row selection.
- Generated timestamps and dates must be deterministic or intentionally omitted
  when the CSV/model allows nulls.

Suggested initial metadata:

| Dataset label                      | Random seed | Initial generator version |
| ---------------------------------- | ----------: | ------------------------- |
| `synthetic-1k-songs-10k-aliases`   |        1009 | `synthetic-search-v1`     |
| `synthetic-10k-songs-100k-aliases` |       10009 | `synthetic-search-v1`     |
| `synthetic-50k-songs-500k-aliases` |       50009 | `synthetic-search-v1`     |

## Fixture/Search-case CSV Contract

`seed/search-smoke.csv` remains the current-seed fixture with its existing
columns:

```csv
query,expected_song_id,label
```

Future synthetic fixtures should use:

```text
seed/search-synthetic-scale.csv
```

Required columns:

| Column                | Required | Description                                                                  |
| --------------------- | -------- | ---------------------------------------------------------------------------- |
| `case_id`             | Yes      | Stable machine-readable scenario ID                                          |
| `label`               | Yes      | Human-readable case label                                                    |
| `query`               | Yes      | Search query to send to the harness                                          |
| `expected_song_id`    | Yes      | Expected top or included song ID, depending on case semantics                |
| `expected_match_type` | Yes      | Expected path such as `exact`, `prefix`, `contains`, `chosung`, `suggestion` |
| `provider_id`         | No       | Optional provider filter. Empty means no provider filter                     |
| `dataset_label`       | Yes      | Dataset label required for fixture/dataset matching                          |
| `notes`               | No       | Short operator-facing explanation                                            |

Required `case_id` values:

| case_id                         | Expected match type | Required behavior                                                                 |
| ------------------------------- | ------------------- | --------------------------------------------------------------------------------- |
| `normalized-exact`              | `exact`             | Query normalized value equals a generated alias exactly                           |
| `normalized-prefix`             | `prefix`            | Query matches the beginning of generated normalized aliases                       |
| `normalized-contains`           | `contains`          | Query matches inside generated normalized aliases                                 |
| `hangul-chosung-prefix`         | `chosung`           | Query uses two-or-more Hangul initials and matches `chosung_alias` by prefix      |
| `no-result-suggestions`         | `suggestion`        | Direct results are empty and suggestions are expected from near-match aliases     |
| `valid-provider-filter`         | `provider-filter`   | Active provider filter returns the expected song                                  |
| `invalid-provider-filter`       | `invalid-provider`  | Invalid provider ID fails before candidate/detail execution                       |
| `high-candidate-partial-query`  | `partial-pressure`  | Query creates broad candidate pressure while preserving deterministic expectation |
| `high-entry-count-song-payload` | `payload-fanout`    | Expected song has unusually high karaoke entry fan-out                            |

The fixture may include additional cases, but validation must fail if any
required `case_id` is missing for a synthetic dataset label.

Example header:

```csv
case_id,label,query,expected_song_id,expected_match_type,provider_id,dataset_label,notes
```

## Row-count Validation and Report Contract

The validation command is not implemented in this ticket. Future implementation
should expose this command shape:

```sh
npm run perf:dataset-validate -- --dataset-label synthetic-1k-songs-10k-aliases
npm run perf:dataset-validate -- --dataset-label synthetic-10k-songs-100k-aliases --fixture seed/search-synthetic-scale.csv
```

The command must be read-only after import. It may query row counts and fixture
coverage but must not write DB rows, generate migrations, update `.env`, or
modify generated Prisma Client files.

Report fields:

| Field                   | Description                                                                  |
| ----------------------- | ---------------------------------------------------------------------------- |
| `schema_version`        | Validation report schema version, initially `1`                              |
| `dataset_label`         | Requested dataset label                                                      |
| `generator_version`     | Generator version recorded by generated dataset metadata                     |
| `random_seed`           | Fixed random seed used for the dataset                                       |
| `db_label`              | Operator-provided DB label such as `local` or `sandbox`                      |
| `row_counts`            | Observed `songs`, `song_aliases`, `karaoke_entries`, `karaoke_providers`     |
| `row_count_targets`     | Target/range contract used for comparison                                    |
| `row_count_result`      | Per-table pass/fail and observed delta or range result                       |
| `fixture_path`          | Fixture file used                                                            |
| `fixture_case_coverage` | Required case IDs present/missing and fixture dataset-label consistency      |
| `pass`                  | Overall boolean pass/fail                                                    |
| `warnings`              | Non-fatal warnings, including future-label use or optional distribution gaps |
| `errors`                | Fatal validation failures                                                    |

Example shape:

```json
{
  "schema_version": 1,
  "dataset_label": "synthetic-1k-songs-10k-aliases",
  "generator_version": "synthetic-search-v1",
  "random_seed": 1009,
  "db_label": "local",
  "row_counts": {
    "songs": 1000,
    "song_aliases": 10000,
    "karaoke_entries": 3120,
    "karaoke_providers": 6
  },
  "fixture_case_coverage": {
    "fixture_path": "seed/search-synthetic-scale.csv",
    "required_case_ids_present": [
      "normalized-exact",
      "normalized-prefix",
      "normalized-contains",
      "hangul-chosung-prefix",
      "no-result-suggestions",
      "valid-provider-filter",
      "invalid-provider-filter",
      "high-candidate-partial-query",
      "high-entry-count-song-payload"
    ],
    "missing_case_ids": [],
    "dataset_label_mismatches": []
  },
  "pass": true,
  "warnings": []
}
```

## Execution Principles

- Use local or isolated sandbox databases for synthetic import/load first.
- Do not import or load synthetic datasets into Neon.
- Do not run broad synthetic perf iterations against Neon.
- Run row-count and fixture validation before baseline, query-shape, or EXPLAIN
  measurement.
- Refuse measurement when the fixture `dataset_label` does not match the
  requested dataset label.
- Refuse measurement when row-count validation fails.
- Synthetic-scale evidence must be labeled separately from `current-seed`
  evidence in PR summaries and result filenames.
- The generator/import flow must be explicit about whether it appends to or
  replaces a local/sandbox database dataset. The first implementation should
  prefer isolated replace/reset semantics for synthetic databases only.

## Handoff to Implementation

Follow-up tickets should split implementation from measurement:

| Ticket                                                      | Responsibility                                                                                           | Depends on       | URL                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------- |
| `[M2-Perf-10] synthetic dataset generator/import 구현`      | Build deterministic generator and local/sandbox import flow for 1k and 10k labels                        | This contract    | https://app.notion.com/p/3954c60a730381148834c704749fd93d |
| `[M2-Perf-11] synthetic dataset validation command 구현`    | Add read-only `perf:dataset-validate` command and report contract enforcement                            | M2-Perf-10 shape | https://app.notion.com/p/3954c60a730381578985c9c01cb0cbdf |
| `[M2-Perf-12] synthetic 1k/10k local perf measurement 실행` | Run validation, then baseline/query-shape/EXPLAIN for 1k and 10k local/sandbox datasets; summarize gates | M2-Perf-10, 11   | https://app.notion.com/p/3954c60a730381a8b331eaf6f885deb1 |

Only after those tickets produce evidence should optimization tickets propose
schema, index, trigram, query rewrite, payload trimming, or pagination changes.
