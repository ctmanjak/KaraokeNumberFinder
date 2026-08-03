import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { Client } from "pg";

import { ALIAS_CANDIDATE_ROLE } from "../../lib/admin-song-duplicate/types";
import {
  backfillSongIdentity,
  preflightSongIdentity,
  requireDisposableAdminSongDatabaseUrl
} from "../../lib/song-identity/maintenance";

const databaseUrl = requireDisposableAdminSongDatabaseUrl(
  process.env.DATABASE_URL,
  process.env.ADMIN_SONG_DISPOSABLE_DB_CONFIRMED
);
const migrationRoot = path.join(
  process.cwd(),
  "prisma/contract-migrations/20260727091000_contract_song_normalized_identity"
);
const createIndexSql = readFileSync(
  path.join(migrationRoot, "create-index-concurrently.sql"),
  "utf8"
);
const contractSql = readFileSync(
  path.join(migrationRoot, "migration.sql"),
  "utf8"
);
const rollbackSql = readFileSync(
  path.join(migrationRoot, "rollback.sql"),
  "utf8"
);
const client = new Client({ connectionString: databaseUrl });
let contractStarted = false;
let rollbackCompleted = false;

await client.connect();
try {
  const rawSongsBefore = await readRawSongs(client);
  const before = await preflightSongIdentity(client);
  if (before.release_blocked) {
    throw new Error(
      "Song identity preflight blocked the disposable migration verification."
    );
  }

  const dryRun = await backfillSongIdentity(client, { dryRun: true });
  const firstApply = await backfillSongIdentity(client);
  const secondApply = await backfillSongIdentity(client);
  if (
    dryRun.before.release_blocked ||
    firstApply.after.release_blocked ||
    secondApply.after.release_blocked ||
    secondApply.updated_song_count !== 0
  ) {
    throw new Error("Song identity backfill/drift verification did not pass.");
  }

  const aliasTypeCounts = await readAliasTypeCounts(client);
  const unmappedAliasTypes = aliasTypeCounts
    .map(({ alias_type }) => alias_type)
    .filter(
      (aliasType) =>
        !Object.hasOwn(ALIAS_CANDIDATE_ROLE, aliasType) ||
        !["title", "artist", "excluded"].includes(
          (ALIAS_CANDIDATE_ROLE as Record<string, string>)[aliasType] ?? ""
        )
    );
  if (unmappedAliasTypes.length > 0) {
    throw new Error("Unmapped AliasType values block the contract migration.");
  }

  contractStarted = true;
  await client.query(createIndexSql);
  await client.query(contractSql);
  await verifyContractShape(client);
  await verifyNotNullAndUniqueConstraints(client);

  await client.query(rollbackSql);
  rollbackCompleted = true;
  await verifyRollbackShape(client);
  const rawSongsAfter = await readRawSongs(client);
  if (JSON.stringify(rawSongsAfter) !== JSON.stringify(rawSongsBefore)) {
    throw new Error("Contract rollback changed existing raw Song data.");
  }

  console.log(
    JSON.stringify(
      {
        schema_version: 1,
        environment: "local-disposable",
        preflight: {
          song_count: before.song_count,
          empty_identity_count: before.empty_identity_song_ids.length,
          drift_count: before.drift_song_ids.length,
          exact_duplicate_group_count: before.exact_duplicate_groups.length,
          system_alias_violation_count: before.system_alias_violations.length
        },
        backfill: {
          dry_run_update_count: dryRun.updated_song_count,
          first_apply_update_count: firstApply.updated_song_count,
          second_apply_update_count: secondApply.updated_song_count,
          idempotent: secondApply.updated_song_count === 0
        },
        alias_type_counts: aliasTypeCounts,
        unmapped_alias_type_count: unmappedAliasTypes.length,
        contract: {
          normalized_columns_not_null: true,
          composite_unique_constraint:
            "songs_normalized_canonical_title_artist_key",
          duplicate_insert_blocked: true,
          duplicate_update_blocked: true,
          null_insert_blocked: true
        },
        rollback: {
          normalized_columns_preserved: true,
          constraint_removed: true,
          existing_song_count: rawSongsAfter.length,
          raw_song_data_preserved: true
        }
      },
      null,
      2
    )
  );
} catch (error) {
  if (contractStarted && !rollbackCompleted) {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query(rollbackSql).catch(() => undefined);
  }
  throw error;
} finally {
  await client.end();
}

async function readAliasTypeCounts(client: Client) {
  const result = await client.query<{
    alias_type: string;
    alias_count: number;
  }>(`
    SELECT enum_value.alias_type, count(alias.id)::int AS alias_count
    FROM (
      SELECT enum.enumlabel AS alias_type, enum.enumsortorder
      FROM pg_enum enum
      JOIN pg_type type ON type.oid = enum.enumtypid
      WHERE type.typname = 'alias_type'
    ) AS enum_value
    LEFT JOIN song_aliases alias
      ON alias.alias_type::text = enum_value.alias_type
    GROUP BY enum_value.alias_type, enum_value.enumsortorder
    ORDER BY enum_value.enumsortorder ASC
  `);
  return result.rows;
}

async function readRawSongs(client: Client) {
  const result = await client.query<{ id: string; raw_song: unknown }>(`
    SELECT
      song.id,
      to_jsonb(song)
        - 'normalized_canonical_title'
        - 'normalized_canonical_artist' AS raw_song
    FROM songs song
    ORDER BY song.id ASC
  `);
  return result.rows;
}

