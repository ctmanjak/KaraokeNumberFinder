import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  AdminSongRepositoryError,
  createPrismaAdminSongRepository
} from "../admin-song/repository";
import { PrismaClient } from "../generated/prisma/client";
import { buildAliasSearchFields } from "../search/normalize";
import { normalizeSongIdentity } from "../song-identity/normalize";
import {
  AdminSongDetailRepositoryError,
  createPrismaAdminSongDetailRepository
} from "./repository";
import type { AdminSongDetail, AdminSongPatchInput } from "./types";

const testDatabaseUrl = process.env.ADMIN_T03_TEST_DATABASE_URL;
const describeDatabase =
  testDatabaseUrl === undefined ? describe.skip : describe.sequential;
const ADMIN_ID = "10000000-0000-4000-8000-000000000003";
const SONG_PREFIX = "admin_t03_it_";

describeDatabase(
  "administrator song aggregate on disposable PostgreSQL",
  () => {
    let prisma: PrismaClient;
    let repository: ReturnType<typeof createPrismaAdminSongDetailRepository>;
    let providerId: string;
    let generated = 0;

    beforeAll(async () => {
      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: testDatabaseUrl, max: 10 })
      });
      const provider = await prisma.karaokeProvider.findFirst({
        where: { isActive: true },
        orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
        select: { id: true }
      });
      if (provider === null) throw new Error("An active provider is required.");
      providerId = provider.id;
      await prisma.user.upsert({
        where: { id: ADMIN_ID },
        create: {
          id: ADMIN_ID,
          name: "ADMIN-T03 integration",
          email: "admin-t03-integration@example.invalid",
          emailVerified: true,
          role: "admin"
        },
        update: { role: "admin" }
      });
      repository = createPrismaAdminSongDetailRepository(prisma, {
        generateId: () => `it-${++generated}`,
        now: () => new Date("2026-07-27T00:00:00.000Z")
      });
    });

    afterEach(async () => {
      await prisma.song.deleteMany({
        where: {
          OR: [
            { id: { startsWith: SONG_PREFIX } },
            { id: { startsWith: "song_admin_t03_it_" } }
          ]
        }
      });
    });

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { id: ADMIN_ID } });
      await prisma.$disconnect();
    });

    it("projects safe fields and atomically adds, updates, and deletes only allowed children", async () => {
      const songId = `${SONG_PREFIX}aggregate`;
      await createFixture(songId, "Aggregate Song", "Aggregate Artist");
      const before = await repository.get(ADMIN_ID, songId);
      expect(JSON.stringify(before)).not.toMatch(
        /verified_by|email|token|session/iu
      );

      const result = await repository.update(
        ADMIN_ID,
        songId,
        patch(before, {
          releaseYear: 2026,
          aliases: [
            {
              id: `${songId}_admin_a`,
              alias: "Updated alternate",
              language: "en",
              alias_type: "english_title"
            },
            {
              alias: "Brand new alternate",
              language: "en",
              alias_type: "translated_title"
            }
          ],
          entries: [
            {
              id: `${songId}_entry`,
              provider_id: providerId,
              karaoke_number: "11112",
              version_info: "",
              availability_status: "available",
              last_verified_at: "2026-07-26",
              source_name: "Integration catalog"
            },
            {
              provider_id: providerId,
              karaoke_number: "99999",
              version_info: "live",
              availability_status: "available",
              last_verified_at: "2026-07-26",
              source_name: "Integration catalog"
            }
          ]
        })
      );

      expect(result.change_counts).toMatchObject({
        song_fields: 1,
        aliases_added: 1,
        aliases_updated: 1,
        aliases_deleted: 1,
        karaoke_entries_added: 1,
        karaoke_entries_updated: 1
      });
      expect(result.detail.aliases.map((alias) => alias.id)).toContain(
        `${songId}_admin_a`
      );
      expect(result.detail.aliases.map((alias) => alias.id)).not.toContain(
        `${songId}_admin_b`
      );
      expect(result.detail.karaoke_entries.map((entry) => entry.id)).toContain(
        `${songId}_entry`
      );
      expect(result.detail.system_aliases).toHaveLength(3);
    });

    it("preserves system alias ids while synchronizing raw and normalized identity", async () => {
      const songId = `${SONG_PREFIX}identity`;
      await createFixture(songId, "Identity Before", "Identity Artist Before");
      const before = await repository.get(ADMIN_ID, songId);
      const systemIds = before.system_aliases.map((alias) => alias.id).sort();
      const input = patch(before);
      const identityPatch = {
        ...input,
        song: {
          ...input.song,
          canonical_title: "  Ｉｄｅｎｔｉｔｙ！ After ",
          display_title: "Identity After Display",
          canonical_artist: "Identity Artist After",
          source_name: "Reconfirmed identity source"
        }
      };

      const result = await repository.update(ADMIN_ID, songId, identityPatch);
      const stored = await prisma.song.findUniqueOrThrow({
        where: { id: songId },
        include: { aliases: true }
      });

      expect(
        result.detail.system_aliases.map((alias) => alias.id).sort()
      ).toEqual(systemIds);
      expect(stored.normalizedCanonicalTitle).toBe("identityafter");
      expect(stored.normalizedCanonicalArtist).toBe("identityartistafter");
      for (const [type, value] of [
        ["canonical_title", identityPatch.song.canonical_title],
        ["display_title", identityPatch.song.display_title],
        ["artist", identityPatch.song.canonical_artist]
      ] as const) {
        expect(
          stored.aliases.filter(
            (alias) => alias.aliasType === type && alias.alias === value
          )
        ).toHaveLength(1);
      }
    });

    it("rolls back the whole aggregate on stale and exact-duplicate conflicts", async () => {
      const staleId = `${SONG_PREFIX}stale`;
      await createFixture(staleId, "Stale Song", "Stale Artist");
      const staleDetail = await repository.get(ADMIN_ID, staleId);
      await prisma.song.update({
        where: { id: staleId },
        data: { releaseYear: 2025 }
      });
      const stalePatch = patch(staleDetail, {
        aliases: [
          ...staleDetail.aliases.map(toAliasInput),
          {
            alias: "Must roll back",
            language: "en",
            alias_type: "translated_title"
          }
        ]
      });
      await expect(
        repository.update(ADMIN_ID, staleId, stalePatch)
      ).rejects.toMatchObject({ code: "STALE" });
      expect(
        await prisma.songAlias.count({
          where: { songId: staleId, alias: "Must roll back" }
        })
      ).toBe(0);

      const targetId = `${SONG_PREFIX}duplicate_target`;
      const existingId = `${SONG_PREFIX}duplicate_existing`;
      await createFixture(targetId, "Target Song", "Target Artist");
      await createFixture(existingId, "Existing Song", "Existing Artist");
      const target = await repository.get(ADMIN_ID, targetId);
      const baseDuplicatePatch = patch(target);
      const duplicatePatch = {
        ...baseDuplicatePatch,
        song: {
          ...baseDuplicatePatch.song,
          canonical_title: "Existing Song",
          display_title: "Existing display",
          canonical_artist: "Existing Artist",
          source_name: "Reconfirmed"
        }
      };

      await expect(
        repository.update(ADMIN_ID, targetId, duplicatePatch)
      ).rejects.toMatchObject({
        code: "DUPLICATE_SONG",
        candidates: [expect.objectContaining({ id: existingId })]
      });
      const unchanged = await prisma.song.findUniqueOrThrow({
        where: { id: targetId }
      });
      expect(unchanged.canonicalTitle).toBe("Target Song");
    });

    it("allows exactly one of two concurrent updates with the same expected timestamp", async () => {
      const songId = `${SONG_PREFIX}concurrent`;
      await createFixture(songId, "Concurrent Song", "Concurrent Artist");
      const detail = await repository.get(ADMIN_ID, songId);
      const results = await Promise.allSettled([
        repository.update(
          ADMIN_ID,
          songId,
          patch(detail, { releaseYear: 2024 })
        ),
        repository.update(
          ADMIN_ID,
          songId,
          patch(detail, { releaseYear: 2025 })
        )
      ]);

      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      const rejected = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected"
      );
      expect(rejected?.reason).toBeInstanceOf(AdminSongDetailRepositoryError);
      expect((rejected?.reason as AdminSongDetailRepositoryError).code).toBe(
        "STALE"
      );
    });

    it("prevents a POST/PATCH race from committing two normalized identities", async () => {
      const targetId = `${SONG_PREFIX}post_patch_race`;
      await createFixture(targetId, "Race Target Before", "Race Artist Before");
      const detail = await repository.get(ADMIN_ID, targetId);
      const basePatch = patch(detail);
      const update = {
        ...basePatch,
        song: {
          ...basePatch.song,
          canonical_title: "Race Shared Identity",
          display_title: "Race Shared Display",
          canonical_artist: "Race Shared Artist",
          source_name: "Race reconfirmation"
        }
      };
      let postId = 0;
      const createRepository = createPrismaAdminSongRepository(
        prisma,
        () => `admin_t03_it_${++postId}`
      );

      const outcomes = await Promise.allSettled([
        repository.update(ADMIN_ID, targetId, update),
        createRepository.create(ADMIN_ID, {
          original_language: "en",
          canonical_title: "Race Shared Identity",
          display_title: "Race Shared Display",
          canonical_artist: "Race Shared Artist",
          release_year: 2026,
          tie_in: null,
          source_url: null,
          source_name: "Race source",
          aliases: [],
          karaoke_entries: [
            {
              provider_id: providerId,
              karaoke_number: "77777",
              version_info: "",
              availability_status: "available",
              last_verified_at: "2026-07-26",
              source_name: "Race provider source",
              source_url: null,
              verification_note: null
            }
          ]
        })
      ]);

      expect(
        outcomes.filter((outcome) => outcome.status === "fulfilled")
      ).toHaveLength(1);
      expect(
        await prisma.song.count({
          where: {
            normalizedCanonicalTitle: "racesharedidentity",
            normalizedCanonicalArtist: "racesharedartist"
          }
        })
      ).toBe(1);
      const failure = outcomes.find(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === "rejected"
      )?.reason;
      expect(
        failure instanceof AdminSongDetailRepositoryError ||
          failure instanceof AdminSongRepositoryError
      ).toBe(true);
      expect(["DUPLICATE_SONG", "STALE", "CONFLICT"]).toContain(failure.code);
    });

    async function createFixture(
      id: string,
      canonicalTitle: string,
      canonicalArtist: string
    ) {
      const identity = normalizeSongIdentity({
        canonical_title: canonicalTitle,
        canonical_artist: canonicalArtist
      });
      const displayTitle = `${canonicalTitle} display`;
      await prisma.song.create({
        data: {
          id,
          originalLanguage: "en",
          canonicalTitle,
          displayTitle,
          canonicalArtist,
          normalizedCanonicalTitle: identity.normalizedCanonicalTitle,
          normalizedCanonicalArtist: identity.normalizedCanonicalArtist,
          releaseYear: 2020,
          sourceName: "Integration source",
          verifiedBy: `admin:${ADMIN_ID}`,
          aliases: {
            create: [
              alias(`${id}_canonical`, canonicalTitle, "canonical_title"),
              alias(`${id}_display`, displayTitle, "display_title"),
              alias(`${id}_artist`, canonicalArtist, "artist"),
              alias(
                `${id}_admin_a`,
                `${canonicalTitle} alternate A`,
                "english_title"
              ),
              alias(
                `${id}_admin_b`,
                `${canonicalTitle} alternate B`,
                "translated_title"
              )
            ]
          },
          karaokeEntries: {
            create: {
              id: `${id}_entry`,
              providerId,
              karaokeNumber: "11111",
              versionInfo: "",
              availabilityStatus: "available",
              lastVerifiedAt: new Date("2026-07-26T00:00:00.000Z"),
              sourceName: "Integration catalog",
              verifiedBy: `admin:${ADMIN_ID}`
            }
          }
        }
      });
    }
  }
);

