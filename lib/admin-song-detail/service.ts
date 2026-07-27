import {
  personalizationDomainError,
  personalizationError
} from "../personalization";
import {
  AdminSongDetailRepositoryError,
  type AdminSongDetailRepository
} from "./repository";
import type { AdminSongPatchInput } from "./types";

export type AdminSongDetailService = ReturnType<
  typeof createAdminSongDetailService
>;

export function createAdminSongDetailService(
  repository: AdminSongDetailRepository
) {
  return {
    async get(userId: string, songId: string) {
      try {
        return await repository.get(userId, songId);
      } catch (error) {
        mapRepositoryError(error);
      }
    },

    async update(userId: string, songId: string, input: AdminSongPatchInput) {
      try {
        return await repository.update(userId, songId, input);
      } catch (error) {
        mapRepositoryError(error);
      }
    }
  };
}

function mapRepositoryError(error: unknown): never {
  if (!(error instanceof AdminSongDetailRepositoryError)) throw error;
  if (error.code === "FORBIDDEN") throw personalizationError("FORBIDDEN");
  if (error.code === "NOT_FOUND") {
    throw personalizationDomainError({
      code: "SONG_NOT_FOUND",
      status: 404,
      publicMessage: "Song was not found."
    });
  }
  if (error.code === "STALE") {
    throw personalizationDomainError({
      code: "STALE_SONG",
      status: 409,
      publicMessage: "The song changed after it was loaded."
    });
  }
  if (error.code === "DUPLICATE_SONG") {
    throw personalizationDomainError({
      code: "DUPLICATE_SONG",
      status: 409,
      publicMessage:
        "A song with the same canonical title and artist already exists.",
      details: { candidates: error.candidates }
    });
  }
  if (error.code === "POSSIBLE_DUPLICATE_CONFIRMATION_REQUIRED") {
    throw personalizationDomainError({
      code: "POSSIBLE_DUPLICATE_CONFIRMATION_REQUIRED",
      status: 409,
      publicMessage:
        "The current possible duplicate candidates must be confirmed.",
      details: { candidates: error.candidates }
    });
  }
  if (error.code === "PROVIDER_NOT_FOUND") {
    throw personalizationDomainError({
      code: "PROVIDER_NOT_FOUND",
      status: 422,
      publicMessage: "A selected karaoke provider is unavailable.",
      details: {
        issues: [
          {
            path: "karaoke_entries",
            message: "A selected provider is unavailable."
          }
        ]
      }
    });
  }
  if (error.code === "TIMEOUT") {
    throw personalizationDomainError({
      code: "DUPLICATE_CHECK_UNAVAILABLE",
      status: 503,
      publicMessage: "Duplicate checking is temporarily unavailable."
    });
  }
  if (error.code === "SYSTEM_ALIAS_INVARIANT") {
    throw personalizationDomainError({
      code: "CATALOG_INVARIANT_VIOLATION",
      status: 409,
      publicMessage: "The song requires catalog data repair before editing."
    });
  }
  throw personalizationDomainError({
    code: "SONG_CONFLICT",
    status: 409,
    publicMessage: "The song could not be updated because the catalog changed."
  });
}
