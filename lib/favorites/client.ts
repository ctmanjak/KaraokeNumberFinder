import {
  createRequestTimeout,
  readErrorEnvelope,
  readJson
} from "@/lib/http/client";

export const FAVORITE_REQUEST_TIMEOUT_MS = 5_000;
const FAVORITE_LIST_LIMIT = 50;
export const FAVORITE_LIST_MAX_PAGES = 100;

export type FavoriteProvider = Readonly<{
  id: string;
  name: string;
  country: string;
  is_active: boolean;
  display_order: number;
  is_default: boolean;
  last_catalog_updated_at: string | null;
}>;

export type FavoriteKaraokeEntry = Readonly<{
  id: string;
  provider_id: string;
  karaoke_number: string;
  version_info: string;
  availability_status: string;
  last_verified_at: string | null;
  is_stale: boolean;
  provider: FavoriteProvider;
}>;

export type FavoriteSong = Readonly<{
  id: string;
  original_language: string;
  canonical_title: string;
  display_title: string;
  canonical_artist: string;
  release_year: number | null;
  tie_in: string | null;
  karaoke_entries: FavoriteKaraokeEntry[];
  distinguishing_labels: string[];
}>;

export type FavoriteListItem = Readonly<{
  song_id: string;
  created_at: string;
  song: FavoriteSong;
}>;

export type FavoriteListResponse = Readonly<{
  items: FavoriteListItem[];
  next_cursor: string | null;
}>;

export class FavoriteClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number | undefined;

  constructor(options: {
    code: string;
    message: string;
    retryable: boolean;
    status?: number;
  }) {
    super(options.message);
    this.name = "FavoriteClientError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.status = options.status;
  }
}

export async function fetchFavoritePage(
  options: {
    cursor?: string;
    limit?: number;
    fetcher?: typeof fetch;
    requestTimeoutMs?: number;
  } = {}
): Promise<FavoriteListResponse> {
  const params = new URLSearchParams({
    limit: String(options.limit ?? FAVORITE_LIST_LIMIT)
  });
  if (options.cursor !== undefined) {
    params.set("cursor", options.cursor);
  }

  const payload = await requestJson(
    `/api/favorites?${params.toString()}`,
    {
      cache: "no-store",
      headers: { accept: "application/json" }
    },
    options
  );

  if (!isFavoriteListResponse(payload)) {
    throw invalidFavoriteResponse();
  }

  return payload;
}

export async function fetchAllFavoriteSongIds(
  options: {
    fetcher?: typeof fetch;
    requestTimeoutMs?: number;
  } = {}
): Promise<Set<string>> {
  const songIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (
    let pageNumber = 1;
    pageNumber <= FAVORITE_LIST_MAX_PAGES;
    pageNumber += 1
  ) {
    const page = await fetchFavoritePage({ ...options, cursor });
    for (const item of page.items) {
      songIds.add(item.song_id);
    }

    if (page.next_cursor === null) {
      return songIds;
    }

    if (seenCursors.has(page.next_cursor)) {
      throw invalidFavoriteResponse();
    }
    if (pageNumber === FAVORITE_LIST_MAX_PAGES) {
      throw invalidFavoriteResponse();
    }
    seenCursors.add(page.next_cursor);
    cursor = page.next_cursor;
  }

  throw invalidFavoriteResponse();
}

export async function putFavorite(
  songId: string,
  options: {
    fetcher?: typeof fetch;
    requestTimeoutMs?: number;
  } = {}
): Promise<Readonly<{ favorite: true; created_at: string }>> {
  const payload = await mutateFavorite("PUT", songId, options);
  if (!isFavoritePutResponse(payload)) {
    throw invalidFavoriteResponse();
  }
  return payload;
}

export async function deleteFavorite(
  songId: string,
  options: {
    fetcher?: typeof fetch;
    requestTimeoutMs?: number;
  } = {}
): Promise<Readonly<{ favorite: false }>> {
  const payload = await mutateFavorite("DELETE", songId, options);
  if (!isFavoriteDeleteResponse(payload)) {
    throw invalidFavoriteResponse();
  }
  return payload;
}

export function isUnauthenticatedFavoriteError(error: unknown): boolean {
  return (
    error instanceof FavoriteClientError &&
    (error.status === 401 || error.code === "UNAUTHENTICATED")
  );
}

export function isSongNotFoundFavoriteError(error: unknown): boolean {
  return (
    error instanceof FavoriteClientError &&
    error.status === 404 &&
    error.code === "SONG_NOT_FOUND"
  );
}

