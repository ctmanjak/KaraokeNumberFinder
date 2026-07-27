import type { PoolClient } from "pg";
import { normalizeSearchText } from "../search/normalize";
import { normalizeSongIdentity } from "./normalize";

type SongMaintenanceRow = Readonly<{
  id: string;
  canonical_title: string;
  display_title: string;
  canonical_artist: string;
  normalized_canonical_title: string | null;
  normalized_canonical_artist: string | null;
  created_at: string;
  updated_at: string;
  alias_ids: string[];
  entry_ids: string[];
  favorite_count: number | string;
  canonical_title_aliases: string[];
  display_title_aliases: string[];
  artist_aliases: string[];
}>;

export type SongIdentityDuplicateReport = Readonly<{
  normalized_key: {
    canonical_title: string;
    canonical_artist: string;
  };
  songs: ReadonlyArray<{
    id: string;
    display_title: string;
    canonical_artist: string;
    created_at: string;
    updated_at: string;
    alias_ids: readonly string[];
    entry_ids: readonly string[];
    favorite_count: number;
  }>;
}>;

export type SongIdentityPreflightReport = Readonly<{
  song_count: number;
  empty_identity_song_ids: readonly string[];
  drift_song_ids: readonly string[];
  exact_duplicate_groups: readonly SongIdentityDuplicateReport[];
  system_alias_violations: ReadonlyArray<{
    song_id: string;
    alias_type: "canonical_title" | "display_title" | "artist";
    count: number;
  }>;
  backfill_blocked: boolean;
  release_blocked: boolean;
}>;

type MaintenanceClient = Pick<PoolClient, "query">;

export async function preflightSongIdentity(
  client: MaintenanceClient
): Promise<SongIdentityPreflightReport> {
  const result = await client.query<SongMaintenanceRow>(`
    SELECT
      s.id,
      s.canonical_title,
      s.display_title,
      s.canonical_artist,
      s.normalized_canonical_title,
      s.normalized_canonical_artist,
      to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
      to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
      ARRAY(
        SELECT sa.id FROM song_aliases sa
        WHERE sa.song_id = s.id ORDER BY sa.id ASC
      ) AS alias_ids,
      ARRAY(
        SELECT ke.id FROM karaoke_entries ke
        WHERE ke.song_id = s.id ORDER BY ke.id ASC
      ) AS entry_ids,
      (SELECT count(*) FROM favorites f WHERE f.song_id = s.id) AS favorite_count,
      ARRAY(SELECT sa.normalized_alias FROM song_aliases sa WHERE sa.song_id = s.id AND sa.alias_type = 'canonical_title' ORDER BY sa.id ASC) AS canonical_title_aliases,
      ARRAY(SELECT sa.normalized_alias FROM song_aliases sa WHERE sa.song_id = s.id AND sa.alias_type = 'display_title' ORDER BY sa.id ASC) AS display_title_aliases,
      ARRAY(SELECT sa.normalized_alias FROM song_aliases sa WHERE sa.song_id = s.id AND sa.alias_type = 'artist' ORDER BY sa.id ASC) AS artist_aliases
    FROM songs s
    ORDER BY s.id ASC
  `);
  const emptyIdentitySongIds: string[] = [];
  const driftSongIds: string[] = [];
  const groups = new Map<
    string,
    Array<{
      row: SongMaintenanceRow;
      title: string;
      artist: string;
    }>
  >();
  const systemAliasViolations: SongIdentityPreflightReport["system_alias_violations"][number][] =
    [];

  for (const row of result.rows) {
    let identity;
    try {
      identity = normalizeSongIdentity({
        canonical_title: row.canonical_title,
        canonical_artist: row.canonical_artist
      });
    } catch {
      emptyIdentitySongIds.push(row.id);
      continue;
    }
    if (
      row.normalized_canonical_title !== identity.normalizedCanonicalTitle ||
      row.normalized_canonical_artist !== identity.normalizedCanonicalArtist
    ) {
      driftSongIds.push(row.id);
    }
    const key = `${identity.normalizedCanonicalTitle}\u0000${identity.normalizedCanonicalArtist}`;
    const group = groups.get(key) ?? [];
    group.push({
      row,
      title: identity.normalizedCanonicalTitle,
      artist: identity.normalizedCanonicalArtist
    });
    groups.set(key, group);
    for (const [aliasType, aliases, expected] of [
      [
        "canonical_title",
        row.canonical_title_aliases,
        identity.normalizedCanonicalTitle
      ],
      [
        "display_title",
        row.display_title_aliases,
        normalizeSearchText(row.display_title)
      ],
      ["artist", row.artist_aliases, identity.normalizedCanonicalArtist]
    ] as const) {
      const count = aliases.filter((alias) => alias === expected).length;
      if (count !== 1) {
        systemAliasViolations.push({
          song_id: row.id,
          alias_type: aliasType,
          count
        });
      }
    }
  }

  const exactDuplicateGroups = [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      normalized_key: {
        canonical_title: group[0].title,
        canonical_artist: group[0].artist
      },
      songs: group.map(({ row }) => ({
        id: row.id,
        display_title: row.display_title,
        canonical_artist: row.canonical_artist,
        created_at: row.created_at,
        updated_at: row.updated_at,
        alias_ids: row.alias_ids,
        entry_ids: row.entry_ids,
        favorite_count: Number(row.favorite_count)
      }))
    }));
  const backfillBlocked =
    emptyIdentitySongIds.length > 0 ||
    exactDuplicateGroups.length > 0 ||
    systemAliasViolations.length > 0;
  return {
    song_count: result.rows.length,
    empty_identity_song_ids: emptyIdentitySongIds,
    drift_song_ids: driftSongIds,
    exact_duplicate_groups: exactDuplicateGroups,
    system_alias_violations: systemAliasViolations,
    backfill_blocked: backfillBlocked,
    release_blocked: backfillBlocked || driftSongIds.length > 0
  };
}

