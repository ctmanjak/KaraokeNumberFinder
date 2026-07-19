import "server-only";

import { getPrismaClient } from "../db/prisma";
import { createPrismaSearchHistoryRepository } from "./repository";
import { createSearchHistoryService } from "./service";

type SearchHistoryService = ReturnType<typeof createSearchHistoryService>;

let service: SearchHistoryService | undefined;

export function getSearchHistoryService(): SearchHistoryService {
  service ??= createSearchHistoryService(
    createPrismaSearchHistoryRepository(getPrismaClient())
  );
  return service;
}
