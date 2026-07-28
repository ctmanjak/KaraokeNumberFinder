import { buildAliasSearchFields } from "../search/normalize";
import { parseAdminSongId } from "../admin-song-duplicate/input";
import {
  normalizeSongIdentity,
  SongIdentityValidationError
} from "../song-identity/normalize";
import {
  ADMIN_EDITABLE_ALIAS_TYPES,
  ADMIN_AVAILABILITY_STATUSES,
  ADMIN_SONG_MAX_ALIASES,
  ADMIN_SONG_MAX_ENTRIES,
  type AdminAliasType,
  type AdminEditableAliasType,
  type AdminAvailabilityStatus,
  type AdminSongInput
} from "./types";
import { adminSongValidationError } from "./validation";

const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export function parseAdminSongInput(
  value: unknown,
  currentDate: Date = new Date()
): AdminSongInput {
  const input = record(value, "body");
  const requiredKeys = [
    "original_language",
    "canonical_title",
    "display_title",
    "canonical_artist",
    "release_year",
    "tie_in",
    "source_url",
    "source_name",
    "aliases",
    "karaoke_entries"
  ] as const;
  allowedKeys(input, [
    ...requiredKeys,
    "possible_duplicate_acknowledged_song_ids"
  ]);
  for (const key of requiredKeys) {
    if (!Object.hasOwn(input, key)) {
      throw adminSongValidationError(key, "Required field.");
    }
  }

  const originalLanguage = requiredString(
    input.original_language,
    "original_language",
    16,
    LANGUAGE_PATTERN
  );
  const canonicalTitle = requiredString(
    input.canonical_title,
    "canonical_title",
    512
  );
  const displayTitle = requiredString(
    input.display_title,
    "display_title",
    512
  );
  const canonicalArtist = requiredString(
    input.canonical_artist,
    "canonical_artist",
    512
  );
  const sourceName = requiredString(input.source_name, "source_name", 256);
  assertIdentity(canonicalTitle, canonicalArtist);

  const aliases = array(input.aliases, "aliases", ADMIN_SONG_MAX_ALIASES).map(
    (alias, index) => parseAlias(alias, index)
  );
  const karaokeEntries = array(
    input.karaoke_entries,
    "karaoke_entries",
    ADMIN_SONG_MAX_ENTRIES,
    true
  ).map((entry, index) => parseEntry(entry, index));
  const acknowledged =
    input.possible_duplicate_acknowledged_song_ids === undefined
      ? undefined
      : array(
          input.possible_duplicate_acknowledged_song_ids,
          "possible_duplicate_acknowledged_song_ids",
          5
        ).map((id, index) =>
          parseAdminSongId(
            id,
            `possible_duplicate_acknowledged_song_ids.${index}`
          )
        );
  if (
    acknowledged !== undefined &&
    new Set(acknowledged).size !== acknowledged.length
  ) {
    throw adminSongValidationError(
      "possible_duplicate_acknowledged_song_ids",
      "Candidate IDs must be unique.",
      { max: 5 }
    );
  }

  const parsed: AdminSongInput = {
    original_language: originalLanguage,
    canonical_title: canonicalTitle,
    display_title: displayTitle,
    canonical_artist: canonicalArtist,
    release_year: nullableYear(input.release_year, "release_year"),
    tie_in: nullableString(input.tie_in, "tie_in", 512),
    source_url: nullableUrl(input.source_url, "source_url"),
    source_name: sourceName,
    aliases,
    karaoke_entries: karaokeEntries,
    ...(acknowledged === undefined
      ? {}
      : { possible_duplicate_acknowledged_song_ids: acknowledged })
  };
  validateAdminSongCreateAggregate(parsed, currentDate);
  return parsed;
}

