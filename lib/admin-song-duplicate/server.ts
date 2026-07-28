import "server-only";

import { getPrismaClient } from "../db/prisma";
import { createAdminSongDuplicateService } from "./service";

let service: ReturnType<typeof createAdminSongDuplicateService> | undefined;

export function getAdminSongDuplicateService() {
  service ??= createAdminSongDuplicateService(getPrismaClient());
  return service;
}
