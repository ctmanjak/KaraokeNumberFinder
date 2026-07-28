import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "../generated/prisma/client";
import {
  buildAliasSearchFields,
  normalizeSearchText
} from "../search/normalize";
import { normalizeSongIdentity } from "../song-identity/normalize";
import { isNormalizedIdentityUniqueViolation } from "../song-identity/prisma-error";
import { isAdminSongCursorTimestamp, type AdminSongCursorKey } from "./cursor";
import type { AdminSongListItem, AdminSongListQuery } from "./list-contract";
import type {
  AdminSongCreateResult,
  AdminSongInput,
  AdminSongOptions
} from "./types";

const ADMIN_SONG_SEARCH_BATCH_SIZE = 100;
export const MAX_ADMIN_SONG_SEARCH_SCAN_BATCHES = 5;

export type AdminSongRepositoryErrorCode =
  "FORBIDDEN" | "DUPLICATE_SONG" | "PROVIDER_NOT_FOUND" | "CONFLICT";

export class AdminSongRepositoryError extends Error {
  constructor(readonly code: AdminSongRepositoryErrorCode) {
    super(code);
    this.name = "AdminSongRepositoryError";
  }
}

export type AdminSongRepository = Readonly<{
  getOptions(userId: string): Promise<AdminSongOptions["providers"]>;
  list(
    userId: string,
    query: AdminSongListQuery
  ): Promise<AdminSongRepositoryListResult>;
  create(userId: string, input: AdminSongInput): Promise<AdminSongCreateResult>;
}>;

export type AdminSongRepositoryListResult = Readonly<{
  items: readonly AdminSongListItem[];
  nextCursorKey: AdminSongCursorKey | null;
}>;

