import { Prisma, type PrismaClient } from "../generated/prisma/client";

import type {
  FavoriteIdentity,
  FavoriteListRecord,
  FavoriteRepository
} from "./service";

type FavoritePrismaClient = Pick<PrismaClient, "favorite" | "song">;

const favoriteCardSelection = {
  id: true,
  songId: true,
  createdAt: true,
  song: {
    select: {
      id: true,
      originalLanguage: true,
      canonicalTitle: true,
      displayTitle: true,
      canonicalArtist: true,
      releaseYear: true,
      tieIn: true,
      karaokeEntries: {
        select: {
          id: true,
          providerId: true,
          karaokeNumber: true,
          versionInfo: true,
          availabilityStatus: true,
          lastVerifiedAt: true,
          provider: {
            select: {
              id: true,
              name: true,
              country: true,
              isActive: true,
              displayOrder: true,
              isDefault: true,
              lastCatalogUpdatedAt: true
            }
          }
        },
        orderBy: [
          { providerId: "asc" as const },
          { availabilityStatus: "asc" as const },
          { versionInfo: "asc" as const },
          { karaokeNumber: "asc" as const },
          { id: "asc" as const }
        ]
      }
    }
  }
} satisfies Prisma.FavoriteSelect;

export function createPrismaFavoriteRepository(
  prisma: FavoritePrismaClient
): FavoriteRepository {
  return {
    async listPage({ owner, cursor, take }) {
      const records = await prisma.favorite.findMany({
        where: {
          userId: owner.userId
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(cursor === undefined
          ? {}
          : {
              cursor: {
                id: cursor.id,
                userId: owner.userId
              },
              skip: 1
            }),
        take,
        select: favoriteCardSelection
      });

      return records as FavoriteListRecord[];
    },

    async add(identity) {
      if (!(await songExists(prisma, identity.songId))) {
        return { status: "song_not_found" };
      }

      try {
        const favorite = await upsertFavorite(prisma, identity);
        return { status: "ok", favorite };
      } catch (error) {
        if (isPrismaError(error, "P2002")) {
          const favorite = await findFavorite(prisma, identity);
          if (favorite !== null) {
            return { status: "ok", favorite };
          }
        }

        if (
          isPrismaError(error, "P2003") &&
          !(await songExists(prisma, identity.songId))
        ) {
          return { status: "song_not_found" };
        }

        throw error;
      }
    },

    async delete(identity) {
      await prisma.favorite.deleteMany({
        where: {
          userId: identity.userId,
          songId: identity.songId
        }
      });
    }
  };
}

function songExists(
  prisma: FavoritePrismaClient,
  songId: string
): Promise<boolean> {
  return prisma.song
    .findUnique({ where: { id: songId }, select: { id: true } })
    .then((song) => song !== null);
}

function upsertFavorite(
  prisma: FavoritePrismaClient,
  identity: FavoriteIdentity
) {
  return prisma.favorite.upsert({
    where: {
      userId_songId: {
        userId: identity.userId,
        songId: identity.songId
      }
    },
    create: {
      userId: identity.userId,
      songId: identity.songId
    },
    update: {},
    select: { createdAt: true }
  });
}

function findFavorite(
  prisma: FavoritePrismaClient,
  identity: FavoriteIdentity
) {
  return prisma.favorite.findUnique({
    where: {
      userId_songId: {
        userId: identity.userId,
        songId: identity.songId
      }
    },
    select: { createdAt: true }
  });
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
