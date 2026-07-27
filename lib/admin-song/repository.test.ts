import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../generated/prisma/client";
import {
  AdminSongRepositoryError,
  createPrismaAdminSongRepository,
  MAX_ADMIN_SONG_SEARCH_SCAN_BATCHES
} from "./repository";
import type { AdminSongInput } from "./types";

describe("admin song repository", () => {
  it("searches every normalized field and alias without returning sensitive projection fields", async () => {
    const songs = [
      listSong("canonical", "Ａ Original", "표시", "가수", []),
      listSong("display", "원제", "Display Title", "가수", []),
      listSong("artist", "원제", "표시", "Mixed CASE Artist", []),
      listSong("alias", "원제", "표시", "가수", ["savedalias"])
    ];
    const repository = createPrismaAdminSongRepository(listDb(songs));

    for (const [query, expectedId] of [
      ["a-original", "canonical"],
      ["display title", "display"],
      ["mixed case", "artist"],
      ["ＳＡＶＥＤ alias", "alias"]
    ]) {
      const result = await repository.list("admin-user", {
        query,
        normalizedQuery: normalizeForTest(query),
        cursor: null,
        limit: 20
      });
      expect(result.items.map((item) => item.id)).toEqual([expectedId]);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(
        /source_name|source_url|verification_note|verified_by|email/iu
      );
    }
  });

  it("orders by updated_at DESC, id ASC and paginates timestamp ties without gaps or duplicates", async () => {
    const songs = [
      listSong("song-a", "A", "A", "Artist", [], "2026-07-26T03:00:00.000Z"),
      listSong("song-b", "B", "B", "Artist", [], "2026-07-26T02:00:00.000Z"),
      listSong("song-c", "C", "C", "Artist", [], "2026-07-26T02:00:00.000Z"),
      listSong("song-d", "D", "D", "Artist", [], "2026-07-26T01:00:00.000Z")
    ];
    const repository = createPrismaAdminSongRepository(listDb(songs));
    const first = await repository.list("admin-user", {
      query: null,
      normalizedQuery: null,
      cursor: null,
      limit: 2
    });
    const second = await repository.list("admin-user", {
      query: null,
      normalizedQuery: null,
      cursor: first.nextCursorKey,
      limit: 2
    });

    expect(first.items.map((item) => item.id)).toEqual(["song-a", "song-b"]);
    expect(second.items.map((item) => item.id)).toEqual(["song-c", "song-d"]);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size
    ).toBe(4);
    expect(second.nextCursorKey).toBeNull();
  });

  it("preserves PostgreSQL microseconds across cursor pages", async () => {
    const songs = [
      listSong("song-a", "A", "A", "Artist", [], "2026-07-26T03:00:00.123456Z"),
      listSong("song-b", "B", "B", "Artist", [], "2026-07-26T03:00:00.123455Z"),
      listSong("song-c", "C", "C", "Artist", [], "2026-07-26T03:00:00.123454Z")
    ];
    const repository = createPrismaAdminSongRepository(listDb(songs));

    const first = await repository.list("admin-user", {
      query: null,
      normalizedQuery: null,
      cursor: null,
      limit: 2
    });
    const second = await repository.list("admin-user", {
      query: null,
      normalizedQuery: null,
      cursor: first.nextCursorKey,
      limit: 2
    });

    expect(first.items.map((item) => item.id)).toEqual(["song-a", "song-b"]);
    expect(first.nextCursorKey).toEqual({
      updatedAt: "2026-07-26T03:00:00.123455Z",
      id: "song-b"
    });
    expect(second.items.map((item) => item.id)).toEqual(["song-c"]);
    expect(second.nextCursorKey).toBeNull();
  });

  it("paginates matching songs across multiple 100-row scan batches without gaps or duplicates", async () => {
    const matchingIndexes = new Set([99, 199, 204]);
    const songs = Array.from({ length: 205 }, (_, index) =>
      listSong(
        `song-${String(index).padStart(3, "0")}`,
        matchingIndexes.has(index) ? `Needle ${index}` : `Other ${index}`,
        `Display ${index}`,
        "Artist",
        []
      )
    );
    const repository = createPrismaAdminSongRepository(listDb(songs));
    const collected: string[] = [];
    let cursor = null;

    do {
      const page = await repository.list("admin-user", {
        query: "needle",
        normalizedQuery: "needle",
        cursor,
        limit: 2
      });
      collected.push(...page.items.map((item) => item.id));
      cursor = page.nextCursorKey;
    } while (cursor !== null);

    expect(collected).toEqual(["song-099", "song-199", "song-204"]);
    expect(new Set(collected).size).toBe(collected.length);
  });

  it("returns the last scanned position when the search scan budget is exhausted", async () => {
    const scannedRows = MAX_ADMIN_SONG_SEARCH_SCAN_BATCHES * 100;
    const songs = Array.from({ length: scannedRows + 1 }, (_, index) =>
      listSong(
        `song-${String(index).padStart(4, "0")}`,
        `Other ${index}`,
        `Display ${index}`,
        "Artist",
        []
      )
    );
    const repository = createPrismaAdminSongRepository(listDb(songs));

    const first = await repository.list("admin-user", {
      query: "missing",
      normalizedQuery: "missing",
      cursor: null,
      limit: 20
    });
    const second = await repository.list("admin-user", {
      query: "missing",
      normalizedQuery: "missing",
      cursor: first.nextCursorKey,
      limit: 20
    });

    expect(first.items).toEqual([]);
    expect(first.nextCursorKey).toEqual({
      updatedAt: "2026-07-26T00:00:00.000000Z",
      id: `song-${String(scannedRows - 1).padStart(4, "0")}`
    });
    expect(second.items).toEqual([]);
    expect(second.nextCursorKey).toBeNull();
  });

  it("returns only the provider listing summary required by the list UI", async () => {
    const repository = createPrismaAdminSongRepository(
      listDb(
        [listSong("song-a", "A", "표시", "Artist", [])],
        [
          {
            songId: "song-a",
            providerId: "tj",
            karaokeNumber: "12345",
            versionInfo: "original",
            availabilityStatus: "available",
            provider: { name: "TJ" },
            sourceName: "must-not-leak",
            verificationNote: "must-not-leak",
            verifiedBy: "must-not-leak"
          }
        ]
      )
    );

    const result = await repository.list("admin-user", {
      query: null,
      normalizedQuery: null,
      cursor: null,
      limit: 20
    });

    expect(result.items[0].provider_summary).toEqual([
      {
        provider_id: "tj",
        provider_name: "TJ",
        karaoke_number: "12345",
        version_info: "original",
        availability_status: "available"
      }
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /source_name|verification_note|verified_by|must-not-leak/iu
    );
  });

  it("creates the song, searchable aliases, and entries in one serializable transaction", async () => {
    const create = vi.fn(async (args: Record<string, unknown>) => {
      const data = args.data as Record<string, unknown>;
      return {
        id: data.id,
        displayTitle: data.displayTitle,
        canonicalArtist: data.canonicalArtist
      };
    });
    const transaction = {
      user: { findUnique: vi.fn(async () => ({ role: "admin" })) },
      song: { findFirst: vi.fn(async () => null), create },
      karaokeProvider: { findMany: vi.fn(async () => [{ id: "tj" }]) }
    };
    const db = {
      $transaction: vi.fn(async (callback, options) => {
        expect(options).toEqual({ isolationLevel: "Serializable" });
        return callback(transaction);
      })
    } as unknown as PrismaClient;
    let id = 0;
    const repository = createPrismaAdminSongRepository(db, () => `id-${++id}`);

    const result = await repository.create("admin-user", validInput());

    expect(transaction.user.findUnique).toHaveBeenCalledWith({
      where: { id: "admin-user" },
      select: { role: true }
    });
    expect(create).toHaveBeenCalledOnce();
    const createArgs = create.mock.calls[0][0] as {
      data: {
        verifiedBy: string;
        aliases: { create: Array<Record<string, unknown>> };
        karaokeEntries: { create: Array<Record<string, unknown>> };
      };
    };
    expect(createArgs.data.verifiedBy).toBe("admin:admin-user");
    expect(createArgs.data.aliases.create).toHaveLength(4);
    expect(createArgs.data.aliases.create).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: "레몬",
          aliasType: "display_title",
          normalizedAlias: "레몬",
          chosungAlias: "ㄹㅁ"
        })
      ])
    );
    expect(createArgs.data.karaokeEntries.create).toEqual([
      expect.objectContaining({
        providerId: "tj",
        karaokeNumber: "28822",
        availabilityStatus: "available",
        verifiedBy: "admin:admin-user"
      })
    ]);
    expect(result).toMatchObject({ alias_count: 4, karaoke_entry_count: 1 });
  });

  it("fails before catalog writes for a non-admin or unavailable provider", async () => {
    const create = vi.fn();
    const role = { current: "user" };
    const transaction = {
      user: { findUnique: vi.fn(async () => ({ role: role.current })) },
      song: { findFirst: vi.fn(async () => null), create },
      karaokeProvider: { findMany: vi.fn(async () => []) }
    };
    const db = {
      $transaction: vi.fn(async (callback) => callback(transaction))
    } as unknown as PrismaClient;
    const repository = createPrismaAdminSongRepository(db);

    await expect(repository.create("user-a", validInput())).rejects.toEqual(
      new AdminSongRepositoryError("FORBIDDEN")
    );
    expect(create).not.toHaveBeenCalled();

    role.current = "admin";
    await expect(repository.create("admin-a", validInput())).rejects.toEqual(
      new AdminSongRepositoryError("PROVIDER_NOT_FOUND")
    );
    expect(create).not.toHaveBeenCalled();
  });
});