async function mutateFavorite(
  method: "PUT" | "DELETE",
  songId: string,
  options: { fetcher?: typeof fetch; requestTimeoutMs?: number }
): Promise<unknown> {
  return requestJson(
    `/api/favorites/${encodeURIComponent(songId)}`,
    {
      method,
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "X-KNF-Request": "1"
      }
    },
    options
  );
}

async function requestJson(
  input: string,
  init: RequestInit,
  options: { fetcher?: typeof fetch; requestTimeoutMs?: number }
): Promise<unknown> {
  const request = createRequestTimeout(
    options.requestTimeoutMs ?? FAVORITE_REQUEST_TIMEOUT_MS
  );

  try {
    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)(input, {
        ...init,
        signal: request.signal
      });
    } catch {
      throw new FavoriteClientError({
        code: "NETWORK_ERROR",
        message: "즐겨찾기 요청에 실패했습니다.",
        retryable: true
      });
    }

    const payload = await readJson(response);
    if (!response.ok) {
      const error = readErrorEnvelope(payload);
      throw new FavoriteClientError({
        code: error.code ?? "FAVORITE_REQUEST_FAILED",
        message: error.message ?? "즐겨찾기 요청에 실패했습니다.",
        retryable: response.status >= 500 || response.status === 429,
        status: response.status
      });
    }

    return payload;
  } finally {
    request.clear();
  }
}

function isFavoriteListResponse(value: unknown): value is FavoriteListResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const response = value as Record<string, unknown>;
  return (
    Array.isArray(response.items) &&
    response.items.every(isFavoriteListItem) &&
    (response.next_cursor === null ||
      (typeof response.next_cursor === "string" &&
        response.next_cursor.length > 0 &&
        response.next_cursor.length <= 4_096))
  );
}

function isFavoriteListItem(value: unknown): value is FavoriteListItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    isSongId(item.song_id) &&
    isIsoDateTime(item.created_at) &&
    isFavoriteSong(item.song) &&
    item.song_id === (item.song as FavoriteSong).id
  );
}

function isFavoriteSong(value: unknown): value is FavoriteSong {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const song = value as Record<string, unknown>;
  return (
    isSongId(song.id) &&
    isNonEmptyString(song.original_language) &&
    isNonEmptyString(song.canonical_title) &&
    isNonEmptyString(song.display_title) &&
    isNonEmptyString(song.canonical_artist) &&
    (song.release_year === null ||
      (typeof song.release_year === "number" &&
        Number.isInteger(song.release_year))) &&
    (song.tie_in === null || typeof song.tie_in === "string") &&
    Array.isArray(song.karaoke_entries) &&
    song.karaoke_entries.every(isFavoriteKaraokeEntry) &&
    Array.isArray(song.distinguishing_labels) &&
    song.distinguishing_labels.every((label) => typeof label === "string")
  );
}

function isFavoriteKaraokeEntry(value: unknown): value is FavoriteKaraokeEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    isNonEmptyString(entry.id) &&
    isNonEmptyString(entry.provider_id) &&
    typeof entry.karaoke_number === "string" &&
    typeof entry.version_info === "string" &&
    isNonEmptyString(entry.availability_status) &&
    isNullableDate(entry.last_verified_at) &&
    typeof entry.is_stale === "boolean" &&
    isFavoriteProvider(entry.provider)
  );
}

function isFavoriteProvider(value: unknown): value is FavoriteProvider {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const provider = value as Record<string, unknown>;
  return (
    isNonEmptyString(provider.id) &&
    isNonEmptyString(provider.name) &&
    typeof provider.country === "string" &&
    typeof provider.is_active === "boolean" &&
    typeof provider.display_order === "number" &&
    Number.isInteger(provider.display_order) &&
    typeof provider.is_default === "boolean" &&
    isNullableDate(provider.last_catalog_updated_at)
  );
}

function isFavoritePutResponse(
  value: unknown
): value is Readonly<{ favorite: true; created_at: string }> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).favorite === true &&
    isIsoDateTime((value as Record<string, unknown>).created_at)
  );
}

function isFavoriteDeleteResponse(
  value: unknown
): value is Readonly<{ favorite: false }> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).favorite === false
  );
}

function isSongId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    !value.includes("/") &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function isNullableDate(value: unknown): value is string | null {
  return value === null || isIsoDateTime(value);
}

function invalidFavoriteResponse(): FavoriteClientError {
  return new FavoriteClientError({
    code: "INVALID_FAVORITE_RESPONSE",
    message: "즐겨찾기 응답을 확인하지 못했습니다.",
    retryable: true
  });
}
