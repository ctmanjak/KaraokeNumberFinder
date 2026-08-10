import { adminSongValidationError } from "../admin-song/validation";
import {
  normalizeSongIdentity,
  SongIdentityValidationError
} from "../song-identity/normalize";
import type { DuplicateCheckInput } from "./types";

const SONG_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

export function parseAdminSongId(value: unknown, path = "song_id"): string {
  if (typeof value !== "string" || !SONG_ID_PATTERN.test(value)) {
    throw adminSongValidationError(path);
  }
  return value;
}

export function parseDuplicateCheckInput(value: unknown): DuplicateCheckInput {
  const input = requireRecord(value);
  requireAllowedKeys(input, [
    "canonical_title",
    "display_title",
    "canonical_artist",
    "exclude_song_id"
  ]);
  if (
    !Object.hasOwn(input, "canonical_title") ||
    !Object.hasOwn(input, "canonical_artist")
  ) {
    throw adminSongValidationError(
      !Object.hasOwn(input, "canonical_title")
        ? "canonical_title"
        : "canonical_artist",
      "Required field."
    );
  }
  const canonicalTitle = stringValue(
    input.canonical_title,
    "canonical_title",
    512
  );
  const canonicalArtist = stringValue(
    input.canonical_artist,
    "canonical_artist",
    512
  );
  const displayTitle =
    input.display_title === undefined
      ? undefined
      : stringValue(input.display_title, "display_title", 512);
  const excludeSongId =
    input.exclude_song_id === undefined
      ? undefined
      : parseAdminSongId(input.exclude_song_id, "exclude_song_id");
  try {
    normalizeSongIdentity({
      canonical_title: canonicalTitle,
      canonical_artist: canonicalArtist
    });
  } catch (error) {
    if (error instanceof SongIdentityValidationError) {
      throw adminSongValidationError(error.field);
    }
    throw error;
  }
  return {
    canonical_title: canonicalTitle,
    canonical_artist: canonicalArtist,
    ...(displayTitle === undefined ? {} : { display_title: displayTitle }),
    ...(excludeSongId === undefined ? {} : { exclude_song_id: excludeSongId })
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw adminSongValidationError("body");
  }
  return value as Record<string, unknown>;
}

function requireAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[]
): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown !== undefined) {
    throw adminSongValidationError(unknown, "Unknown field.");
  }
}

function stringValue(value: unknown, path: string, max: number): string {
  if (typeof value !== "string") throw adminSongValidationError(path);
  const trimmed = value.trim();
  if (trimmed === "" || Array.from(trimmed).length > max) {
    throw adminSongValidationError(path, "Invalid string.", { max });
  }
  return trimmed;
}