export async function backfillSongIdentity(
  client: MaintenanceClient,
  options: Readonly<{ dryRun?: boolean }> = {}
): Promise<
  Readonly<{
    applied: boolean;
    updated_song_count: number;
    before: SongIdentityPreflightReport;
    after: SongIdentityPreflightReport;
  }>
> {
  const before = await preflightSongIdentity(client);
  if (before.backfill_blocked) {
    return {
      applied: false,
      updated_song_count: 0,
      before,
      after: before
    };
  }
  if (options.dryRun === true) {
    return {
      applied: false,
      updated_song_count: before.drift_song_ids.length,
      before,
      after: before
    };
  }
  await client.query("BEGIN");
  let transactionOpen = true;
  let updatedSongCount = 0;
  try {
    await client.query(
      "LOCK TABLE songs, song_aliases IN SHARE ROW EXCLUSIVE MODE"
    );
    const lockedBefore = await preflightSongIdentity(client);
    if (lockedBefore.backfill_blocked) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return {
        applied: false,
        updated_song_count: 0,
        before: lockedBefore,
        after: lockedBefore
      };
    }
    const rows = await client.query<{
      id: string;
      canonical_title: string;
      canonical_artist: string;
    }>(`
      SELECT id, canonical_title, canonical_artist
      FROM songs
      ORDER BY id ASC
      FOR UPDATE
    `);
    for (const row of rows.rows) {
      const identity = normalizeSongIdentity({
        canonical_title: row.canonical_title,
        canonical_artist: row.canonical_artist
      });
      const update = await client.query(
        `
          UPDATE songs
          SET normalized_canonical_title = $2,
              normalized_canonical_artist = $3
          WHERE id = $1
            AND (
              normalized_canonical_title IS DISTINCT FROM $2
              OR normalized_canonical_artist IS DISTINCT FROM $3
            )
        `,
        [
          row.id,
          identity.normalizedCanonicalTitle,
          identity.normalizedCanonicalArtist
        ]
      );
      updatedSongCount += update.rowCount ?? 0;
    }
    const after = await preflightSongIdentity(client);
    if (after.release_blocked) {
      throw new Error("Song identity verification failed after backfill.");
    }
    await client.query("COMMIT");
    transactionOpen = false;
    return {
      applied: true,
      updated_song_count: updatedSongCount,
      before: lockedBefore,
      after
    };
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
    throw error;
  }
}

export function requireDisposableAdminSongDatabaseUrl(
  value: string | undefined,
  confirmation: string | undefined
): string {
  if (value === undefined || confirmation !== "1") {
    throw new Error(
      "Set ADMIN_SONG_DISPOSABLE_DB_CONFIRMED=1 and DATABASE_URL for a disposable local/test PostgreSQL database."
    );
  }
  const parsed = new URL(value);
  const localHost =
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" ||
    parsed.hostname === "::1";
  const databaseName = parsed.pathname.slice(1).toLowerCase();
  if (
    !localHost ||
    !/(?:test|e2e|local|disposable)/u.test(databaseName) ||
    /(?:prod|production|staging|shared)/u.test(databaseName)
  ) {
    throw new Error(
      "ADMIN-T03 database maintenance is restricted to confirmed disposable local/test databases."
    );
  }
  return value;
}
