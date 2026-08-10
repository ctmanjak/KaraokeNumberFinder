import {
  personalizationError,
  personalizationDomainError
} from "../personalization";
import {
  AdminSongRepositoryError,
  type AdminSongRepository
} from "./repository";
import { encodeAdminSongCursor } from "./cursor";
import type { AdminSongListQuery } from "./list-contract";
import {
  ADMIN_EDITABLE_ALIAS_TYPES,
  ADMIN_AVAILABILITY_STATUSES,
  type AdminSongInput
} from "./types";

export type AdminSongService = ReturnType<typeof createAdminSongService>;

export function createAdminSongService(repository: AdminSongRepository) {
  return {
    async getOptions(userId: string) {
      try {
        return {
          alias_types: ADMIN_EDITABLE_ALIAS_TYPES,
          availability_statuses: ADMIN_AVAILABILITY_STATUSES,
          providers: await repository.getOptions(userId)
        };
      } catch (error) {
        mapRepositoryError(error);
      }
    },

    async list(userId: string, query: AdminSongListQuery) {
      try {
        const result = await repository.list(userId, query);
        return {
          items: result.items,
          next_cursor:
            result.nextCursorKey === null
              ? null
              : encodeAdminSongCursor(
                  result.nextCursorKey,
                  query.normalizedQuery
                )
        };
      } catch (error) {
        mapRepositoryError(error);
      }
    },

    async create(userId: string, input: AdminSongInput) {
      try {
        return await repository.create(userId, input);
      } catch (error) {
        mapRepositoryError(error);
      }
    }
  };
}

function mapRepositoryError(error: unknown): never {
  if (!(error instanceof AdminSongRepositoryError)) {
    throw error;
  }
  if (error.code === "FORBIDDEN") {
    throw personalizationError("FORBIDDEN");
  }
  if (error.code === "PROVIDER_NOT_FOUND") {
    throw personalizationDomainError({
      code: "PROVIDER_NOT_FOUND",
      status: 422,
      publicMessage: "A selected karaoke provider is unavailable."
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
  if (error.code === "DUPLICATE_CHECK_TIMEOUT") {
    throw personalizationDomainError({
      code: "DUPLICATE_CHECK_UNAVAILABLE",
      status: 503,
      publicMessage: "Duplicate checking is temporarily unavailable."
    });
  }
  throw personalizationDomainError({
    code: "SONG_CONFLICT",
    status: 409,
    publicMessage: "The song could not be created because the catalog changed."
  });
}
