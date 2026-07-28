import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../generated/prisma/client";
import { createPrismaAdminSongDetailRepository } from "./repository";
import type { AdminSongPatchInput } from "./types";

describe("administrator song aggregate contextual validation", () => {
  it.each([
    [
      "identity source reconfirmation",
      () => {
        const input = basePatch();
        const song = { ...input.song };
        delete song.source_name;
        return {
          ...input,
          song: { ...song, canonical_title: "Changed title" }
        };
      },
      "song.source_name"
    ],
    [
      "entry deletion",
      () => ({ ...basePatch(), karaoke_entries: [] }),
      "karaoke_entries"
    ],
    [
      "new entry source name",
      () => ({
        ...basePatch(),
        karaoke_entries: [
          ...basePatch().karaoke_entries,
          {
            provider_id: "tj",
            karaoke_number: "54321",
            version_info: "live",
            availability_status: "available" as const,
            last_verified_at: "2026-07-26",
            source_name: "   "
          }
        ]
      }),
      "karaoke_entries.1.source_name"
    ],
    [
      "status date reconfirmation",
      () => ({
        ...basePatch(),
        karaoke_entries: [
          {
            id: "entry_1",
            provider_id: "tj",
            karaoke_number: "",
            version_info: "",
            availability_status: "not_available"
          }
        ]
      }),
      "karaoke_entries.0.last_verified_at"
    ],
    [
      "unavailable note",
      () => ({
        ...basePatch(),
        karaoke_entries: [
          {
            id: "entry_1",
            provider_id: "tj",
            karaoke_number: "",
            version_info: "",
            availability_status: "not_available",
            last_verified_at: "2026-07-26",
            source_name: "Reconfirmed",
            verification_note: null
          }
        ]
      }),
      "karaoke_entries.0.verification_note"
    ],
    [
      "future verification date",
      () => ({
        ...basePatch(),
        karaoke_entries: [
          {
            ...basePatch().karaoke_entries[0],
            last_verified_at: "2026-07-28"
          }
        ]
      }),
      "karaoke_entries.0.last_verified_at"
    ],
    [
      "system alias duplicate",
      () => ({
        ...basePatch(),
        aliases: [
          {
            alias: "Lemon",
            language: "en",
            alias_type: "english_title"
          }
        ]
      }),
      "aliases.0.alias"
    ],
    [
      "31 aliases",
      () => ({
        ...basePatch(),
        aliases: Array.from({ length: 31 }, (_, index) => ({
          alias: `Unique alias ${index}`,
          language: "en",
          alias_type: "english_title" as const
        }))
      }),
      "aliases"
    ],
    [
      "21 entries",
      () => ({
        ...basePatch(),
        karaoke_entries: [
          basePatch().karaoke_entries[0],
          ...Array.from({ length: 20 }, (_, index) => ({
            provider_id: "tj",
            karaoke_number: String(20_000 + index),
            version_info: `version ${index}`,
            availability_status: "available" as const,
            last_verified_at: "2026-07-26",
            source_name: "New entry source"
          }))
        ]
      }),
      "karaoke_entries"
    ]
  ])(
    "rejects %s before any aggregate mutation",
    async (_name, makeInput, path) => {
      const transaction = transactionStub();
      const database = {
        $transaction: vi.fn(async (run) => run(transaction))
      } as unknown as PrismaClient;
      const repository = createPrismaAdminSongDetailRepository(database, {
        now: () => new Date("2026-07-27T00:00:00.000Z")
      });

      await expect(
        repository.update(
          "admin_1",
          "song_1",
          makeInput() as AdminSongPatchInput
        )
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        details: { issues: [expect.objectContaining({ path })] }
      });
      expect(transaction.song.update).not.toHaveBeenCalled();
      expect(transaction.songAlias.update).not.toHaveBeenCalled();
      expect(transaction.karaokeEntry.update).not.toHaveBeenCalled();
    }
  );
});

function transactionStub() {
  return {
    user: { findUnique: vi.fn(async () => ({ role: "admin" })) },
    song: {
      findUnique: vi.fn(async () => detailRecord()),
      update: vi.fn()
    },
    songAlias: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    karaokeEntry: {
      create: vi.fn(),
      update: vi.fn()
    },
    karaokeProvider: { findMany: vi.fn() },
    $executeRawUnsafe: vi.fn(),
    $queryRaw: vi.fn()
  };
}

function basePatch(): AdminSongPatchInput {
  return {
    expected_updated_at: "2026-07-27T00:00:00.000Z",
    song: {
      original_language: "ja",
      canonical_title: "Lemon",
      display_title: "레몬",
      canonical_artist: "Artist",
      release_year: 2018,
      tie_in: null,
      source_name: "Official"
    },
    aliases: [],
    karaoke_entries: [
      {
        id: "entry_1",
        provider_id: "tj",
        karaoke_number: "12345",
        version_info: "",
        availability_status: "available",
        last_verified_at: "2026-07-26",
        source_name: "TJ"
      }
    ],
    possible_duplicate_acknowledged_song_ids: []
  };
}

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
    sourceUrl: null,
    verificationNote: null,
    updatedAt,
    aliases: [
      alias("alias_canonical", "Lemon", "canonical_title", updatedAt),
      alias("alias_display", "레몬", "display_title", updatedAt),
      alias("alias_artist", "Artist", "artist", updatedAt)
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
  aliasType: "canonical_title" | "display_title" | "artist",
  updatedAt: Date
) {
  return {
    id,
    alias: value,
    language: "ja",
    aliasType,
    normalizedAlias:
      aliasType === "display_title" ? "레몬" : value.toLowerCase(),
    sourceName: "Official",
    sourceUrl: null,
    verificationNote: null,
    updatedAt
  };
}
