import "server-only";

import { getPrismaClient } from "../db/prisma";
import { createPrismaFavoriteRepository } from "./repository";
import { createFavoriteService } from "./service";

type FavoriteService = ReturnType<typeof createFavoriteService>;

let service: FavoriteService | undefined;

export function getFavoriteService(): FavoriteService {
  service ??= createFavoriteService(
    createPrismaFavoriteRepository(getPrismaClient())
  );
  return service;
}