async function verifyContractShape(client: Client): Promise<void> {
  const columns = await client.query<{
    column_name: string;
    is_nullable: "NO" | "YES";
  }>(`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'songs'
      AND column_name IN (
        'normalized_canonical_title',
        'normalized_canonical_artist'
      )
    ORDER BY column_name ASC
  `);
  const constraint = await client.query<{ name: string; kind: string }>(`
    SELECT constraint_record.conname AS name,
           constraint_record.contype::text AS kind
    FROM pg_constraint constraint_record
    JOIN pg_class table_record
      ON table_record.oid = constraint_record.conrelid
    WHERE table_record.relname = 'songs'
      AND constraint_record.conname =
        'songs_normalized_canonical_title_artist_key'
  `);
  if (
    columns.rows.length !== 2 ||
    columns.rows.some(({ is_nullable }) => is_nullable !== "NO") ||
    constraint.rows.length !== 1 ||
    constraint.rows[0].kind !== "u"
  ) {
    throw new Error("The normalized Song identity contract shape is invalid.");
  }
}

async function verifyNotNullAndUniqueConstraints(client: Client) {
  const songs = await client.query<{
    id: string;
    normalized_canonical_title: string;
    normalized_canonical_artist: string;
  }>(`
    SELECT id, normalized_canonical_title, normalized_canonical_artist
    FROM songs
    ORDER BY id ASC
    LIMIT 2
  `);
  const first = songs.rows[0];
  const second = songs.rows[1];
  if (first === undefined || second === undefined) {
    throw new Error("Migration verification requires at least two Song rows.");
  }

  const duplicateInsertId = `admin_t05_duplicate_${randomUUID()}`;
  const duplicateInsertError = await captureDatabaseError(
    client.query(
      `
        INSERT INTO songs (
          id, original_language, canonical_title, display_title,
          canonical_artist, normalized_canonical_title,
          normalized_canonical_artist, verified_by, created_at, updated_at
        ) VALUES (
          $1, 'en', 'Contract Duplicate', 'Contract Duplicate',
          'Contract Artist', $2, $3, 'admin-t05-migration', now(), now()
        )
      `,
      [
        duplicateInsertId,
        first.normalized_canonical_title,
        first.normalized_canonical_artist
      ]
    )
  );
  assertDatabaseError(
    duplicateInsertError,
    "23505",
    "songs_normalized_canonical_title_artist_key"
  );

  const duplicateUpdateError = await captureDatabaseError(
    client.query(
      `
        UPDATE songs
        SET normalized_canonical_title = $1,
            normalized_canonical_artist = $2
        WHERE id = $3
      `,
      [
        first.normalized_canonical_title,
        first.normalized_canonical_artist,
        second.id
      ]
    )
  );
  assertDatabaseError(
    duplicateUpdateError,
    "23505",
    "songs_normalized_canonical_title_artist_key"
  );

  const nullInsertError = await captureDatabaseError(
    client.query(
      `
        INSERT INTO songs (
          id, original_language, canonical_title, display_title,
          canonical_artist, verified_by, created_at, updated_at
        ) VALUES (
          $1, 'en', 'Contract Null', 'Contract Null',
          'Contract Artist', 'admin-t05-migration', now(), now()
        )
      `,
      [`admin_t05_null_${randomUUID()}`]
    )
  );
  assertDatabaseError(nullInsertError, "23502");

  const secondAfter = await client.query<{
    normalized_canonical_title: string;
    normalized_canonical_artist: string;
  }>(
    `
    SELECT normalized_canonical_title, normalized_canonical_artist
    FROM songs
    WHERE id = $1
  `,
    [second.id]
  );
  if (
    secondAfter.rows[0]?.normalized_canonical_title !==
      second.normalized_canonical_title ||
    secondAfter.rows[0]?.normalized_canonical_artist !==
      second.normalized_canonical_artist
  ) {
    throw new Error("Rejected duplicate update changed the target Song.");
  }
}

async function verifyRollbackShape(client: Client): Promise<void> {
  const columns = await client.query<{ count: number }>(`
    SELECT count(*)::int AS count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'songs'
      AND column_name IN (
        'normalized_canonical_title',
        'normalized_canonical_artist'
      )
  `);
  const constraint = await client.query<{ count: number }>(`
    SELECT count(*)::int AS count
    FROM pg_constraint
    WHERE conname = 'songs_normalized_canonical_title_artist_key'
  `);
  if (columns.rows[0]?.count !== 2 || constraint.rows[0]?.count !== 0) {
    throw new Error(
      "Contract rollback did not preserve the normalized columns or remove the unique constraint."
    );
  }
}

async function captureDatabaseError(
  operation: Promise<unknown>
): Promise<unknown> {
  try {
    await operation;
    return null;
  } catch (error) {
    return error;
  }
}

function assertDatabaseError(
  error: unknown,
  expectedCode: string,
  expectedConstraint?: string
): void {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== expectedCode ||
    (expectedConstraint !== undefined &&
      (!("constraint" in error) || error.constraint !== expectedConstraint))
  ) {
    throw new Error(`Expected PostgreSQL ${expectedCode} contract rejection.`);
  }
}