export function createPrismaAdminSongRepository(
  db: PrismaClient,
  generateId: () => string = randomUUID
): AdminSongRepository {
  return {
    async getOptions(userId) {
      await requireAdmin(db, userId);
      return db.karaokeProvider.findMany({
        where: { isActive: true },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, country: true }
      });
    },

    async list(userId, query) {
      await requireAdmin(db, userId);

      const matches: AdminSongListRecord[] = [];
      let scanCursor = query.cursor;
      let scanComplete = false;
      let scannedBatches = 0;
      const batchSize =
        query.normalizedQuery === null
          ? query.limit + 1
          : ADMIN_SONG_SEARCH_BATCH_SIZE;
      const maxScanBatches =
        query.normalizedQuery === null ? 1 : MAX_ADMIN_SONG_SEARCH_SCAN_BATCHES;

      while (
        matches.length < query.limit + 1 &&
        scannedBatches < maxScanBatches
      ) {
        const songs = await readAdminSongBatch(db, scanCursor, batchSize);
        scannedBatches += 1;
        if (songs.length === 0) {
          scanComplete = true;
          break;
        }

        for (const song of songs) {
          if (matchesAdminSongQuery(song, query.normalizedQuery)) {
            matches.push(song);
            if (matches.length === query.limit + 1) {
              break;
            }
          }
        }

        const lastScanned = songs.at(-1);
        if (lastScanned === undefined) {
          scanComplete = true;
          break;
        }
        if (songs.length < batchSize) {
          scanComplete = true;
          break;
        }
        scanCursor = {
          updatedAt: lastScanned.updatedAt,
          id: lastScanned.id
        };
      }

      const hasMore = matches.length > query.limit;
      const pageSongs = matches.slice(0, query.limit);
      const pageSongIds = pageSongs.map((song) => song.id);
      const entries =
        pageSongIds.length === 0
          ? []
          : await db.karaokeEntry.findMany({
              where: { songId: { in: pageSongIds } },
              orderBy: [
                { providerId: "asc" },
                { versionInfo: "asc" },
                { karaokeNumber: "asc" },
                { id: "asc" }
              ],
              select: {
                songId: true,
                providerId: true,
                karaokeNumber: true,
                versionInfo: true,
                availabilityStatus: true,
                provider: { select: { name: true } }
              }
            });
      const entriesBySong = new Map<string, typeof entries>();
      for (const entry of entries) {
        const grouped = entriesBySong.get(entry.songId);
        if (grouped === undefined) {
          entriesBySong.set(entry.songId, [entry]);
        } else {
          grouped.push(entry);
        }
      }

      return {
        items: pageSongs.map((song) => ({
          id: song.id,
          original_language: song.originalLanguage,
          canonical_title: song.canonicalTitle,
          display_title: song.displayTitle,
          canonical_artist: song.canonicalArtist,
          provider_summary: (entriesBySong.get(song.id) ?? []).map((entry) => ({
            provider_id: entry.providerId,
            provider_name: entry.provider.name,
            karaoke_number: entry.karaokeNumber,
            version_info: entry.versionInfo,
            availability_status: entry.availabilityStatus
          })),
          updated_at: new Date(song.updatedAt).toISOString()
        })),
        nextCursorKey: hasMore
          ? toCursorKey(pageSongs[pageSongs.length - 1])
          : scanComplete
            ? null
            : scanCursor
      };
    },

    async create(userId, input) {
      const identity = normalizeSongIdentity(input);
      try {
        return await db.$transaction(
          async (transaction) => {
            await requireAdmin(transaction, userId);

            const duplicate = await transaction.song.findFirst({
              where: {
                normalizedCanonicalTitle: identity.normalizedCanonicalTitle,
                normalizedCanonicalArtist: identity.normalizedCanonicalArtist
              },
              select: { id: true }
            });
            if (duplicate !== null) {
              throw new AdminSongRepositoryError("DUPLICATE_SONG");
            }

            const providerIds = [
              ...new Set(
                input.karaoke_entries.map((entry) => entry.provider_id)
              )
            ];
            const providers = await transaction.karaokeProvider.findMany({
              where: { id: { in: providerIds }, isActive: true },
              select: { id: true }
            });
            if (providers.length !== providerIds.length) {
              throw new AdminSongRepositoryError("PROVIDER_NOT_FOUND");
            }

            const verifiedBy = `admin:${userId}`;
            const aliases = standardAliases(input).map((alias) => {
              const search = buildAliasSearchFields(alias.alias);
              return {
                id: `alias_${generateId()}`,
                alias: alias.alias,
                language: alias.language,
                aliasType: alias.alias_type,
                normalizedAlias: search.normalizedAlias,
                chosungAlias: search.chosungAlias || null,
                sourceUrl: input.source_url,
                sourceName: input.source_name,
                verifiedBy,
                verificationNote: input.verification_note
              };
            });
            const karaokeEntries = input.karaoke_entries.map((entry) => ({
              id: `entry_${generateId()}`,
              providerId: entry.provider_id,
              karaokeNumber: entry.karaoke_number,
              versionInfo: entry.version_info,
              availabilityStatus: entry.availability_status,
              lastVerifiedAt:
                entry.last_verified_at === null
                  ? null
                  : new Date(`${entry.last_verified_at}T00:00:00.000Z`),
              sourceUrl: input.source_url,
              sourceName: input.source_name,
              verifiedBy,
              verificationNote: input.verification_note
            }));

            const song = await transaction.song.create({
              data: {
                id: `song_${generateId()}`,
                originalLanguage: input.original_language,
                canonicalTitle: input.canonical_title,
                displayTitle: input.display_title,
                canonicalArtist: input.canonical_artist,
                normalizedCanonicalTitle: identity.normalizedCanonicalTitle,
                normalizedCanonicalArtist: identity.normalizedCanonicalArtist,
                releaseYear: input.release_year,
                tieIn: input.tie_in,
                sourceUrl: input.source_url,
                sourceName: input.source_name,
                verifiedBy,
                verificationNote: input.verification_note,
                aliases: { create: aliases },
                karaokeEntries: { create: karaokeEntries }
              },
              select: {
                id: true,
                displayTitle: true,
                canonicalArtist: true
              }
            });

            return {
              song: {
                id: song.id,
                display_title: song.displayTitle,
                canonical_artist: song.canonicalArtist
              },
              alias_count: aliases.length,
              karaoke_entry_count: karaokeEntries.length
            };
          },
          { isolationLevel: "Serializable" }
        );
      } catch (error) {
        if (error instanceof AdminSongRepositoryError) {
          throw error;
        }
        if (isNormalizedIdentityUniqueViolation(error)) {
          throw new AdminSongRepositoryError("DUPLICATE_SONG");
        }
        if (hasPrismaConflictCode(error)) {
          throw new AdminSongRepositoryError("CONFLICT");
        }
        throw error;
      }
    }
  };
}

