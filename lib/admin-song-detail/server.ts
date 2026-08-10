import "server-only";

import { getPrismaClient } from "../db/prisma";
import { createPrismaAdminSongDetailRepository } from "./repository";
import { createAdminSongDetailService } from "./service";

let service: ReturnType<typeof createAdminSongDetailService> | undefined;

export function getAdminSongDetailService() {
  service ??= createAdminSongDetailService(
    createPrismaAdminSongDetailRepository(getPrismaClient())
  );
  return service;
}
