import type { PrismaClient } from "../generated/prisma/client";
import { personalizationDomainError } from "../personalization";
import {
  DuplicateCheckRepositoryError,
  findDuplicateCandidates
} from "./repository";
import type { DuplicateCheckInput } from "./types";

export type AdminSongDuplicateService = ReturnType<
  typeof createAdminSongDuplicateService
>;

export function createAdminSongDuplicateService(db: PrismaClient) {
  return {
    async check(input: DuplicateCheckInput) {
      try {
        return await findDuplicateCandidates(db, input);
      } catch (error) {
        if (
          error instanceof DuplicateCheckRepositoryError &&
          error.code === "TIMEOUT"
        ) {
          throw personalizationDomainError({
            code: "DUPLICATE_CHECK_UNAVAILABLE",
            status: 503,
            publicMessage: "Duplicate checking is temporarily unavailable."
          });
        }
        throw error;
      }
    }
  };
}
