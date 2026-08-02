# ADMIN-T05 administrator catalog phase 1 integration gate

This document is the release-evidence index for ADMIN-T05. It connects every
phase 1 decision in the administrator catalog specification to existing
ADMIN-T02 through ADMIN-T04 implementation or to a narrowly scoped ADMIN-T05
verification gap. The audit was performed from `origin/develop` commit
`85a72af31973dba16e3f31bd7bc29e4b3e44b241`.

## Scope and safety boundary

- The audit does not add a new product capability or alter the phase 1 scope.
- Synthetic data may be used only in positively identified disposable
  loopback PostgreSQL databases. It must not be loaded into production,
  staging, or a shared database.
- This work does not deploy, apply a production migration, enable
  `ADMIN_CATALOG_MODE=on`, merge/delete catalog rows, or select a canonical
  Song for an existing duplicate group.
- A non-empty duplicate preflight is release-blocking and requires a separate,
  approved cleanup ticket. A zero-group result does not create such a ticket.
- No credential, email, token, cookie, CSRF value, request body, or user ID is
  retained in release evidence.

## Prior implementation and CI evidence

| Work      | Merge evidence                                                                                     | Existing validation evidence                                                                                                                                                                                                                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADMIN-T02 | [PR #49](https://github.com/ctmanjak/KaraokeNumberFinder/pull/49), head `eca39f2`, merge `1ca18b4` | [Quality](https://github.com/ctmanjak/KaraokeNumberFinder/actions/runs/30231451284), [Browser E2E](https://github.com/ctmanjak/KaraokeNumberFinder/actions/runs/30231451315), and [M3 schema](https://github.com/ctmanjak/KaraokeNumberFinder/actions/runs/30231451300) succeeded.                                                            |
| ADMIN-T03 | [PR #50](https://github.com/ctmanjak/KaraokeNumberFinder/pull/50), head `f9aed2a`, merge `130cc24` | [Quality](https://github.com/ctmanjak/KaraokeNumberFinder/actions/runs/30320834323), [Browser E2E](https://github.com/ctmanjak/KaraokeNumberFinder/actions/runs/30320834466), and [M3 schema](https://github.com/ctmanjak/KaraokeNumberFinder/actions/runs/30320834327) succeeded; PR/perf artifacts retain PostgreSQL and 10K/100K evidence. |
| ADMIN-T04 | [PR #51](https://github.com/ctmanjak/KaraokeNumberFinder/pull/51), head `e02ced9`, merge `85a72af` | [Quality](https://github.com/ctmanjak/KaraokeNumberFinder/actions/runs/30606037717) and [Browser E2E](https://github.com/ctmanjak/KaraokeNumberFinder/actions/runs/30606037751) succeeded; PR body records 720 unit, 12 PostgreSQL integration, and 21 Chromium tests.                                                                        |

## D1-D42 traceability and gap matrix

Status values are deliberately evidence-oriented: **existing evidence** means
ADMIN-T05 did not rewrite that behavior; **T05 verified** means the original
audit found a test, CI, or documentation gap and this branch closed only that
gap.

| ID  | Requirement                                                                                                                                                                | Current status                       | Existing evidence (implementation, test, PR, CI)                                                                         | Actual gap                                                                                                                                                    | Minimum T05 action                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| D1  | Successful create/update is immediately public; no draft workflow.                                                                                                         | T05 verified                         | Existing repositories/search plus `e2e/admin-song-detail.spec.ts`; PRs #50/#51.                                          | Closed: one Chromium flow now proves list search -> detail update, alias/entry addition, and public-search reflection.                                        | Existing product code unchanged; integrated E2E only.                                                |
| D2  | Only administrator aliases are deletable; system aliases, entries, and Song are not.                                                                                       | Existing evidence                    | `components/admin/AdminSongDetailPage.tsx`; `AdminSongDetailPage.test.tsx`; `repository.integration.test.ts`; PR #50.    | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D3  | Normalized canonical title+artist exact match blocks create without override.                                                                                              | Existing evidence                    | `lib/song-identity/normalize.ts`; `lib/admin-song/repository.integration.test.ts`; create Chromium exact branch; PR #51. | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D4  | Possible candidates (max five) require explicit review but do not automatically block creation.                                                                            | Existing evidence                    | duplicate repository/matcher; create page component tests and Chromium possible branch; PR #51.                          | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D5  | Exactly three system aliases are transactionally created/synchronized and are read-only.                                                                                   | Existing evidence                    | create/detail PostgreSQL integration tests; detail UI tests; PRs #50/#51.                                                | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D6  | Song, alias, and each provider entry keep independent sources.                                                                                                             | Existing evidence                    | create/detail repositories and their PostgreSQL integration tests; PRs #50/#51.                                          | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D7  | Verified provider states require a non-future verification date; unknown is optional.                                                                                      | Existing evidence                    | `lib/admin-song/entry-policy.ts` and tests; create/detail input/repository validation tests.                             | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D8  | Moving to unknown preserves the date unless explicitly cleared.                                                                                                            | Existing evidence                    | detail contextual validation/repository and UI draft tests; PR #50.                                                      | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D9  | Unknown -> verified state requires an explicitly submitted date.                                                                                                           | Existing evidence                    | shared entry policy tests and detail contextual validation tests; PR #50/#51 follow-up fixes.                            | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D10 | Verified -> different verified state also requires explicit date reconfirmation.                                                                                           | Existing evidence                    | `entry-policy.test.ts`; detail contextual validation; PR #51 review fixes.                                               | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D11 | Every provider status change requires source-name reconfirmation.                                                                                                          | Existing evidence                    | detail contextual validation and repository tests; detail UI.                                                            | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D12 | Not-available states require a trimmed non-empty verification note.                                                                                                        | Existing evidence                    | shared entry policy and indexed-path input tests.                                                                        | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D13 | Moving to an optional-note state preserves the note unless explicitly cleared.                                                                                             | Existing evidence                    | detail repository validation and UI draft behavior.                                                                      | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D14 | Song identity-field changes require source-name reconfirmation.                                                                                                            | Existing evidence                    | detail input/context validation and duplicate-aware edit UI tests.                                                       | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D15 | PATCH exact collision blocks and rolls back the full aggregate.                                                                                                            | Existing evidence                    | `lib/admin-song-detail/repository.integration.test.ts` exact-conflict rollback; detail service projection test.          | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D16 | PATCH possible collision requires review and exact-set acknowledgement.                                                                                                    | Existing evidence                    | detail component tests; detail repository unit/integration paths; PR #50.                                                | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D17 | Server recomputes and exactly compares acknowledged possible-candidate IDs.                                                                                                | Existing evidence                    | shared candidate acknowledgement validation; create/detail repository tests.                                             | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D18 | Candidate order is deterministic by both-signals, strengths, then Song ID.                                                                                                 | Existing evidence                    | duplicate SQL/repository and matcher tests; performance scenarios.                                                       | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D19 | Partial means candidate contains input after exact/prefix checks.                                                                                                          | Existing evidence                    | `lib/admin-song-duplicate/match.ts` and tests; SQL uses literal `strpos`.                                                | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D20 | Exact works at one code point; prefix/partial starts at two code points.                                                                                                   | Existing evidence                    | matcher constants and Unicode code-point test.                                                                           | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D21 | Duplicate check runs only with valid canonical title and artist; final transaction always rechecks.                                                                        | Existing evidence                    | `useDuplicateCheck` validation tests; duplicate input/route tests; create/detail repositories.                           | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D22 | Duplicate check uses 500 ms trailing debounce and stale-response disposal.                                                                                                 | Existing evidence                    | `useDuplicateCheck.ts` and stale/abort test.                                                                             | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D23 | Saving stays locked until the current fingerprint has a successful none/acknowledged-possible result.                                                                      | Existing evidence                    | create/detail component tests and duplicate hook state machine.                                                          | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D24 | Only transient failures retry once after one second; 4xx requires explicit handling.                                                                                       | Existing evidence                    | duplicate hook retry and 429 tests; create/detail input preservation.                                                    | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D25 | One all-candidates checkbox is used only for possible results.                                                                                                             | Existing evidence                    | create/detail component and Chromium tests.                                                                              | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D26 | POST and PATCH share `possible_duplicate_acknowledged_song_ids`.                                                                                                           | Existing evidence                    | shared DTO/types and create/detail repository tests.                                                                     | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D27 | CandidateSummary is an explicit redacted projection.                                                                                                                       | Existing evidence                    | duplicate types/repository; service and personalization error projection tests.                                          | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D28 | Existing-song links use validated IDs, a new tab, and `noopener` without clearing input.                                                                                   | Existing evidence                    | candidate components and Chromium exact branch.                                                                          | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D29 | Candidate inputs are canonical/display title plus canonical artist; pending admin aliases are excluded.                                                                    | Existing evidence                    | duplicate input normalization/matcher and repository query.                                                              | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D30 | Every AliasType is explicitly mapped title/artist/excluded and database types are preflighted fail-closed.                                                                 | T05 verified                         | Existing exhaustive map/tests plus `scripts/admin-song/verify-migration.ts`.                                             | Closed: disposable PostgreSQL evidence records all ten enum counts and `unmapped_alias_type_count=0`.                                                         | Verification only; matching behavior unchanged.                                                      |
| D31 | Normalized identity is NOT NULL+composite-unique; unique races map safely; rollback preserves Song data.                                                                   | T05 verified                         | Existing SQL/schema tests plus migration verifier and `repository.integration.test.ts`.                                  | Closed: executable contract/rollback and two-different-Song concurrent PATCH convergence are covered; nested adapter serialization conflicts map fail-closed. | Add verifier/test and reuse the existing conflict code taxonomy.                                     |
| D32 | Server TypeScript helper owns normalization and every write path dual-writes; drift blocks release.                                                                        | Existing evidence + T05 verification | `normalizeSongIdentity`; POST/PATCH/seed import; maintenance tests; disposable verifier.                                 | Closed by the D31 verifier: dry-run/apply/idempotence completed with zero remaining drift.                                                                    | No product change.                                                                                   |
| D33 | Existing duplicates block release and produce only a redacted report; cleanup is a separate approved ticket.                                                               | Existing evidence + T05 verification | `maintenance.ts`, tests, runbook, and disposable preflight output.                                                       | Disposable seed reported zero exact duplicate groups and zero system-alias violations. Production data was not inspected.                                     | No cleanup ticket created; any later non-zero environment result remains a separate approved ticket. |
| D34 | 10K Song/100K Alias, 5 warmups+30 measurements/scenario, API p95 <=100 ms, max 5, one query, response size and EXPLAIN evidence.                                           | T05 verified                         | Performance scripts and the two ADMIN-T05 JSON artifacts under `perf-results/`.                                          | Closed with final-branch direct and release-API reruns.                                                                                                       | Retain JSON, response-size, query-count, and direct EXPLAIN evidence.                                |
| D35 | Duplicate statement has transaction-local 1 s timeout; 57014 maps to 503 and does not leak or bypass rollback/unique.                                                      | Existing evidence                    | duplicate repository unit/integration timeout tests; create rollback timeout integration; route 503 mapping.             | None.                                                                                                                                                         | Record existing evidence and rerun PostgreSQL suite.                                                 |
| D36 | Auth -> ADMIN -> feature -> CSRF -> JSON -> byte/body validation -> DB, with no-store and no pre-rejection DB work.                                                        | Existing evidence                    | admin catalog guard and duplicate route matrix tests; body/CSRF tests.                                                   | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D37 | Exactly one redacted create/update audit event uses the response request ID, success/rejected/failed outcome, null unavailable IDs, and never changes transaction outcome. | T05 verified                         | Audit/guard implementation and focused tests in `lib/admin-song*` and `lib/admin-catalog/guard.test.ts`.                 | Closed: outcome/nullable fields/request-ID correlation match the contract; default console writers redact actor identifiers.                                  | Audit-shape/redaction tests only; sink failure remains non-blocking.                                 |
| D38 | Create is single-flight; ambiguous responses recheck the original snapshot without POST replay; none/possible/failure recovery preserves input.                            | T05 verified (tests only)            | Existing state machine plus two focused `AdminSongPage.test.tsx` recovery tests.                                         | Closed: none and failed recheck paths preserve the submitted snapshot, keep POST single-flight, and require explicit retry.                                   | Tests only; no Idempotency-Key/Redis/limiter introduced.                                             |
| D39 | Actual UTF-8 body limit is 524,288 bytes; final aggregate limits are 30 aliases/20 entries; failures rollback/redact; UI counters disable additions.                       | Existing evidence                    | streaming body-limit boundary/multibyte/chunk tests; POST/PATCH route tests; aggregate validation and UI counter tests.  | None.                                                                                                                                                         | Record existing evidence only.                                                                       |
| D40 | No app-specific limiter; one active fingerprint request; 429 is not auto-retried or treated as none; metrics are non-identifying.                                          | Existing evidence                    | duplicate hook 429/single-flight tests; metrics module/test; dependency/schema inspection.                               | None.                                                                                                                                                         | Record absence review and existing evidence only.                                                    |
| D41 | Only fail-closed `ADMIN_CATALOG_MODE` values `off` and `on`; common server guard; documented off-deploy/gate/approved-on rollout; no canary.                               | Existing evidence + T05 verification | Config/guard tests, `.env.example`, operations docs, E2E harness, and this safety boundary.                              | Closed for review: CI now exercises on plus a separate off run. Production activation remains intentionally unexecuted.                                       | Keep off by default; deploy/activate only under a separately approved release step.                  |
| D42 | Off hides navigation, direct pages return accessible 403, APIs return redacted no-store error before catalog work, and mid-edit off preserves input without retry.         | T05 verified                         | Existing unit/component evidence plus `e2e/admin-catalog-off.spec.ts` and `browser-e2e.yml`.                             | Closed: real Chromium verifies guest/user/admin-off ordering, hidden navigation, accessible page 403, and redacted/no-store API 403.                          | Off-mode E2E and CI invocation only.                                                                 |

## Cross-cutting regression evidence

The final gate must also run the existing suites that cover public search,
favorites, and Google OAuth (`lib/search/**`, `lib/favorites/**`,
`components/search/**`, `components/favorites/**`, and
`e2e/auth-security.spec.ts`). ADMIN-T05 does not change those product paths.

## ADMIN-T05-only changes

1. Added the missing integrated on-mode and dedicated feature-off Chromium
   scenarios.
2. Added concurrent-PATCH PostgreSQL coverage and ambiguous-create none/failed
   recovery tests.
3. Aligned only the D37 audit shape (`success`, explicit nullable identifiers),
   correlated the response/body/completion request ID, and redacted actor IDs
   from default console output.
4. Added a guarded disposable migration/preflight/backfill/contract/rollback
   verifier with exhaustive AliasType counts and raw Song preservation checks.
5. Added format/schema validation and the disposable administrator migration
   gate to CI.

No new catalog feature, Idempotency-Key store, Redis/process-local limiter,
canary mode, or broad refactor was introduced.

## Final local evidence

### Environment

- Base: `origin/develop` at `85a72af31973dba16e3f31bd7bc29e4b3e44b241`.
- Host: Darwin 24.5.0; Node 20.19.0; npm 10.8.2; Playwright 1.61.1;
  Chromium 149.0.7827.55.
- PostgreSQL: `postgres:16-alpine`, server 16.13, bound to loopback only and
  backed by a 2 GiB tmpfs. Three isolated databases were used for E2E,
  migration, and performance verification.
- The container and all synthetic rows are disposable. No production,
  staging, shared database, or external authentication provider was contacted.

### Required commands and test counts

| Gate                              | Result                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run format`                  | Pass; all files match Prettier.                                                                                                                                          |
| `npm run lint`                    | Pass.                                                                                                                                                                    |
| `npm run typecheck`               | Pass.                                                                                                                                                                    |
| `npm test`                        | Pass: 104 files passed, 6 integration files skipped by the unit command; 748 tests passed, 31 skipped.                                                                   |
| `npm run build`                   | Pass: optimized Next.js 16.2.9 production build.                                                                                                                         |
| `npm run db:validate`             | Pass: Prisma schema valid.                                                                                                                                               |
| `npm run seed:validate`           | Pass: 0 warnings.                                                                                                                                                        |
| Disposable PostgreSQL integration | Pass: 3 files, 13 tests, including same-row PATCH, different-row converging PATCH, POST/PATCH race, 1 s timeout/57014 mapping, rollback, and pooled-setting non-leakage. |
| Migration verifier                | Pass: expand preflight, dry-run/apply/idempotent backfill, contract, duplicate insert/update, NOT NULL, rollback, and raw-row preservation.                              |
| Chromium on mode                  | Pass: 21 tests; the single off-only spec was expectedly skipped.                                                                                                         |
| Chromium off mode                 | Pass: 1 dedicated test.                                                                                                                                                  |
| `git diff --check`                | Pass.                                                                                                                                                                    |

The final Chromium suite covers the integrated administrator list search ->
detail -> edit/add alias/add provider entry -> public-search reflection flow,
exact/possible creation branches, stale edit recovery, guest/user/admin access,
public search, favorites, personalization races, and mock Google OAuth. The
off-only run covers hidden navigation, accessible direct-page denial, API
denial ordering, no-store responses, request-ID correlation, and redacted
feature-denied logs.

### Migration and AliasType evidence

- Disposable seed preflight: 14 Songs; empty identity 0; drift 0; exact
  duplicate groups 0; system-alias violations 0.
- Backfill: dry-run 0 updates; first apply 0; second apply 0; idempotent.
- AliasType counts: canonical title 14, display title 14, artist 44,
  romanized title 8, English title 9, translated title 0, content 15,
  abbreviation 0, common name 0, alternate spelling 2; unmapped types 0.
- Contract: both normalized columns NOT NULL; named composite unique constraint;
  duplicate insert/update and null insert blocked.
- Rollback: normalized columns and constraint removed; all 14 pre-existing raw
  Song rows byte-for-byte JSON-equivalent after rollback.

### 10K Song / 100K Alias performance evidence

The deterministic local dataset contained 10,000 Songs, 100,000 aliases,
22,520 entries, and 12 providers. Each of eight scenarios used 5 warmups and
30 measured samples.

| Harness           | Worst p95 | Scenario               |         Max candidates | Candidate queries | Max response |
| ----------------- | --------: | ---------------------- | ---------------------: | ----------------: | -----------: |
| Direct repository | 56.498 ms | high-candidate partial |                      5 |                 1 |  4,457 bytes |
| Release-build API | 94.355 ms | display-title match    | 5 across all scenarios |                 1 |  4,457 bytes |

Both harnesses passed the 100 ms p95 and five-candidate gates. The direct JSON
retains the worst-partial `EXPLAIN (ANALYZE, BUFFERS)` plan:

- `perf-results/admin-song-duplicate-local-synthetic-10k-songs-100k-aliases-20260802T162514Z.json`
- `perf-results/admin-song-duplicate-release-api-local-synthetic-10k-songs-100k-aliases-20260802T162632Z.json`

### Remaining release risks and separate tickets

- The worst release-API p95 has 5.645 ms of headroom. It passes the gate but
  should be watched on later environment-specific runs; no query rewrite is
  justified by this ticket.
- The guarded Prisma 100K importer failed before commit with a call-stack error.
  The existing local-only PostgreSQL COPY fallback was used and database counts
  were revalidated exactly. Importer scalability belongs in a separate tooling
  ticket.
- Production data preflight, production migration, deployment, and
  `ADMIN_CATALOG_MODE=on` were deliberately not executed. Any non-zero duplicate
  report in an approved environment must block release and create a separate
  non-identifying cleanup ticket; no automatic merge or canonical Song choice
  is permitted.

## Publication evidence

The commit, draft PR, and final GitHub Actions links are added after the branch
is published. ADMIN-T05 may move only to a reviewable state; it must not be set
to Final without user approval.