export function validateAdminSongCreateAggregate(
  input: AdminSongInput,
  currentDate: Date
): void {
  assertIdentity(input.canonical_title, input.canonical_artist);
  if (input.aliases.length > ADMIN_SONG_MAX_ALIASES) {
    throw adminSongValidationError("aliases", "Too many items.", {
      max: ADMIN_SONG_MAX_ALIASES
    });
  }
  if (
    input.karaoke_entries.length === 0 ||
    input.karaoke_entries.length > ADMIN_SONG_MAX_ENTRIES
  ) {
    throw adminSongValidationError(
      "karaoke_entries",
      input.karaoke_entries.length === 0
        ? "At least one item is required."
        : "Too many items.",
      { max: ADMIN_SONG_MAX_ENTRIES }
    );
  }
  if (
    input.possible_duplicate_acknowledged_song_ids !== undefined &&
    (input.possible_duplicate_acknowledged_song_ids.length > 5 ||
      new Set(input.possible_duplicate_acknowledged_song_ids).size !==
        input.possible_duplicate_acknowledged_song_ids.length)
  ) {
    throw adminSongValidationError(
      "possible_duplicate_acknowledged_song_ids",
      "Candidate IDs must be unique.",
      { max: 5 }
    );
  }

  rejectDuplicateAliases(
    [input.canonical_title, input.display_title, input.canonical_artist],
    input.aliases
  );
  rejectDuplicateEntries(input.karaoke_entries);

  const today = currentDate.toISOString().slice(0, 10);
  for (const [index, entry] of input.karaoke_entries.entries()) {
    const path = `karaoke_entries.${index}`;
    if (entry.source_name.trim() === "") {
      throw adminSongValidationError(
        `${path}.source_name`,
        "Source name is required."
      );
    }
    if (entry.last_verified_at !== null && entry.last_verified_at > today) {
      throw adminSongValidationError(`${path}.last_verified_at`);
    }
    if (
      entry.availability_status !== "unknown" &&
      entry.last_verified_at === null
    ) {
      throw adminSongValidationError(
        `${path}.last_verified_at`,
        "A confirmed status requires a verified date."
      );
    }
    if (
      entry.availability_status === "available" &&
      entry.karaoke_number === ""
    ) {
      throw adminSongValidationError(`${path}.karaoke_number`);
    }
    if (
      entry.availability_status !== "available" &&
      entry.karaoke_number !== ""
    ) {
      throw adminSongValidationError(`${path}.karaoke_number`);
    }
    if (
      (entry.availability_status === "not_available" ||
        entry.availability_status === "temporarily_unavailable") &&
      (entry.verification_note === null ||
        entry.verification_note.trim() === "")
    ) {
      throw adminSongValidationError(
        `${path}.verification_note`,
        "This status requires a verification note."
      );
    }
  }
}

function parseAlias(value: unknown, index: number) {
  const path = `aliases.${index}`;
  const alias = record(value, path);
  exactKeys(alias, [
    "alias",
    "language",
    "alias_type",
    "source_name",
    "source_url"
  ]);
  const aliasType = requiredString(alias.alias_type, `${path}.alias_type`, 64);
  if (!(ADMIN_EDITABLE_ALIAS_TYPES as readonly string[]).includes(aliasType)) {
    throw adminSongValidationError(`${path}.alias_type`);
  }

  return {
    alias: requiredString(alias.alias, `${path}.alias`, 512),
    language: requiredString(
      alias.language,
      `${path}.language`,
      16,
      LANGUAGE_PATTERN
    ),
    alias_type: aliasType as AdminEditableAliasType,
    source_name: nullableString(alias.source_name, `${path}.source_name`, 256),
    source_url: nullableUrl(alias.source_url, `${path}.source_url`)
  };
}

function parseEntry(value: unknown, index: number) {
  const path = `karaoke_entries.${index}`;
  const entry = record(value, path);
  exactKeys(entry, [
    "provider_id",
    "karaoke_number",
    "version_info",
    "availability_status",
    "last_verified_at",
    "source_name",
    "source_url",
    "verification_note"
  ]);
  const status = requiredString(
    entry.availability_status,
    `${path}.availability_status`,
    64
  );
  if (!(ADMIN_AVAILABILITY_STATUSES as readonly string[]).includes(status)) {
    throw adminSongValidationError(`${path}.availability_status`);
  }

  return {
    provider_id: parseAdminSongId(entry.provider_id, `${path}.provider_id`),
    karaoke_number: requiredString(
      entry.karaoke_number,
      `${path}.karaoke_number`,
      64,
      undefined,
      true
    ),
    version_info: requiredString(
      entry.version_info,
      `${path}.version_info`,
      256,
      undefined,
      true
    ),
    availability_status: status as AdminAvailabilityStatus,
    last_verified_at: nullableDate(
      entry.last_verified_at,
      `${path}.last_verified_at`
    ),
    source_name: requiredString(entry.source_name, `${path}.source_name`, 256),
    source_url: nullableUrl(entry.source_url, `${path}.source_url`),
    verification_note: nullableString(
      entry.verification_note,
      `${path}.verification_note`,
      4_000
    )
  };
}

