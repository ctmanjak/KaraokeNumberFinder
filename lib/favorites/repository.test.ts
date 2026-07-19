import { describe, expect, it, vi } from "vitest";

import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { createPrismaFavoriteRepository } from "./repository";

describe("Prisma favorite repository", () => {
  it("uses an owner-scoped database cursor with stable descending order", async () => {
    const prisma = prismaStub();
    const cursor = {
      id: "favorite-b"
    };
    const repository = createPrismaFavoriteRepository(prisma.client);

    await repository.listPage({
      owner: { userId: "user-a" },
      cursor,
      take: 21
    });

    expect(prisma.favorite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-a"
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        cursor: { id: cursor.id, userId: "user-a" },
        skip: 1,
        take: 21
      })
    );
  });

  it("uses the user-song unique key for idempotent repeated adds", async () => {
    const createdAt = new Date("2026-07-19T03:00:00.000Z");
    const prisma = prismaStub({
      findSong: vi.fn(async () => ({ id: "song-a" })),
      upsert: vi.fn(async () => ({ createdAt }))
    });
    const repository = createPrismaFavoriteRepository(prisma.client);
    const identity = { userId: "user-a", songId: "song-a" };

    const [first, second] = await Promise.all([
      repository.add(identity),
      repository.add(identity)
    ]);

    expect(first).toEqual({ status: "ok", favorite: { createdAt } });
    expect(second).toEqual(first);
    expect(prisma.favorite.upsert).toHaveBeenCalledWith({
      where: { userId_songId: identity },
      create: identity,
      update: {},
      select: { createdAt: true }
    });
  });

  it("recovers a concurrent unique collision as the existing favorite", async () => {
    const createdAt = new Date("2026-07-19T03:00:00.000Z");
    const prisma = prismaStub({
      findSong: vi.fn(async () => ({ id: "song-a" })),
      upsert: vi.fn(async () => {
        throw knownPrismaError("P2002");
      }),
      findFavorite: vi.fn(async () => ({ createdAt }))
    });
    const repository = createPrismaFavoriteRepository(prisma.client);

    await expect(
      repository.add({ userId: "user-a", songId: "song-a" })
    ).resolves.toEqual({ status: "ok", favorite: { createdAt } });
  });

  it("returns song_not_found without attempting an insert", async () => {
    const prisma = prismaStub({ findSong: vi.fn(async () => null) });
    const repository = createPrismaFavoriteRepository(prisma.client);

    await expect(
      repository.add({ userId: "user-a", songId: "missing" })
    ).resolves.toEqual({ status: "song_not_found" });
    expect(prisma.favorite.upsert).not.toHaveBeenCalled();
  });

  it("maps a song deletion race after a foreign-key failure", async () => {
    const findSong = vi
      .fn()
      .mockResolvedValueOnce({ id: "song-a" })
      .mockResolvedValueOnce(null);
    const prisma = prismaStub({
      findSong,
      upsert: vi.fn(async () => {
        throw knownPrismaError("P2003");
      })
    });
    const repository = createPrismaFavoriteRepository(prisma.client);

    await expect(
      repository.add({ userId: "user-a", songId: "song-a" })
    ).resolves.toEqual({ status: "song_not_found" });
  });

  it("deletes idempotently with both owner and song conditions", async () => {
    const prisma = prismaStub();
    const repository = createPrismaFavoriteRepository(prisma.client);
    const identity = { userId: "user-a", songId: "song-a" };

    await repository.delete(identity);
    await repository.delete(identity);

    expect(prisma.favorite.deleteMany).toHaveBeenCalledTimes(2);
    expect(prisma.favorite.deleteMany).toHaveBeenCalledWith({
      where: identity
    });
  });
});

function knownPrismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("internal database detail", {
    code,
    clientVersion: "7.8.0"
  });
}

function prismaStub(
  overrides: {
    findSong?: ReturnType<typeof vi.fn>;
    findMany?: ReturnType<typeof vi.fn>;
    upsert?: ReturnType<typeof vi.fn>;
    findFavorite?: ReturnType<typeof vi.fn>;
    deleteMany?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const favorite = {
    findMany: overrides.findMany ?? vi.fn(async () => []),
    upsert:
      overrides.upsert ??
      vi.fn(async () => ({
        createdAt: new Date("2026-07-19T00:00:00.000Z")
      })),
    findUnique: overrides.findFavorite ?? vi.fn(async () => null),
    deleteMany: overrides.deleteMany ?? vi.fn(async () => ({ count: 0 }))
  };
  const song = {
    findUnique: overrides.findSong ?? vi.fn(async () => ({ id: "song-a" }))
  };
  const client = { favorite, song } as unknown as Pick<
    PrismaClient,
    "favorite" | "song"
  >;

  return { client, favorite, song };
}
