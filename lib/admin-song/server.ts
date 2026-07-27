import "server-only";

import { getPrismaClient } from "../db/prisma";
import { createPrismaAdminSongRepository } from "./repository";
import { createAdminSongService } from "./service";

type Service = ReturnType<typeof createAdminSongService>;

let service: Service | undefined;

export function getAdminSongService(): Service {
  service ??= createAdminSongService(
    createPrismaAdminSongRepository(getPrismaClient())
  );
  return service;
}
