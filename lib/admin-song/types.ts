export const ADMIN_ALIAS_TYPES = [
  "canonical_title",
  "display_title",
  "artist",
  "romanized_title",
  "english_title",
  "translated_title",
  "content",
  "abbreviation",
  "common_name",
  "alternate_spelling"
] as const;

export type AdminAliasType = (typeof ADMIN_ALIAS_TYPES)[number];

export const ADMIN_SYSTEM_ALIAS_TYPES = [
  "canonical_title",
  "display_title",
  "artist"
] as const;

type AdminSystemAliasType = (typeof ADMIN_SYSTEM_ALIAS_TYPES)[number];

export type AdminEditableAliasType = Exclude<
  AdminAliasType,
  AdminSystemAliasType
>;

export const ADMIN_EDITABLE_ALIAS_TYPES: readonly AdminEditableAliasType[] =
  ADMIN_ALIAS_TYPES.filter(
    (aliasType): aliasType is AdminEditableAliasType =>
      !(ADMIN_SYSTEM_ALIAS_TYPES as readonly AdminAliasType[]).includes(
        aliasType
      )
  );

export const ADMIN_AVAILABILITY_STATUSES = [
  "available",
  "not_available",
  "temporarily_unavailable",
  "unknown"
] as const;

export type AdminAvailabilityStatus =
  (typeof ADMIN_AVAILABILITY_STATUSES)[number];

export type AdminSongAliasInput = Readonly<{
  alias: string;
  language: string;
  alias_type: AdminEditableAliasType;
}>;

export type AdminKaraokeEntryInput = Readonly<{
  provider_id: string;
  karaoke_number: string;
  version_info: string;
  availability_status: AdminAvailabilityStatus;
  last_verified_at: string | null;
}>;

export type AdminSongInput = Readonly<{
  original_language: string;
  canonical_title: string;
  display_title: string;
  canonical_artist: string;
  release_year: number | null;
  tie_in: string | null;
  source_url: string | null;
  source_name: string;
  verification_note: string | null;
  aliases: readonly AdminSongAliasInput[];
  karaoke_entries: readonly AdminKaraokeEntryInput[];
}>;

export type AdminSongOptions = Readonly<{
  alias_types: readonly AdminEditableAliasType[];
  availability_statuses: readonly AdminAvailabilityStatus[];
  providers: ReadonlyArray<{
    id: string;
    name: string;
    country: string;
  }>;
}>;

export type AdminSongCreateResult = Readonly<{
  song: {
    id: string;
    display_title: string;
    canonical_artist: string;
  };
  alias_count: number;
  karaoke_entry_count: number;
}>;

export type {
  AdminSongListItem,
  AdminSongListQuery,
  AdminSongListResponse,
  AdminSongProviderSummary
} from "./list-contract";
