import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { optionalM3TestDatabaseUrl } from "../../scripts/m3/test-db-url";
import { PrismaClient } from "../generated/prisma/client";
import { createPrismaFavoriteRepository } from "./repository";

const testDatabaseUrl = optionalM3TestDatabaseUrl(
  process.env.M3_TEST_DATABASE_URL
);
const describeDatabase =
  testDatabaseUrl === undefined ? describe.skip : describe;

describeDatabase("favorite repository on PostgreSQL", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrl, max: 20 })
    });
  });

  beforeEach(async () => {
    await prisma.favorite.deleteMany();
    await prisma.user.deleteMany();
    await prisma.songAlias.deleteMany();
    await prisma.karaokeEntry.deleteMany();
    await prisma.song.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("isolates list and delete operations by authenticated owner", async () => {
    const [userId, otherUserId] = await Promise.all([
      createUser(prisma),
      createUser(prisma)
    ]);
    const songId = await createSong(prisma);
    const repository = createPrismaFavoriteRepository(prisma);

    await Promise.all([
      repository.add({ userId, songId }),
      repository.add({ userId: otherUserId, songId })
    ]);

    const ownerRows = await repository.listPage({
      owner: { userId },
      take: 20
    });

    expect(ownerRows.map((row) => row.songId)).toEqual([songId]);
    await repository.delete({ userId, songId });

    await expect(prisma.favorite.count({ where: { userId } })).resolves.toBe(0);
    await expect(
      prisma.favorite.count({ where: { userId: otherUserId } })
    ).resolves.toBe(1);
    await expect(
      repository.listPage({ owner: { userId: otherUserId }, take: 20 })
    ).resolves.toMatchObject([{ songId }]);
  });

  it("keeps one row for concurrent PUT-equivalent adds", async () => {
    const userId = await createUser(prisma);
    const songId = await createSong(prisma);
    const repository = createPrismaFavoriteRepository(prisma);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => repository.add({ userId, songId }))
    );

    expect(results.every(({ status }) => status === "ok")).toBe(true);
    await expect(
      prisma.favorite.count({ where: { userId, songId } })
    ).resolves.toBe(1);
  });

  it("keeps concurrent DELETE-equivalent calls idempotent and owner-scoped", async () => {
    const [userId, otherUserId] = await Promise.all([
      createUser(prisma),
      createUser(prisma)
    ]);
    const songId = await createSong(prisma);
    const repository = createPrismaFavoriteRepository(prisma);
    await Promise.all([
      repository.add({ userId, songId }),
      repository.add({ userId: otherUserId, songId })
    ]);

    await Promise.all(
      Array.from({ length: 20 }, () => repository.delete({ userId, songId }))
    );

    await expect(prisma.favorite.count({ where: { userId } })).resolves.toBe(0);
    await expect(
      prisma.favorite.count({ where: { userId: otherUserId, songId } })
    ).resolves.toBe(1);
  });

  it("preserves the unique invariant when PUT and DELETE race", async () => {
    const userId = await createUser(prisma);
    const songId = await createSong(prisma);
    const repository = createPrismaFavoriteRepository(prisma);

    const outcomes = await Promise.allSettled([
      ...Array.from({ length: 10 }, () => repository.add({ userId, songId })),
      ...Array.from({ length: 10 }, () => repository.delete({ userId, songId }))
    ]);

    expect(outcomes.every(({ status }) => status === "fulfilled")).toBe(true);
    await expect(
      prisma.favorite.count({ where: { userId, songId } })
    ).resolves.toBeLessThanOrEqual(1);
  });
});

async function createUser(prisma: PrismaClient): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name: "Favorite Integration Test User",
      email: `favorite-${randomUUID()}@example.com`,
      emailVerified: true
    },
    select: { id: true }
  });
  return user.id;
}

async function createSong(prisma: PrismaClient): Promise<string> {
  const song = await prisma.song.create({
    data: {
      id: `favorite-song-${randomUUID()}`,
      originalLanguage: "ja",
      canonicalTitle: "Favorite Integration Test Song",
      displayTitle: "Favorite Integration Test Song",
      canonicalArtist: "Favorite Integration Test Artist",
      verifiedBy: "m3-favorite-integration-test"
    },
    select: { id: true }
  });
  return song.id;
}
