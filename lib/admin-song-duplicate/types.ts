import type { AliasType } from "../generated/prisma/client";

export type AliasCandidateRole = "title" | "artist" | "excluded";

export const ALIAS_CANDIDATE_ROLE = {
  canonical_title: "title",
  display_title: "title",
  artist: "artist",
  romanized_title: "title",
  english_title: "title",
  translated_title: "title",
  content: "excluded",
  abbreviation: "title",
  common_name: "title",
  alternate_spelling: "title"
} as const satisfies Record<AliasType, AliasCandidateRole>;

export type DuplicateMatchStrength = "exact" | "prefix" | "partial";

export type CandidateMatchEvidence = Readonly<{
  role: "title" | "artist";
  strength: DuplicateMatchStrength;
  input_field: "canonical_title" | "display_title" | "canonical_artist";
  candidate_field: string;
  matched_value: string;
}>;

export type CandidateSummary = Readonly<{
  id: string;
  display_title: string;
  canonical_title: string;
  canonical_artist: string;
  original_language: string;
  release_year: number | null;
  tie_in: string | null;
  provider_summary: ReadonlyArray<{
    provider_id: string;
    provider_name: string;
    karaoke_number: string;
    version_info: string;
  }>;
  match_evidence: readonly CandidateMatchEvidence[];
  admin_path: string;
}>;

export type DuplicateCheckInput = Readonly<{
  canonical_title: string;
  display_title?: string;
  canonical_artist: string;
  exclude_song_id?: string;
}>;

export type DuplicateCheckResult = Readonly<{
  classification: "exact" | "possible" | "none";
  candidates: readonly CandidateSummary[];
}>;

export const DUPLICATE_CANDIDATE_LIMIT = 5;
export const DUPLICATE_STATEMENT_TIMEOUT_MS = 1_000;
