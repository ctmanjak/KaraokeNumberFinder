import { normalizeSearchText } from "../search/normalize";

export const SONG_IDENTITY_MAX_LENGTH = 512;

export type SongIdentity = Readonly<{
  normalizedCanonicalTitle: string;
  normalizedCanonicalArtist: string;
}>;

export type SongIdentityField = "canonical_title" | "canonical_artist";

export class SongIdentityValidationError extends Error {
  constructor(
    readonly field: SongIdentityField,
    readonly reason: "empty_after_normalization" | "too_long"
  ) {
    super(`${field}:${reason}`);
    this.name = "SongIdentityValidationError";
  }
}

export function normalizeSongIdentity(
  input: Readonly<{
    canonical_title: string;
    canonical_artist: string;
  }>
): SongIdentity {
  const normalizedCanonicalTitle = normalizeIdentityField(
    input.canonical_title,
    "canonical_title"
  );
  const normalizedCanonicalArtist = normalizeIdentityField(
    input.canonical_artist,
    "canonical_artist"
  );

  return { normalizedCanonicalTitle, normalizedCanonicalArtist };
}

function normalizeIdentityField(raw: string, field: SongIdentityField): string {
  const normalized = normalizeSearchText(raw);
  if (normalized === "") {
    throw new SongIdentityValidationError(field, "empty_after_normalization");
  }
  if (Array.from(normalized).length > SONG_IDENTITY_MAX_LENGTH) {
    throw new SongIdentityValidationError(field, "too_long");
  }
  return normalized;
}
