# ADMIN-T03 administrator song editing

ADMIN-T03 adds the administrator detail/edit surface, aggregate `PATCH`, and the
duplicate-candidate contract that ADMIN-T04 can reuse.

## Identity rollout

The normalized song identity rollout is intentionally split:

1. Apply
   `prisma/migrations/20260727090000_expand_song_normalized_identity/migration.sql`.
   It adds nullable `normalized_canonical_title` and
   `normalized_canonical_artist` columns only.
2. Release the dual-write application. `POST`, `PATCH`, and seed import all call
   `normalizeSongIdentity`, which delegates to the public-search
   `normalizeSearchText` implementation.
3. On a positively identified disposable local/test database, run:

   ```sh
   ADMIN_SONG_DISPOSABLE_DB_CONFIRMED=1 \
   DATABASE_URL='postgresql://.../database_name_containing_test_or_e2e' \
   npm run db:admin-song-preflight

   ADMIN_SONG_DISPOSABLE_DB_CONFIRMED=1 \
   DATABASE_URL='postgresql://.../database_name_containing_test_or_e2e' \
   npm run db:admin-song-backfill -- --dry-run

   ADMIN_SONG_DISPOSABLE_DB_CONFIRMED=1 \
   DATABASE_URL='postgresql://.../database_name_containing_test_or_e2e' \
   npm run db:admin-song-backfill
   ```

4. Re-run preflight. Contract is allowed only when empty identities, stored/raw
   drift, exact duplicate groups, and missing/duplicate corresponding system
   aliases are all zero.
5. Execute
   `prisma/contract-migrations/20260727091000_contract_song_normalized_identity/create-index-concurrently.sql`
   as its own database command. After it succeeds, apply
   `prisma/contract-migrations/20260727091000_contract_song_normalized_identity/migration.sql`
   as the short contract transaction. Promote both steps into a new, later
   contract release only after the data gates pass. They add `NOT NULL` and the
   fixed `songs_normalized_canonical_title_artist_key` composite unique
   constraint without building the index inside the constraint transaction.

Do not run all rollout phases as one unattended existing-database deployment.
The expand application release, preflight/backfill, and contract step are
separate operational gates. The contract SQL is intentionally kept outside
`prisma/migrations` in the expand release so `prisma migrate deploy` cannot
apply it before the data gates. Do not mark or copy it into migration history
until those gates pass. The maintenance scripts reject non-local hosts,
database names without a test/e2e/local/disposable marker, names containing
prod/staging/shared, and calls without the explicit disposable confirmation.

Preflight never merges, deletes, or repairs violations. Its duplicate report is
limited to the normalized key, song ID and display summary, timestamps, alias
and entry IDs, and favorite counts; it contains no user IDs. A non-empty exact
duplicate report requires a separate data-cleanup ticket.

### Guarded system alias repair

Missing corresponding `canonical_title`, `display_title`, or `artist` system
aliases require a separate repair before identity backfill can proceed. The
repair command defaults to a read-only transaction and prints a credential-free
target fingerprint plus the exact deterministic aliases it would create:

```sh
DATABASE_URL='postgresql://...' \
npm run db:admin-song-repair-system-aliases
```

Apply only after the dry-run target and create count have been independently
verified. The apply path requires the exact fingerprint, an expected create
count, and an explicit confirmation; it locks `songs` and `song_aliases`, rolls
back on any plan drift or invariant blocker, and verifies that no repair remains
before committing:

```sh
ADMIN_SONG_SYSTEM_ALIAS_REPAIR_CONFIRMED=1 \
ADMIN_SONG_SYSTEM_ALIAS_REPAIR_TARGET_SHA256='<dry-run fingerprint>' \
DATABASE_URL='postgresql://...' \
npm run db:admin-song-repair-system-aliases -- \
  --apply --expected-create-count='<verified count>'
```

This command never changes Song, KaraokeEntry, Favorite, User, or existing alias
rows. It does not replace migration deployment, normalized identity backfill,
or the later contract gate. For a shared, staging, or production database,
record the target identity, backup/rollback readiness, dry-run output, explicit
approval, and postflight result in the owning ticket before applying.

The contract migration's `rollback.sql` drops only the new composite unique
constraint. It preserves the two normalized columns owned by the earlier
expand migration and does not alter or delete existing Song rows. Roll back the
contract/application before using that SQL; rolling back the expand shape while
dual-write code is active is unsupported.

## Runtime contracts

- `GET /api/admin/songs/[songId]` returns an explicit editing DTO with system
  aliases separated from administrator aliases.
- `PATCH /api/admin/songs/[songId]` applies the Song, editable aliases, and
  karaoke entries in one serializable transaction using
  `expected_updated_at`.
- `POST /api/admin/songs/duplicate-check` uses the same candidate engine as the
  transaction-final PATCH check. It has a transaction-local 1 second statement
  timeout, a five-candidate limit, and no write audit event.
- System aliases are the one source-matching `canonical_title`,
  `display_title`, and `artist` alias for each Song. Their IDs are preserved
  during synchronization and they cannot be supplied through the editable
  alias DTO.
- Existing KaraokeEntry rows must all remain in the aggregate payload. They can
  be updated, and new rows can be added, but they cannot be deleted.
- Every PATCH attempt produces one redacted `admin_song.update` completion
  event. Duplicate-check metrics contain only fixed route, status, latency,
  timeout, and in-flight counts.

## ADMIN-T04 reuse

The reusable pieces are:

- `lib/song-identity/normalize.ts`
- `lib/admin-song-duplicate/types.ts`, including the exhaustive alias-role map
  and `CandidateSummary`
- `lib/admin-song-duplicate/repository.ts` and `service.ts`
- `POST /api/admin/songs/duplicate-check` and its client
- exact-set acknowledged candidate IDs, capped at five
- streaming UTF-8 byte limiting in `lib/personalization/body.ts`
- transaction-local duplicate statement timeout
- normalized identity POST/seed/import dual-write and unique-conflict mapping

ADMIN-T03 does not add the ADMIN-T04 new-song duplicate UI or creation branch.

## Performance evidence

Prepare and measure only a disposable 10K Song/100K Alias PostgreSQL database:

```sh
ADMIN_SONG_DISPOSABLE_DB_CONFIRMED=1 DATABASE_URL='postgresql://.../local_test' \
npm run perf:admin-song-prepare

ADMIN_SONG_DISPOSABLE_DB_CONFIRMED=1 DATABASE_URL='postgresql://.../local_test' \
npm run perf:admin-song-duplicate
```

The measurement performs five warmups and thirty samples for all eight required
scenarios, verifies at most five candidates and one candidate statement, and
writes latency, response size, and partial-match `EXPLAIN (ANALYZE, BUFFERS)`
evidence under `perf-results/`.

After building and starting the application with the same disposable dataset
and guarded E2E authentication enabled, measure the actual local release API:

```sh
ADMIN_SONG_DISPOSABLE_DB_CONFIRMED=1 \
DATABASE_URL='postgresql://.../local_test' \
ADMIN_T03_PERF_BASE_URL='http://127.0.0.1:3555' \
ADMIN_T03_PERF_PUBLIC_ORIGIN='https://127.0.0.1:3555' \
npm run perf:admin-song-duplicate-api
```
