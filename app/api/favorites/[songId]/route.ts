import { getPrismaClient } from "@/lib/db/prisma";
import { createPrismaFavoriteRepository } from "@/lib/favorites/repository";
import {
  createFavoriteDeleteHandler,
  createFavoritePutHandler
} from "@/lib/favorites/route-handler";
import { createFavoriteService } from "@/lib/favorites/service";
import { createServerPersonalizationHandler } from "@/lib/personalization/server";

type FavoriteService = ReturnType<typeof createFavoriteService>;

let service: FavoriteService | undefined;

export const PUT = createServerPersonalizationHandler((context) =>
  createFavoritePutHandler(getFavoriteService())(context)
);

export const DELETE = createServerPersonalizationHandler((context) =>
  createFavoriteDeleteHandler(getFavoriteService())(context)
);

function getFavoriteService(): FavoriteService {
  service ??= createFavoriteService(
    createPrismaFavoriteRepository(getPrismaClient())
  );
  return service;
}
