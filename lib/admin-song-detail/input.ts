import {
  ADMIN_AVAILABILITY_STATUSES,
  ADMIN_EDITABLE_ALIAS_TYPES,
  type AdminAvailabilityStatus,
  type AdminEditableAliasType
} from "../admin-song/types";
import { adminSongValidationError } from "../admin-song/validation";
import { parseAdminSongId } from "../admin-song-duplicate/input";
import {
  normalizeSongIdentity,
  SongIdentityValidationError
} from "../song-identity/normalize";
import {
  ADMIN_SONG_MAX_ALIASES,
  ADMIN_SONG_MAX_ENTRIES,
  type AdminSongPatchAliasInput,
  type AdminSongPatchEntryInput,
  type AdminSongPatchInput
} from "./types";

const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/u;

export function parseAdminSongPatchInput(value: unknown): AdminSongPatchInput {
  const input = record(value, "body");
  exactKeys(input, [
    "expected_updated_at",
    "song",
    "aliases",
    "karaoke_entries",
    "possible_duplicate_acknowledged_song_ids"
  ]);
  const song = parseSong(record(input.song, "song"));
  try {
    normalizeSongIdentity({
      canonical_title: song.canonical_title,
      canonical_artist: song.canonical_artist
    });
  } catch (error) {
    if (error instanceof SongIdentityValidationError) {
      throw adminSongValidationError(`song.${error.field}`);
    }
    throw error;
  }
  const aliases = array(input.aliases, "aliases", ADMIN_SONG_MAX_ALIASES).map(
    (alias, index) => parseAlias(alias, index)
  );
  const entries = array(
    input.karaoke_entries,
    "karaoke_entries",
    ADMIN_SONG_MAX_ENTRIES
  ).map((entry, index) => parseEntry(entry, index));
  const acknowledged = array(
    input.possible_duplicate_acknowledged_song_ids,
    "possible_duplicate_acknowledged_song_ids",
    5
  ).map((id, index) =>
    parseAdminSongId(id, `possible_duplicate_acknowledged_song_ids.${index}`)
  );
  if (new Set(acknowledged).size !== acknowledged.length) {
    throw adminSongValidationError(
      "possible_duplicate_acknowledged_song_ids",
      "Candidate IDs must be unique.",
      { max: 5 }
    );
  }
  const expectedUpdatedAt = requiredString(
    input.expected_updated_at,
    "expected_updated_at",
    40,
    TIMESTAMP_PATTERN
  );
  if (Number.isNaN(Date.parse(expectedUpdatedAt))) {
    throw adminSongValidationError("expected_updated_at");
  }
  return {
    expected_updated_at: expectedUpdatedAt,
    song,
    aliases,
    karaoke_entries: entries,
    possible_duplicate_acknowledged_song_ids: acknowledged
  };
}

function parseSong(song: Record<string, unknown>): AdminSongPatchInput["song"] {
  allowedKeys(
    song,
    [
      "original_language",
      "canonical_title",
      "display_title",
      "canonical_artist",
      "release_year",
      "tie_in",
      "source_name",
      "source_url",
      "verification_note"
    ],
    "song"
  );
  for (const key of [
    "original_language",
    "canonical_title",
    "display_title",
    "canonical_artist",
    "release_year",
    "tie_in"
  ]) {
    if (!Object.hasOwn(song, key)) {
      throw adminSongValidationError(`song.${key}`, "Required field.");
    }
  }
  return {
    original_language: requiredString(
      song.original_language,
      "song.original_language",
      16,
      LANGUAGE_PATTERN
    ),
    canonical_title: requiredString(
      song.canonical_title,
      "song.canonical_title",
      512
    ),
    display_title: requiredString(
      song.display_title,
      "song.display_title",
      512
    ),
    canonical_artist: requiredString(
      song.canonical_artist,
      "song.canonical_artist",
      512
    ),
    release_year: nullableYear(song.release_year, "song.release_year"),
    tie_in: nullableString(song.tie_in, "song.tie_in", 512),
    ...optionalNullableString(song, "source_name", 256, "song"),
    ...optionalNullableUrl(song, "source_url", "song"),
    ...optionalNullableString(song, "verification_note", 4_000, "song")
  };
}

