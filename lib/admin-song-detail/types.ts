import type {
  AdminAvailabilityStatus,
  AdminEditableAliasType
} from "../admin-song/types";
import type { CandidateSummary } from "../admin-song-duplicate/types";

export type AdminSongSystemAlias = Readonly<{
  id: string;
  alias: string;
  language: string;
  alias_type: "canonical_title" | "display_title" | "artist";
  updated_at: string;
}>;

export type AdminSongEditableAlias = Readonly<{
  id: string;
  alias: string;
  language: string;
  alias_type: AdminEditableAliasType;
  source_name: string | null;
  source_url: string | null;
  verification_note: string | null;
  updated_at: string;
}>;

export type AdminSongDetailEntry = Readonly<{
  id: string;
  provider_id: string;
  provider_name: string;
  provider_country: string;
  karaoke_number: string;
  version_info: string;
  availability_status: AdminAvailabilityStatus;
  last_verified_at: string | null;
  source_name: string;
  source_url: string | null;
  verification_note: string | null;
  updated_at: string;
}>;

export type AdminSongDetail = Readonly<{
  song: {
    id: string;
    original_language: string;
    canonical_title: string;
    display_title: string;
    canonical_artist: string;
    release_year: number | null;
    tie_in: string | null;
    source_name: string | null;
    source_url: string | null;
    verification_note: string | null;
    updated_at: string;
  };
  system_aliases: readonly AdminSongSystemAlias[];
  aliases: readonly AdminSongEditableAlias[];
  karaoke_entries: readonly AdminSongDetailEntry[];
  limits: {
    aliases: number;
    karaoke_entries: number;
  };
}>;

export type AdminSongPatchAliasInput = Readonly<{
  id?: string;
  alias: string;
  language: string;
  alias_type: AdminEditableAliasType;
  source_name?: string | null;
  source_url?: string | null;
  verification_note?: string | null;
}>;

export type AdminSongPatchEntryInput = Readonly<{
  id?: string;
  provider_id: string;
  karaoke_number: string;
  version_info: string;
  availability_status: AdminAvailabilityStatus;
  last_verified_at?: string | null;
  source_name?: string;
  source_url?: string | null;
  verification_note?: string | null;
}>;

export type AdminSongPatchInput = Readonly<{
  expected_updated_at: string;
  song: {
    original_language: string;
    canonical_title: string;
    display_title: string;
    canonical_artist: string;
    release_year: number | null;
    tie_in: string | null;
    source_name?: string | null;
    source_url?: string | null;
    verification_note?: string | null;
  };
  aliases: readonly AdminSongPatchAliasInput[];
  karaoke_entries: readonly AdminSongPatchEntryInput[];
  possible_duplicate_acknowledged_song_ids: readonly string[];
}>;

export type AdminSongUpdateCounts = Readonly<{
  song_fields: number;
  aliases_added: number;
  aliases_updated: number;
  aliases_deleted: number;
  karaoke_entries_added: number;
  karaoke_entries_updated: number;
}>;

export type AdminSongPatchResult = Readonly<{
  detail: AdminSongDetail;
  change_counts: AdminSongUpdateCounts;
}>;

export type AdminSongDuplicateConflict = Readonly<{
  candidates: readonly CandidateSummary[];
}>;

export const ADMIN_SONG_MAX_ALIASES = 30;
export const ADMIN_SONG_MAX_ENTRIES = 20;
export const ADMIN_SONG_PATCH_BODY_LIMIT_BYTES = 524_288;
