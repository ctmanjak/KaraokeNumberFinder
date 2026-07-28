import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { normalizeSongIdentity } from "../song-identity/normalize";
import { findDuplicateCandidates } from "../admin-song-duplicate/repository";
import {
  AdminSongRepositoryError,
  createPrismaAdminSongRepository
} from "./repository";
import type { AdminSongInput } from "./types";

const testDatabaseUrl =
  process.env.ADMIN_T04_TEST_DATABASE_URL ??
  process.env.ADMIN_T03_TEST_DATABASE_URL;
const describeDatabase =
  testDatabaseUrl === undefined ? describe.skip : describe;

describeDatabase("ADMIN-T04 create on disposable PostgreSQL", () => {
  const adminId = randomUUID();
  const prefix = "song_admin_t04_it_";
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: testDatabaseUrl,
        max: 8
      })
    });
    await prisma.user.create({
      data: {
        id: adminId,
        name: "ADMIN-T04 integration",
        email: `${adminId}@e2e.invalid`,
        emailVerified: true,
        role: "admin"
      }
    });
  });

  afterEach(async () => {
    await prisma.song.deleteMany({ where: { id: { startsWith: prefix } } });
  });

  afterAll(async () => {
    await prisma.song.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.user.deleteMany({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  it("creates exactly three system aliases and keeps every source separate", async () => {
    const repository = createRepository();
    const input = createInput("Source separation", "Artist A", {
      aliases: [
        {
          alias: "Source separation alternate",
          language: "en",
          alias_type: "alternate_spelling",
          source_name: "Alias source",
          source_url: "https://alias.example/source"
        }
      ]
    });

    const result = await repository.create(adminId, input);
    const song = await prisma.song.findUniqueOrThrow({
      where: { id: result.song.id },
      include: {
        aliases: { orderBy: [{ aliasType: "asc" }, { id: "asc" }] },
        karaokeEntries: true
      }
    });

    expect(
      song.aliases.filter((alias) =>
        ["canonical_title", "display_title", "artist"].includes(alias.aliasType)
      )
    ).toHaveLength(3);
    expect(
      song.aliases
        .filter((alias) =>
          ["canonical_title", "display_title", "artist"].includes(
            alias.aliasType
          )
        )
        .every((alias) => alias.sourceName === null && alias.sourceUrl === null)
    ).toBe(true);
    expect(
      song.aliases.find((alias) => alias.aliasType === "alternate_spelling")
    ).toMatchObject({
      sourceName: "Alias source",
      sourceUrl: "https://alias.example/source",
      verifiedBy: `admin:${adminId}`
    });
    expect(song.karaokeEntries[0]).toMatchObject({
      sourceName: "Provider source",
      sourceUrl: "https://provider.example/source",
      verificationNote: "Provider verified",
      verifiedBy: `admin:${adminId}`
    });
    expect(song.sourceName).toBe("Song source");
    expect(result.created_counts).toEqual({
      songs: 1,
      administrator_aliases: 1,
      karaoke_entries: 1
    });
  });

  it("blocks normalized exact identities but permits a different-artist title after exact-set acknowledgement", async () => {
    const repository = createRepository();
    await repository.create(
      adminId,
      createInput("Ｆｕｌｌ－Ｗｉｄｔｈ!", "Artist Name")
    );

    await expect(
      repository.create(adminId, createInput("full width", "artist name"))
    ).rejects.toMatchObject({
      code: "DUPLICATE_SONG",
      candidates: [expect.objectContaining({ canonical_artist: "Artist Name" })]
    });

    const cover = createInput("Ｆｕｌｌ－Ｗｉｄｔｈ!", "Cover Artist");
    const candidates = await findDuplicateCandidates(prisma, {
      canonical_title: cover.canonical_title,
      display_title: cover.display_title,
      canonical_artist: cover.canonical_artist
    });
    expect(candidates.classification).toBe("possible");
    await expect(
      repository.create(adminId, {
        ...cover,
        possible_duplicate_acknowledged_song_ids: candidates.candidates.map(
          (candidate) => candidate.id
        )
      })
    ).resolves.toMatchObject({
      song: { canonical_artist: "Cover Artist" }
    });
  });

  it("allows only one concurrent create for the same normalized identity and leaves no partial child rows", async () => {
    const input = createInput("Concurrent Identity", "Concurrent Artist");
    const outcomes = await Promise.allSettled([
      createRepository().create(adminId, input),
      createRepository().create(adminId, input)
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled")
    ).toHaveLength(1);
    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected"
    );
    expect(rejected?.reason).toBeInstanceOf(AdminSongRepositoryError);
    expect(rejected?.reason).toMatchObject({ code: "DUPLICATE_SONG" });

    const identity = normalizeSongIdentity(input);
    const songs = await prisma.song.findMany({
      where: {
        normalizedCanonicalTitle: identity.normalizedCanonicalTitle,
        normalizedCanonicalArtist: identity.normalizedCanonicalArtist
      },
      include: { aliases: true, karaokeEntries: true }
    });
    expect(songs).toHaveLength(1);
    expect(songs[0].aliases).toHaveLength(3);
    expect(songs[0].karaokeEntries).toHaveLength(1);
  });

  it("rolls back the aggregate on the one-second candidate timeout and does not leak the setting", async () => {
    const blocker = new Client({ connectionString: testDatabaseUrl });
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE songs IN ACCESS EXCLUSIVE MODE");
    const input = createInput("Timeout Identity", "Timeout Artist");

    try {
      await expect(
        createRepository().create(adminId, input)
      ).rejects.toMatchObject({ code: "DUPLICATE_CHECK_TIMEOUT" });
    } finally {
      await blocker.query("ROLLBACK");
      await blocker.end();
    }

    const identity = normalizeSongIdentity(input);
    expect(
      await prisma.song.count({
        where: {
          normalizedCanonicalTitle: identity.normalizedCanonicalTitle,
          normalizedCanonicalArtist: identity.normalizedCanonicalArtist
        }
      })
    ).toBe(0);
    await expect(
      findDuplicateCandidates(prisma, {
        canonical_title: "Lemon",
        canonical_artist: "米津玄師"
      })
    ).resolves.toMatchObject({ classification: "exact" });
  });

  function createRepository() {
    return createPrismaAdminSongRepository(
      prisma,
      () => `admin_t04_it_${randomUUID()}`,
      () => new Date("2026-07-28T12:00:00.000Z")
    );
  }

  function createInput(
    title: string,
    artist: string,
    patch: Partial<AdminSongInput> = {}
  ): AdminSongInput {
    return {
      original_language: "en",
      canonical_title: title,
      display_title: title,
      canonical_artist: artist,
      release_year: 2026,
      tie_in: null,
      source_name: "Song source",
      source_url: "https://song.example/source",
      aliases: [],
      karaoke_entries: [
        {
          provider_id: "provider_tj",
          karaoke_number: `t04-${randomUUID().slice(0, 8)}`,
          version_info: "",
          availability_status: "available",
          last_verified_at: "2026-07-28",
          source_name: "Provider source",
          source_url: "https://provider.example/source",
          verification_note: "Provider verified"
        }
      ],
      ...patch
    };
  }
});
