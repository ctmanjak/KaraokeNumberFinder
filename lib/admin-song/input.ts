import { buildAliasSearchFields } from "../search/normalize";
import { personalizationError } from "../personalization";
import {
  ADMIN_ALIAS_TYPES,
  ADMIN_AVAILABILITY_STATUSES,
  type AdminAliasType,
  type AdminAvailabilityStatus,
  type AdminSongInput
} from "./types";

const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_ALIASES = 30;
const MAX_ENTRIES = 20;

export function parseAdminSongInput(value: unknown): AdminSongInput {
  const input = record(value);
  requireExactKeys(input, [
    "original_language",
    "canonical_title",
    "display_title",
    "canonical_artist",
    "release_year",
    "tie_in",
    "source_url",
    "source_name",
    "verification_note",
    "aliases",
    "karaoke_entries"
  ]);

  const originalLanguage = requiredString(
    input.original_language,
    16,
    LANGUAGE_PATTERN
  );
  const canonicalTitle = requiredString(input.canonical_title, 512);
  const displayTitle = requiredString(input.display_title, 512);
  const canonicalArtist = requiredString(input.canonical_artist, 512);
  const sourceName = requiredString(input.source_name, 256);
  const aliases = array(input.aliases, MAX_ALIASES).map(parseAlias);
  const karaokeEntries = array(input.karaoke_entries, MAX_ENTRIES, true).map(
    parseEntry
  );

  rejectDuplicateAliases([
    {
      alias: canonicalTitle,
      language: originalLanguage,
      alias_type: "canonical_title"
    },
    {
      alias: displayTitle,
      language: originalLanguage,
      alias_type: "display_title"
    },
    {
      alias: canonicalArtist,
      language: originalLanguage,
      alias_type: "artist"
    },
    ...aliases
  ]);
  rejectDuplicateEntries(karaokeEntries);

  return {
    original_language: originalLanguage,
    canonical_title: canonicalTitle,
    display_title: displayTitle,
    canonical_artist: canonicalArtist,
    release_year: nullableYear(input.release_year),
    tie_in: nullableString(input.tie_in, 512),
    source_url: nullableUrl(input.source_url),
    source_name: sourceName,
    verification_note: nullableString(input.verification_note, 4_000),
    aliases,
    karaoke_entries: karaokeEntries
  };
}

function parseAlias(value: unknown) {
  const alias = record(value);
  requireExactKeys(alias, ["alias", "language", "alias_type"]);
  const aliasType = requiredString(alias.alias_type, 64);
  if (!(ADMIN_ALIAS_TYPES as readonly string[]).includes(aliasType)) {
    invalid();
  }

  return {
    alias: requiredString(alias.alias, 512),
    language: requiredString(alias.language, 16, LANGUAGE_PATTERN),
    alias_type: aliasType as AdminAliasType
  };
}

function parseEntry(value: unknown) {
  const entry = record(value);
  requireExactKeys(entry, [
    "provider_id",
    "karaoke_number",
    "version_info",
    "availability_status",
    "last_verified_at"
  ]);
  const status = requiredString(entry.availability_status, 64);
  if (!(ADMIN_AVAILABILITY_STATUSES as readonly string[]).includes(status)) {
    invalid();
  }
  const karaokeNumber = requiredString(
    entry.karaoke_number,
    64,
    undefined,
    true
  );
  if (status === "available" && karaokeNumber === "") {
    invalid();
  }
  if (status !== "available" && karaokeNumber !== "") {
    invalid();
  }

  return {
    provider_id: requiredString(entry.provider_id, 128),
    karaoke_number: karaokeNumber,
    version_info: requiredString(entry.version_info, 256, undefined, true),
    availability_status: status as AdminAvailabilityStatus,
    last_verified_at: nullableDate(entry.last_verified_at)
  };
}

function rejectDuplicateAliases(
  aliases: ReadonlyArray<{ alias: string; alias_type: AdminAliasType }>
): void {
  const keys = new Set<string>();
  for (const alias of aliases) {
    const normalized = buildAliasSearchFields(alias.alias).normalizedAlias;
    if (normalized === "") {
      invalid();
    }
    const key = `${alias.alias_type}\u0000${normalized}`;
    if (keys.has(key)) {
      invalid();
    }
    keys.add(key);
  }
}

function rejectDuplicateEntries(
  entries: AdminSongInput["karaoke_entries"]
): void {
  const keys = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.provider_id}\u0000${entry.version_info}\u0000${entry.karaoke_number}`;
    if (keys.has(key)) {
      invalid();
    }
    keys.add(key);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid();
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, max: number, requireItem = false): unknown[] {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    (requireItem && value.length === 0)
  ) {
    invalid();
  }
  return value;
}

function requireExactKeys(
  input: Record<string, unknown>,
  allowedKeys: readonly string[]
): void {
  const allowed = new Set(allowedKeys);
  const inputKeys = Object.keys(input);
  if (
    inputKeys.length !== allowedKeys.length ||
    inputKeys.some((key) => !allowed.has(key))
  ) {
    invalid();
  }
}

function requiredString(
  value: unknown,
  max: number,
  pattern?: RegExp,
  allowEmpty = false
): string {
  if (typeof value !== "string") {
    invalid();
  }
  const normalized = value.trim();
  if (
    (!allowEmpty && normalized === "") ||
    normalized.length > max ||
    (pattern !== undefined && !pattern.test(normalized))
  ) {
    invalid();
  }
  return normalized;
}

function nullableString(value: unknown, max: number): string | null {
  if (value === null) {
    return null;
  }
  const normalized = requiredString(value, max, undefined, true);
  return normalized === "" ? null : normalized;
}

function nullableUrl(value: unknown): string | null {
  const normalized = nullableString(value, 2_048);
  if (normalized === null) {
    return null;
  }
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      invalid();
    }
  } catch {
    invalid();
  }
  return normalized;
}

function nullableYear(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  if (
    !Number.isInteger(value) ||
    (value as number) < 1000 ||
    (value as number) > 9999
  ) {
    invalid();
  }
  return value as number;
}

function nullableDate(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  const date = requiredString(value, 10, DATE_PATTERN);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    invalid();
  }
  return date;
}

function invalid(): never {
  throw personalizationError("VALIDATION_ERROR");
}
