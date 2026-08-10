import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createPrismaAdminSongDetailRepository } from "./repository";
import type { AdminSongPatchInput } from "./types";

describe("administrator song detail repository", () => {
  it("projects only editable detail fields and preserves existing child IDs in one transaction", async () => {
    const current = detailRecord();
    const transaction = {
      user: { findUnique: vi.fn(async () => ({ role: "admin" })) },
      song: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce({
            ...current,
            releaseYear: 2019,
            aliases: current.aliases.map((alias) =>
              alias.id === "alias_admin"
                ? { ...alias, alias: "Updated alias" }
                : alias
            ),
            karaokeEntries: current.karaokeEntries.map((entry) => ({
              ...entry,
              karaokeNumber: "54321"
            }))
          }),
        update: vi.fn(async () => ({ id: current.id }))
      },
      karaokeProvider: {
        findMany: vi.fn(async () => [{ id: "tj" }])
      },
      songAlias: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        create: vi.fn(),
        update: vi.fn(async () => ({ id: "alias" }))
      },
      karaokeEntry: {
        create: vi.fn(),
        update: vi.fn(async () => ({ id: "entry_1" }))
      },
      $executeRawUnsafe: vi.fn(),
      $queryRaw: vi.fn()
    };
    const db = {
      $transaction: vi.fn(async (run, options) => {
        expect(options).toEqual({ isolationLevel: "Serializable" });
        return run(transaction);
      })
    } as unknown as PrismaClient;
    const repository = createPrismaAdminSongDetailRepository(db, {
      generateId: () => "generated",
      now: () => new Date("2026-07-27T00:00:00.000Z")
    });

    const result = await repository.update("admin_1", "song_1", patchInput());

    expect(transaction.songAlias.create).not.toHaveBeenCalled();
    expect(transaction.karaokeEntry.create).not.toHaveBeenCalled();
    expect(transaction.karaokeEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "entry_1" } })
    );
    expect(transaction.songAlias.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "alias_admin" } })
    );
    expect(transaction.song.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "song_1" },
        data: expect.objectContaining({
          normalizedCanonicalTitle: "lemon",
          normalizedCanonicalArtist: "artist",
          verifiedBy: "admin:admin_1"
        })
      })
    );
    expect(result.detail.aliases[0]).toMatchObject({
      id: "alias_admin",
      alias: "Updated alias"
    });
    expect(result.detail.karaoke_entries[0]).toMatchObject({
      id: "entry_1",
      karaoke_number: "54321"
    });
    expect(JSON.stringify(result.detail)).not.toMatch(/verified_by|email/iu);
  });
});

function detailRecord() {
  const updatedAt = new Date("2026-07-27T00:00:00.000Z");
  return {
    id: "song_1",
    originalLanguage: "ja",
    canonicalTitle: "Lemon",
    displayTitle: "레몬",
    canonicalArtist: "Artist",
    releaseYear: 2018,
    tieIn: null,
    sourceName: "Official",
    sourceUrl: "https://example.com/song",
    verificationNote: null,
    updatedAt,
    aliases: [
      alias("alias_canonical", "Lemon", "canonical_title", updatedAt),
      alias("alias_display", "레몬", "display_title", updatedAt),
      alias("alias_artist", "Artist", "artist", updatedAt),
      alias("alias_admin", "Old alias", "english_title", updatedAt)
    ],
    karaokeEntries: [
      {
        id: "entry_1",
        providerId: "tj",
        karaokeNumber: "12345",
        versionInfo: "",
        availabilityStatus: "available",
        lastVerifiedAt: new Date("2026-07-26T00:00:00.000Z"),
        sourceName: "TJ",
        sourceUrl: null,
        verificationNote: null,
        updatedAt,
        provider: { name: "TJ", country: "KR" }
      }
    ]
  };
}

function alias(
  id: string,
  value: string,
  aliasType: "canonical_title" | "display_title" | "artist" | "english_title",
  updatedAt: Date
) {
  return {
    id,
    alias: value,
    language: "ja",
    aliasType,
    normalizedAlias: value.toLowerCase(),
    sourceName: "Official",
    sourceUrl: null,
    verificationNote: null,
    updatedAt
  };
}

function patchInput(): AdminSongPatchInput {
  return {
    expected_updated_at: "2026-07-27T00:00:00.000Z",
    song: {
      original_language: "ja",
      canonical_title: "Lemon",
      display_title: "레몬",
      canonical_artist: "Artist",
      release_year: 2019,
      tie_in: null,
      source_name: "Official",
      source_url: "https://example.com/song",
      verification_note: null
    },
    aliases: [
      {
        id: "alias_admin",
        alias: "Updated alias",
        language: "en",
        alias_type: "english_title",
        source_name: "Official",
        source_url: null,
        verification_note: null
      }
    ],
    karaoke_entries: [
      {
        id: "entry_1",
        provider_id: "tj",
        karaoke_number: "54321",
        version_info: "",
        availability_status: "available",
        last_verified_at: "2026-07-26",
        source_name: "TJ",
        source_url: null,
        verification_note: null
      }
    ],
    possible_duplicate_acknowledged_song_ids: []
  };
}
