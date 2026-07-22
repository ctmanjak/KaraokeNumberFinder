import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { optionalM3TestDatabaseUrl } from "../scripts/m3/test-db-url";

const PRISMA_DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_NAME = "20260718121000_add_auth_user_data_schema";
const schema = readFileSync(path.join(PRISMA_DIR, "schema.prisma"), "utf8");
const migration = readFileSync(
  path.join(PRISMA_DIR, "migrations", MIGRATION_NAME, "migration.sql"),
  "utf8"
);

describe("M3 auth and user data schema", () => {
  it("keeps the migration additive and limited to the seven M3 tables", () => {
    const executableSql = migration.replace(/^--.*$/gm, "");
    const createdTables = Array.from(
      migration.matchAll(/CREATE TABLE "([^"]+)"/g),
      (match) => match[1]
    );

    expect(createdTables).toEqual([
      "users",
      "accounts",
      "sessions",
      "verifications",
      "user_preferences",
      "favorites",
      "search_histories"
    ]);
    expect(executableSql).not.toMatch(
      /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b|ALTER\s+TABLE\s+"(?:songs|song_aliases|karaoke_providers|karaoke_entries)"/i
    );
  });

  it("maps every M3 model to the migration table naming convention", () => {
    const modelMappings = [
      ["User", "users"],
      ["Account", "accounts"],
      ["Session", "sessions"],
      ["Verification", "verifications"],
      ["UserPreference", "user_preferences"],
      ["Favorite", "favorites"],
      ["SearchHistory", "search_histories"]
    ] as const;

    for (const [model, table] of modelMappings) {
      expect(schema).toMatch(
        new RegExp(`model ${model} \\{[\\s\\S]*?@@map\\("${table}"\\)`, "m")
      );
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it("contains the required unique, ordering, cleanup, and relation indexes", () => {
    for (const indexName of [
      "accounts_provider_id_account_id_key",
      "sessions_token_key",
      "sessions_user_id_expires_at_idx",
      "sessions_expires_at_idx",
      "verifications_identifier_idx",
      "verifications_expires_at_idx",
      "user_preferences_default_provider_id_idx",
      "favorites_user_id_song_id_key",
      "favorites_user_id_created_at_id_idx",
      "favorites_song_id_idx",
      "search_histories_user_id_normalized_query_key",
      "search_histories_user_id_searched_at_id_idx"
    ]) {
      expect(migration).toContain(`"${indexName}"`);
    }

    expect(migration).toContain(
      '"favorites_user_id_created_at_id_idx" ON "favorites"("user_id", "created_at" DESC, "id" DESC)'
    );
    expect(migration).toContain(
      '"search_histories_user_id_searched_at_id_idx" ON "search_histories"("user_id", "searched_at" DESC, "id" DESC)'
    );
  });

  it("uses the required cascade and provider SetNull policies", () => {
    for (const constraint of [
      "accounts_user_id_fkey",
      "sessions_user_id_fkey",
      "user_preferences_user_id_fkey",
      "favorites_user_id_fkey",
      "favorites_song_id_fkey",
      "search_histories_user_id_fkey"
    ]) {
      expect(migration).toMatch(
        new RegExp(`${constraint}[\\s\\S]*?ON DELETE CASCADE ON UPDATE CASCADE`)
      );
    }

    expect(migration).toMatch(
      /user_preferences_default_provider_id_fkey[\s\S]*?ON DELETE SET NULL ON UPDATE CASCADE/
    );
  });
});

const testDatabaseUrl = optionalM3TestDatabaseUrl(
  process.env.M3_TEST_DATABASE_URL
);
const describeDatabase =
  testDatabaseUrl === undefined ? describe.skip : describe;

describeDatabase("M3 migration constraints on PostgreSQL", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: testDatabaseUrl, max: 2 });
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE TABLE
        accounts,
        sessions,
        verifications,
        user_preferences,
        favorites,
        search_histories,
        users,
        songs,
        karaoke_providers
      CASCADE
    `);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("enforces ownership, uniqueness, and cascade policies", async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const accountId = randomUUID();
    const sessionId = randomUUID();
    const favoriteId = randomUUID();
    const searchHistoryId = randomUUID();
    const songId = "m3_test_song";
    const providerId = "m3_test_provider";
    const updatedProviderId = "m3_test_provider_updated";

    await insertProvider(pool, providerId);
    await insertSong(pool, songId);
    await insertUser(pool, userId, "m3-user@example.com");
    await insertUser(pool, otherUserId, "m3-other@example.com");

    await pool.query(
      `INSERT INTO accounts
        (id, user_id, provider_id, account_id, created_at, updated_at)
       VALUES ($1, $2, 'google', 'google-subject', NOW(), NOW())`,
      [accountId, userId]
    );
    await expect(
      pool.query(
        `INSERT INTO accounts
          (id, user_id, provider_id, account_id, created_at, updated_at)
         VALUES ($1, $2, 'google', 'google-subject', NOW(), NOW())`,
        [randomUUID(), otherUserId]
      )
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "accounts_provider_id_account_id_key"
    });

    await pool.query(
      `INSERT INTO sessions
        (id, token, user_id, expires_at, created_at, updated_at)
       VALUES ($1, 'unique-session-token', $2, NOW() + INTERVAL '1 day', NOW(), NOW())`,
      [sessionId, userId]
    );
    await expect(
      pool.query(
        `INSERT INTO sessions
          (id, token, user_id, expires_at, created_at, updated_at)
         VALUES ($1, 'unique-session-token', $2, NOW() + INTERVAL '1 day', NOW(), NOW())`,
        [randomUUID(), otherUserId]
      )
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "sessions_token_key"
    });

    await pool.query(
      `INSERT INTO user_preferences
        (user_id, default_provider_id, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())`,
      [userId, providerId]
    );
    await pool.query(`UPDATE karaoke_providers SET id = $1 WHERE id = $2`, [
      updatedProviderId,
      providerId
    ]);
    await expect(
      pool.query(
        `SELECT default_provider_id FROM user_preferences WHERE user_id = $1`,
        [userId]
      )
    ).resolves.toMatchObject({
      rows: [{ default_provider_id: updatedProviderId }]
    });
    await pool.query(`DELETE FROM karaoke_providers WHERE id = $1`, [
      updatedProviderId
    ]);
    await expect(
      pool.query(
        `SELECT default_provider_id FROM user_preferences WHERE user_id = $1`,
        [userId]
      )
    ).resolves.toMatchObject({ rows: [{ default_provider_id: null }] });

    await pool.query(
      `INSERT INTO favorites (id, user_id, song_id, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [favoriteId, userId, songId]
    );
    await expect(
      pool.query(
        `INSERT INTO favorites (id, user_id, song_id, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [randomUUID(), userId, songId]
      )
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "favorites_user_id_song_id_key"
    });

    await pool.query(
      `INSERT INTO search_histories
        (id, user_id, query, normalized_query, searched_at, created_at, updated_at)
       VALUES ($1, $2, 'Fixture Query', 'fixture query', NOW(), NOW(), NOW())`,
      [searchHistoryId, userId]
    );
    await expect(
      pool.query(
        `INSERT INTO search_histories
          (id, user_id, query, normalized_query, searched_at, created_at, updated_at)
         VALUES ($1, $2, 'fixture query', 'fixture query', NOW(), NOW(), NOW())`,
        [randomUUID(), userId]
      )
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "search_histories_user_id_normalized_query_key"
    });

    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);

    for (const table of [
      "accounts",
      "sessions",
      "user_preferences",
      "favorites",
      "search_histories"
    ]) {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS count FROM ${table}`
      );
      expect(result.rows[0]?.count).toBe(0);
    }

    await expect(
      pool.query(`SELECT COUNT(*)::int AS count FROM songs`)
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      pool.query(`SELECT COUNT(*)::int AS count FROM users`)
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it("creates the pagination and cleanup indexes with descending sort order", async () => {
    const expectedIndexes = [
      "sessions_user_id_expires_at_idx",
      "sessions_expires_at_idx",
      "verifications_identifier_idx",
      "verifications_expires_at_idx",
      "favorites_user_id_created_at_id_idx",
      "search_histories_user_id_searched_at_id_idx"
    ];
    const result = await pool.query<{ indexdef: string; indexname: string }>(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [expectedIndexes]
    );
    const indexes = new Map(
      result.rows.map(({ indexdef, indexname }) => [indexname, indexdef])
    );

    expect(Array.from(indexes.keys()).sort()).toEqual(expectedIndexes.sort());
    expect(indexes.get("favorites_user_id_created_at_id_idx")).toContain(
      "(user_id, created_at DESC, id DESC)"
    );
    expect(
      indexes.get("search_histories_user_id_searched_at_id_idx")
    ).toContain("(user_id, searched_at DESC, id DESC)");
  });
});

async function insertProvider(pool: Pool, id: string): Promise<void> {
  await pool.query(
    `INSERT INTO karaoke_providers
      (id, name, country, display_order, is_default, verified_by, created_at, updated_at)
     VALUES ($1, 'M3 Test Provider', 'KR', 1, true, 'm3_test', NOW(), NOW())`,
    [id]
  );
}

async function insertSong(pool: Pool, id: string): Promise<void> {
  await pool.query(
    `INSERT INTO songs
      (id, original_language, canonical_title, display_title, canonical_artist, verified_by, created_at, updated_at)
     VALUES ($1, 'ja', 'M3 Test Song', 'M3 Test Song', 'M3 Test Artist', 'm3_test', NOW(), NOW())`,
    [id]
  );
}

async function insertUser(
  pool: Pool,
  id: string,
  email: string
): Promise<void> {
  await pool.query(
    `INSERT INTO users
      (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'M3 Test User', $2, true, NOW(), NOW())`,
    [id, email]
  );
}
