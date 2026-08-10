const NORMALIZED_IDENTITY_CONSTRAINT =
  "songs_normalized_canonical_title_artist_key";

export function isNormalizedIdentityUniqueViolation(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "P2002"
  ) {
    return false;
  }
  const serialized = JSON.stringify(
    "meta" in error && error.meta !== undefined ? error.meta : {}
  );
  if (serialized.includes(NORMALIZED_IDENTITY_CONSTRAINT)) return true;
  return (
    containsAny(serialized, [
      "normalizedCanonicalTitle",
      "normalized_canonical_title"
    ]) &&
    containsAny(serialized, [
      "normalizedCanonicalArtist",
      "normalized_canonical_artist"
    ])
  );
}

function containsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}