function listSong(
  id: string,
  canonicalTitle: string,
  displayTitle: string,
  canonicalArtist: string,
  normalizedAliases: readonly string[],
  updatedAt = "2026-07-26T00:00:00.000000Z"
) {
  return {
    id,
    originalLanguage: "ja",
    canonicalTitle,
    displayTitle,
    canonicalArtist,
    updatedAt: toPreciseTimestamp(updatedAt),
    normalizedAliases,
    sourceName: "must-not-leak",
    sourceUrl: "https://secret.example",
    verificationNote: "must-not-leak",
    verifiedBy: "must-not-leak"
  };
}

function listDb(
  songs: ReturnType<typeof listSong>[],
  entries: ReadonlyArray<Record<string, unknown>> = []
): PrismaClient {
  const ordered = [...songs].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.id.localeCompare(right.id)
  );
  return {
    user: { findUnique: vi.fn(async () => ({ role: "admin" })) },
    $queryRaw: vi.fn(async (query: unknown) => {
      const values = (query as { values: readonly unknown[] }).values;
      const cursorUpdatedAt = values[0] as string | null;
      const cursorId = values[3] as string | null;
      const limit = values[4] as number;
      const filtered =
        cursorUpdatedAt === null
          ? ordered
          : ordered.filter(
              (song) =>
                song.updatedAt < cursorUpdatedAt ||
                (song.updatedAt === cursorUpdatedAt &&
                  cursorId !== null &&
                  song.id > cursorId)
            );
      return filtered.slice(0, limit);
    }),
    karaokeEntry: {
      findMany: vi.fn(async () => entries)
    }
  } as unknown as PrismaClient;
}

function toPreciseTimestamp(value: string): string {
  return value.replace(/(\.\d{3})Z$/u, "$1000Z");
}

function normalizeForTest(value: string): string {
  return value
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[()[\]{}]/gu, "")
    .replace(/[-_・.'!?]/gu, "")
    .replace(/\s+/gu, "");
}

function validInput(): AdminSongInput {
  return {
    original_language: "ja",
    canonical_title: "Lemon",
    display_title: "레몬",
    canonical_artist: "米津玄師",
    release_year: 2018,
    tie_in: null,
    source_url: "https://example.com",
    source_name: "Official",
    verification_note: null,
    aliases: [{ alias: "Lemon", language: "en", alias_type: "english_title" }],
    karaoke_entries: [
      {
        provider_id: "tj",
        karaoke_number: "28822",
        version_info: "",
        availability_status: "available",
        last_verified_at: "2026-07-22"
      }
    ]
  };
}
