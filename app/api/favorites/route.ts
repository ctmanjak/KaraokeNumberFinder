import { getPrismaClient } from "@/lib/db/prisma";
import { createPrismaFavoriteRepository } from "@/lib/favorites/repository";
import { createFavoritesGetHandler } from "@/lib/favorites/route-handler";
import { createFavoriteService } from "@/lib/favorites/service";
import { createServerPersonalizationHandler } from "@/lib/personalization/server";

type FavoriteService = ReturnType<typeof createFavoriteService>;

let service: FavoriteService | undefined;

export const GET = createServerPersonalizationHandler((context) =>
  createFavoritesGetHandler(getFavoriteService())(context)
);

function getFavoriteService(): FavoriteService {
  service ??= createFavoriteService(
    createPrismaFavoriteRepository(getPrismaClient())
  );
  return service;
}