function assertIdentity(canonicalTitle: string, canonicalArtist: string): void {
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
}

function rejectDuplicateAliases(
  systemAliases: readonly string[],
  aliases: ReadonlyArray<{
    alias: string;
    alias_type: AdminAliasType;
  }>
): void {
  const normalized = new Set<string>();
  for (const alias of systemAliases) {
    const value = buildAliasSearchFields(alias).normalizedAlias;
    if (value === "") throw adminSongValidationError("aliases");
    normalized.add(value);
  }
  for (const [index, alias] of aliases.entries()) {
    const value = buildAliasSearchFields(alias.alias).normalizedAlias;
    if (value === "" || normalized.has(value)) {
      throw adminSongValidationError(
        `aliases.${index}.alias`,
        "Alias duplicates a system or administrator alias."
      );
    }
    normalized.add(value);
  }
}

function rejectDuplicateEntries(
  entries: AdminSongInput["karaoke_entries"]
): void {
  const keys = new Set<string>();
  for (const entry of entries) {
    const key = [
      entry.provider_id,
      entry.version_info,
      entry.karaoke_number
    ].join("\u0000");
    if (keys.has(key)) {
      throw adminSongValidationError(
        "karaoke_entries",
        "Duplicate provider entry."
      );
    }
    keys.add(key);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw adminSongValidationError(path);
  }
  return value as Record<string, unknown>;
}

function array(
  value: unknown,
  path: string,
  max: number,
  requireItem = false
): unknown[] {
  if (!Array.isArray(value)) throw adminSongValidationError(path);
  if (value.length > max) {
    throw adminSongValidationError(path, "Too many items.", { max });
  }
  if (requireItem && value.length === 0) {
    throw adminSongValidationError(path, "At least one item is required.");
  }
  return value;
}

function exactKeys(
  input: Record<string, unknown>,
  keys: readonly string[]
): void {
  allowedKeys(input, keys);
  const missing = keys.find((key) => !Object.hasOwn(input, key));
  if (missing !== undefined) {
    throw adminSongValidationError(missing, "Required field.");
  }
}

function allowedKeys(
  input: Record<string, unknown>,
  keys: readonly string[]
): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown !== undefined) {
    throw adminSongValidationError(unknown, "Unknown field.");
  }
}

function requiredString(
  value: unknown,
  path: string,
  max: number,
  pattern?: RegExp,
  allowEmpty = false
): string {
  if (typeof value !== "string") throw adminSongValidationError(path);
  const trimmed = value.trim();
  if (
    (!allowEmpty && trimmed === "") ||
    Array.from(trimmed).length > max ||
    (pattern !== undefined && !pattern.test(trimmed))
  ) {
    throw adminSongValidationError(path, "Invalid string.", { max });
  }
  return trimmed;
}

function nullableString(
  value: unknown,
  path: string,
  max: number
): string | null {
  if (value === null) return null;
  const string = requiredString(value, path, max, undefined, true);
  return string === "" ? null : string;
}

function nullableUrl(value: unknown, path: string): string | null {
  const normalized = nullableString(value, path, 2_048);
  if (normalized === null) return null;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("scheme");
    }
  } catch {
    throw adminSongValidationError(path);
  }
  return normalized;
}

function nullableYear(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (
    !Number.isInteger(value) ||
    Number(value) < 1000 ||
    Number(value) > 9999
  ) {
    throw adminSongValidationError(path);
  }
  return Number(value);
}

function nullableDate(value: unknown, path: string): string | null {
  if (value === null) return null;
  const date = requiredString(value, path, 10, DATE_PATTERN);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw adminSongValidationError(path);
  }
  return date;
}