function parseAlias(value: unknown, index: number): AdminSongPatchAliasInput {
  const path = `aliases.${index}`;
  const alias = record(value, path);
  allowedKeys(
    alias,
    [
      "id",
      "alias",
      "language",
      "alias_type",
      "source_name",
      "source_url",
      "verification_note"
    ],
    path
  );
  for (const key of ["alias", "language", "alias_type"]) {
    if (!Object.hasOwn(alias, key)) {
      throw adminSongValidationError(`${path}.${key}`, "Required field.");
    }
  }
  const aliasType = requiredString(alias.alias_type, `${path}.alias_type`, 64);
  if (!(ADMIN_EDITABLE_ALIAS_TYPES as readonly string[]).includes(aliasType)) {
    throw adminSongValidationError(
      `${path}.alias_type`,
      "System alias types are read-only."
    );
  }
  return {
    ...(alias.id === undefined
      ? {}
      : { id: parseAdminSongId(alias.id, `${path}.id`) }),
    alias: requiredString(alias.alias, `${path}.alias`, 512),
    language: requiredString(
      alias.language,
      `${path}.language`,
      16,
      LANGUAGE_PATTERN
    ),
    alias_type: aliasType as AdminEditableAliasType,
    ...optionalNullableString(alias, "source_name", 256, path),
    ...optionalNullableUrl(alias, "source_url", path),
    ...optionalNullableString(alias, "verification_note", 4_000, path)
  };
}

function parseEntry(value: unknown, index: number): AdminSongPatchEntryInput {
  const path = `karaoke_entries.${index}`;
  const entry = record(value, path);
  allowedKeys(
    entry,
    [
      "id",
      "provider_id",
      "karaoke_number",
      "version_info",
      "availability_status",
      "last_verified_at",
      "source_name",
      "source_url",
      "verification_note"
    ],
    path
  );
  for (const key of [
    "provider_id",
    "karaoke_number",
    "version_info",
    "availability_status"
  ]) {
    if (!Object.hasOwn(entry, key)) {
      throw adminSongValidationError(`${path}.${key}`, "Required field.");
    }
  }
  const status = requiredString(
    entry.availability_status,
    `${path}.availability_status`,
    64
  );
  if (!(ADMIN_AVAILABILITY_STATUSES as readonly string[]).includes(status)) {
    throw adminSongValidationError(`${path}.availability_status`);
  }
  const karaokeNumber = requiredString(
    entry.karaoke_number,
    `${path}.karaoke_number`,
    64,
    undefined,
    true
  );
  if (
    (status === "available" && karaokeNumber === "") ||
    (status !== "available" && karaokeNumber !== "")
  ) {
    throw adminSongValidationError(`${path}.karaoke_number`);
  }
  return {
    ...(entry.id === undefined
      ? {}
      : { id: parseAdminSongId(entry.id, `${path}.id`) }),
    provider_id: parseAdminSongId(entry.provider_id, `${path}.provider_id`),
    karaoke_number: karaokeNumber,
    version_info: requiredString(
      entry.version_info,
      `${path}.version_info`,
      256,
      undefined,
      true
    ),
    availability_status: status as AdminAvailabilityStatus,
    ...(Object.hasOwn(entry, "last_verified_at")
      ? {
          last_verified_at: nullableDate(
            entry.last_verified_at,
            `${path}.last_verified_at`
          )
        }
      : {}),
    ...(Object.hasOwn(entry, "source_name")
      ? {
          source_name: requiredString(
            entry.source_name,
            `${path}.source_name`,
            256
          )
        }
      : {}),
    ...optionalNullableUrl(entry, "source_url", path),
    ...optionalNullableString(entry, "verification_note", 4_000, path)
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw adminSongValidationError(path);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    throw adminSongValidationError(path, "Too many items.", { max });
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
  keys: readonly string[],
  prefix?: string
): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown !== undefined) {
    throw adminSongValidationError(
      prefix === undefined ? unknown : `${prefix}.${unknown}`,
      "Unknown field."
    );
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

function optionalNullableString(
  input: Record<string, unknown>,
  key: string,
  max: number,
  prefix: string
): Record<string, string | null> {
  return Object.hasOwn(input, key)
    ? { [key]: nullableString(input[key], `${prefix}.${key}`, max) }
    : {};
}

function optionalNullableUrl(
  input: Record<string, unknown>,
  key: string,
  prefix: string
): Record<string, string | null> {
  if (!Object.hasOwn(input, key)) return {};
  const value = nullableString(input[key], `${prefix}.${key}`, 2_048);
  if (value !== null) {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("scheme");
      }
    } catch {
      throw adminSongValidationError(`${prefix}.${key}`);
    }
  }
  return { [key]: value };
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
