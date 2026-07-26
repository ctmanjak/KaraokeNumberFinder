import { normalizeSearchText } from "../search/normalize";
import {
  decodeAdminSongCursor,
  InvalidAdminSongCursorError,
  type AdminSongCursorKey
} from "./cursor";

export const DEFAULT_ADMIN_SONG_LIST_LIMIT = 20;
export const MAX_ADMIN_SONG_LIST_LIMIT = 50;

export type AdminSongProviderSummary = Readonly<{
  provider_id: string;
  provider_name: string;
  karaoke_number: string;
  version_info: string;
  availability_status: string;
}>;

export type AdminSongListItem = Readonly<{
  id: string;
  original_language: string;
  canonical_title: string;
  display_title: string;
  canonical_artist: string;
  provider_summary: readonly AdminSongProviderSummary[];
  updated_at: string;
}>;

export type AdminSongListResponse = Readonly<{
  items: readonly AdminSongListItem[];
  next_cursor: string | null;
}>;

export type AdminSongListQuery = Readonly<{
  query: string | null;
  normalizedQuery: string | null;
  cursor: AdminSongCursorKey | null;
  limit: number;
}>;

export class InvalidAdminSongListQueryError extends Error {
  constructor() {
    super("INVALID_ADMIN_SONG_LIST_QUERY");
    this.name = "InvalidAdminSongListQueryError";
  }
}

export function parseAdminSongListQuery(
  searchParams: URLSearchParams
): AdminSongListQuery {
  const allowed = new Set(["query", "cursor", "limit"]);
  if (
    [...searchParams.keys()].some((key) => !allowed.has(key)) ||
    [...allowed].some((key) => searchParams.getAll(key).length > 1)
  ) {
    invalidQuery();
  }

  const rawQuery = searchParams.get("query");
  if (rawQuery !== null && rawQuery.length > 512) {
    invalidQuery();
  }
  const query =
    rawQuery === null || rawQuery.trim() === "" ? null : rawQuery.trim();
  const normalizedQuery = query === null ? null : normalizeSearchText(query);
  if (query !== null && normalizedQuery === "") {
    invalidQuery();
  }

  const rawLimit = searchParams.get("limit");
  const limit =
    rawLimit === null ? DEFAULT_ADMIN_SONG_LIST_LIMIT : parseLimit(rawLimit);
  if (limit === null) {
    invalidQuery();
  }

  const rawCursor = searchParams.get("cursor");
  let cursor: AdminSongCursorKey | null = null;
  if (rawCursor !== null) {
    try {
      cursor = decodeAdminSongCursor(rawCursor, normalizedQuery);
    } catch (error) {
      if (error instanceof InvalidAdminSongCursorError) {
        invalidQuery();
      }
      throw error;
    }
  }

  return { query, normalizedQuery, cursor, limit };
}

export function parseAdminSongListResponse(
  value: unknown
): AdminSongListResponse {
  const response = exactRecord(value, ["items", "next_cursor"]);
  if (!Array.isArray(response.items)) {
    invalidResponse();
  }
  const items = response.items.map(parseListItem);
  const nextCursor = response.next_cursor;
  if (
    nextCursor !== null &&
    (typeof nextCursor !== "string" ||
      nextCursor.length === 0 ||
      nextCursor.length > 1_024 ||
      !/^[A-Za-z0-9_-]+$/u.test(nextCursor))
  ) {
    invalidResponse();
  }
  return { items, next_cursor: nextCursor };
}

function parseListItem(value: unknown): AdminSongListItem {
  const item = exactRecord(value, [
    "id",
    "original_language",
    "canonical_title",
    "display_title",
    "canonical_artist",
    "provider_summary",
    "updated_at"
  ]);
  const id = boundedString(item.id, 128);
  const originalLanguage = boundedString(item.original_language, 16);
  const canonicalTitle = boundedString(item.canonical_title, 512);
  const displayTitle = boundedString(item.display_title, 512);
  const canonicalArtist = boundedString(item.canonical_artist, 512);
  if (!Array.isArray(item.provider_summary)) {
    invalidResponse();
  }
  const providerSummary = item.provider_summary.map(parseProviderSummary);
  const updatedAt = boundedString(item.updated_at, 64);
  const parsedUpdatedAt = new Date(updatedAt);
  if (
    !Number.isFinite(parsedUpdatedAt.getTime()) ||
    parsedUpdatedAt.toISOString() !== updatedAt
  ) {
    invalidResponse();
  }
  return {
    id,
    original_language: originalLanguage,
    canonical_title: canonicalTitle,
    display_title: displayTitle,
    canonical_artist: canonicalArtist,
    provider_summary: providerSummary,
    updated_at: updatedAt
  };
}

function parseProviderSummary(value: unknown): AdminSongProviderSummary {
  const entry = exactRecord(value, [
    "provider_id",
    "provider_name",
    "karaoke_number",
    "version_info",
    "availability_status"
  ]);
  return {
    provider_id: boundedString(entry.provider_id, 128),
    provider_name: boundedString(entry.provider_name, 256),
    karaoke_number: boundedString(entry.karaoke_number, 64, true),
    version_info: boundedString(entry.version_info, 256, true),
    availability_status: boundedString(entry.availability_status, 64)
  };
}

function parseLimit(value: string): number | null {
  if (!/^[1-9]\d*$/u.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) &&
    parsed >= 1 &&
    parsed <= MAX_ADMIN_SONG_LIST_LIMIT
    ? parsed
    : null;
}

function exactRecord(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidResponse();
  }
  const record = value as Record<string, unknown>;
  const expected = new Set(keys);
  if (
    Object.keys(record).length !== expected.size ||
    Object.keys(record).some((key) => !expected.has(key))
  ) {
    invalidResponse();
  }
  return record;
}

function boundedString(
  value: unknown,
  max: number,
  allowEmpty = false
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!allowEmpty && value.length === 0)
  ) {
    invalidResponse();
  }
  return value;
}

function invalidQuery(): never {
  throw new InvalidAdminSongListQueryError();
}

function invalidResponse(): never {
  throw new TypeError("Invalid administrator song list response.");
}
