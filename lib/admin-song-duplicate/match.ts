import { normalizeSearchText } from "../search/normalize";
import { normalizeSongIdentity } from "../song-identity/normalize";
import type { DuplicateCheckInput, DuplicateMatchStrength } from "./types";

export type NormalizedDuplicateInput = Readonly<{
  canonicalTitle: string;
  canonicalArtist: string;
  titles: ReadonlyArray<{
    value: string;
    inputField: "canonical_title" | "display_title";
  }>;
}>;

export function normalizeDuplicateInput(
  input: DuplicateCheckInput
): NormalizedDuplicateInput {
  const identity = normalizeSongIdentity(input);
  const titles: Array<NormalizedDuplicateInput["titles"][number]> = [
    {
      value: identity.normalizedCanonicalTitle,
      inputField: "canonical_title"
    }
  ];
  const display = normalizeSearchText(input.display_title ?? "");
  if (display !== "" && display !== identity.normalizedCanonicalTitle) {
    titles.push({ value: display, inputField: "display_title" });
  }
  return {
    canonicalTitle: identity.normalizedCanonicalTitle,
    canonicalArtist: identity.normalizedCanonicalArtist,
    titles
  };
}

export function duplicateMatchStrength(
  normalizedCandidate: string,
  normalizedInput: string
): DuplicateMatchStrength | null {
  if (normalizedCandidate === normalizedInput) return "exact";
  if (Array.from(normalizedInput).length < 2) return null;
  if (normalizedCandidate.startsWith(normalizedInput)) return "prefix";
  if (normalizedCandidate.includes(normalizedInput)) return "partial";
  return null;
}

export function assertAliasCandidateRoleMapComplete(
  aliasTypes: readonly string[],
  mapping: Readonly<Record<string, string>>
): void {
  const missing = aliasTypes.filter(
    (aliasType) =>
      mapping[aliasType] !== "title" &&
      mapping[aliasType] !== "artist" &&
      mapping[aliasType] !== "excluded"
  );
  if (missing.length > 0) {
    throw new Error(`Unmapped AliasType values: ${missing.join(", ")}`);
  }
}