function alias(
  id: string,
  value: string,
  aliasType:
    | "canonical_title"
    | "display_title"
    | "artist"
    | "english_title"
    | "translated_title"
) {
  const search = buildAliasSearchFields(value);
  return {
    id,
    alias: value,
    language: "en",
    aliasType,
    normalizedAlias: search.normalizedAlias,
    chosungAlias: search.chosungAlias || null,
    sourceName: "Integration source",
    verifiedBy: `admin:${ADMIN_ID}`
  };
}

function patch(
  detail: AdminSongDetail,
  overrides: Readonly<{
    releaseYear?: number;
    aliases?: AdminSongPatchInput["aliases"];
    entries?: AdminSongPatchInput["karaoke_entries"];
  }> = {}
): AdminSongPatchInput {
  return {
    expected_updated_at: detail.song.updated_at,
    song: {
      original_language: detail.song.original_language,
      canonical_title: detail.song.canonical_title,
      display_title: detail.song.display_title,
      canonical_artist: detail.song.canonical_artist,
      release_year: overrides.releaseYear ?? detail.song.release_year,
      tie_in: detail.song.tie_in,
      source_name: detail.song.source_name,
      source_url: detail.song.source_url,
      verification_note: detail.song.verification_note
    },
    aliases: overrides.aliases ?? detail.aliases.map(toAliasInput),
    karaoke_entries:
      overrides.entries ?? detail.karaoke_entries.map(toEntryInput),
    possible_duplicate_acknowledged_song_ids: []
  };
}

function toAliasInput(aliasValue: AdminSongDetail["aliases"][number]) {
  return {
    id: aliasValue.id,
    alias: aliasValue.alias,
    language: aliasValue.language,
    alias_type: aliasValue.alias_type,
    source_name: aliasValue.source_name,
    source_url: aliasValue.source_url,
    verification_note: aliasValue.verification_note
  };
}

function toEntryInput(entry: AdminSongDetail["karaoke_entries"][number]) {
  return {
    id: entry.id,
    provider_id: entry.provider_id,
    karaoke_number: entry.karaoke_number,
    version_info: entry.version_info,
    availability_status: entry.availability_status,
    last_verified_at: entry.last_verified_at,
    source_name: entry.source_name,
    source_url: entry.source_url,
    verification_note: entry.verification_note
  };
}
