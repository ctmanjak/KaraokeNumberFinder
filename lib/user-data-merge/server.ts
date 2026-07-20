import "server-only";

import { getPrismaClient } from "../db/prisma";
import { createPrismaUserDataMergeRepository } from "./repository";
import { createUserDataMergeService } from "./service";

type UserDataMergeService = ReturnType<typeof createUserDataMergeService>;

let service: UserDataMergeService | undefined;

export function getUserDataMergeService(): UserDataMergeService {
  service ??= createUserDataMergeService(
    createPrismaUserDataMergeRepository(getPrismaClient())
  );
  return service;
}