type AdminSongListRecord = Readonly<{
  id: string;
  originalLanguage: string;
  canonicalTitle: string;
  displayTitle: string;
  canonicalArtist: string;
  updatedAt: string;
  aliases: ReadonlyArray<{ normalizedAlias: string }>;
}>;

type AdminSongListRawRow = Readonly<{
  id: string;
  originalLanguage: string;
  canonicalTitle: string;
  displayTitle: string;
  canonicalArtist: string;
  updatedAt: string;
  normalizedAliases: readonly string[];
}>;

async function readAdminSongBatch(
  db: PrismaClient,
  cursor: AdminSongCursorKey | null,
  limit: number
): Promise<AdminSongListRecord[]> {
  const cursorUpdatedAt = cursor?.updatedAt ?? null;
  const cursorId = cursor?.id ?? null;
  const rows = await db.$queryRaw<AdminSongListRawRow[]>(Prisma.sql`
    SELECT
      s.id,
      s.original_language AS "originalLanguage",
      s.canonical_title AS "canonicalTitle",
      s.display_title AS "displayTitle",
      s.canonical_artist AS "canonicalArtist",
      to_char(
        s.updated_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) AS "updatedAt",
      ARRAY(
        SELECT sa.normalized_alias
        FROM song_aliases AS sa
        WHERE sa.song_id = s.id
        ORDER BY sa.id ASC
      ) AS "normalizedAliases"
    FROM songs AS s
    WHERE
      ${cursorUpdatedAt}::text IS NULL
      OR s.updated_at < ${cursorUpdatedAt}::timestamptz
      OR (
        s.updated_at = ${cursorUpdatedAt}::timestamptz
        AND s.id > ${cursorId}
      )
    ORDER BY s.updated_at DESC, s.id ASC
    LIMIT ${limit}
  `);

  return rows.map(parseAdminSongListRawRow);
}

function parseAdminSongListRawRow(
  row: AdminSongListRawRow
): AdminSongListRecord {
  if (
    typeof row.id !== "string" ||
    typeof row.originalLanguage !== "string" ||
    typeof row.canonicalTitle !== "string" ||
    typeof row.displayTitle !== "string" ||
    typeof row.canonicalArtist !== "string" ||
    !isAdminSongCursorTimestamp(row.updatedAt) ||
    !Array.isArray(row.normalizedAliases) ||
    row.normalizedAliases.some((alias) => typeof alias !== "string")
  ) {
    throw new TypeError("Invalid administrator song list row.");
  }

  return {
    id: row.id,
    originalLanguage: row.originalLanguage,
    canonicalTitle: row.canonicalTitle,
    displayTitle: row.displayTitle,
    canonicalArtist: row.canonicalArtist,
    updatedAt: row.updatedAt,
    aliases: row.normalizedAliases.map((normalizedAlias) => ({
      normalizedAlias
    }))
  };
}

function matchesAdminSongQuery(
  song: AdminSongListRecord,
  normalizedQuery: string | null
): boolean {
  if (normalizedQuery === null) {
    return true;
  }
  return (
    normalizeSearchText(song.canonicalTitle).includes(normalizedQuery) ||
    normalizeSearchText(song.displayTitle).includes(normalizedQuery) ||
    normalizeSearchText(song.canonicalArtist).includes(normalizedQuery) ||
    song.aliases.some((alias) =>
      alias.normalizedAlias.includes(normalizedQuery)
    )
  );
}

function toCursorKey(
  song: Pick<AdminSongListRecord, "updatedAt" | "id"> | undefined
): AdminSongCursorKey | null {
  return song === undefined ? null : { updatedAt: song.updatedAt, id: song.id };
}

type AdminLookupDb = Pick<PrismaClient, "user">;

async function requireAdmin(db: AdminLookupDb, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true }
  });
  if (user?.role !== "admin") {
    throw new AdminSongRepositoryError("FORBIDDEN");
  }
}

function standardAliases(input: AdminSongInput) {
  return [
    {
      alias: input.canonical_title,
      language: input.original_language,
      alias_type: "canonical_title" as const
    },
    {
      alias: input.display_title,
      language: input.original_language,
      alias_type: "display_title" as const
    },
    {
      alias: input.canonical_artist,
      language: input.original_language,
      alias_type: "artist" as const
    },
    ...input.aliases
  ];
}

function hasPrismaConflictCode(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "P2002" || error.code === "P2034")
  );
}
