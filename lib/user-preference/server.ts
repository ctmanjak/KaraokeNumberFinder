import "server-only";

import { getPrismaClient } from "../db/prisma";
import { createPrismaUserPreferenceRepository } from "./repository";
import { createUserPreferenceService } from "./service";

type UserPreferenceService = ReturnType<typeof createUserPreferenceService>;

let service: UserPreferenceService | undefined;

export function getUserPreferenceService(): UserPreferenceService {
  service ??= createUserPreferenceService(
    createPrismaUserPreferenceRepository(getPrismaClient())
  );
  return service;
}
