import {
  createRequestTimeout,
  readErrorEnvelope,
  readJson
} from "../http/client";
import { isDefaultProviderId } from "../preferences/default-provider";
import type { ProviderListItem } from "../providers/providers";
import { normalizeSearchText } from "../search/normalize";
import {
  MAX_SEARCH_HISTORY_ITEMS,
  MAX_SEARCH_HISTORY_QUERY_LENGTH,
  type SearchHistoryItem
} from "./service";
import type { StoredSearchHistoryItem } from "./storage";

export const SEARCH_HISTORY_REQUEST_TIMEOUT_MS = 5_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class SearchHistoryClientError extends Error {
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
    this.name = "SearchHistoryClientError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.status = options.status;
  }
}

export function createSearchHistoryMergeId(
  randomUUID: () => string = () => crypto.randomUUID()
): string {
  const mergeId = randomUUID();
  if (!UUID_PATTERN.test(mergeId)) {
    throw new SearchHistoryClientError({
      code: "INVALID_MERGE_ID",
      message: "최근 검색어 병합 식별자를 만들지 못했습니다.",
      retryable: true
    });
  }
  return mergeId;
}

export async function fetchServerSearchHistory(
  fetcher: typeof fetch = fetch,
  requestTimeoutMs = SEARCH_HISTORY_REQUEST_TIMEOUT_MS
): Promise<SearchHistoryItem[]> {
  const payload = await requestJson(
    "/api/search-history",
    { cache: "no-store", headers: { accept: "application/json" } },
    fetcher,
    requestTimeoutMs
  );

  if (!isSearchHistoryListPayload(payload)) {
    throw invalidResponseError();
  }
  return payload.items;
}

export async function postServerSearchHistory(
  query: string,
  fetcher: typeof fetch = fetch,
  requestTimeoutMs = SEARCH_HISTORY_REQUEST_TIMEOUT_MS
): Promise<SearchHistoryItem> {
  const payload = await requestJson(
    "/api/search-history",
    mutationInit("POST", { query }),
    fetcher,
    requestTimeoutMs
  );

  if (!isSearchHistoryItemPayload(payload)) {
    throw invalidResponseError();
  }
  return payload.item;
}

export async function deleteServerSearchHistoryItem(
  id: string,
  fetcher: typeof fetch = fetch,
  requestTimeoutMs = SEARCH_HISTORY_REQUEST_TIMEOUT_MS
): Promise<number> {
  if (!UUID_PATTERN.test(id)) {
    throw invalidResponseError();
  }

  return deleteSearchHistory(
    `/api/search-history/${encodeURIComponent(id)}`,
    fetcher,
    requestTimeoutMs
  );
}

export async function clearServerSearchHistory(
  fetcher: typeof fetch = fetch,
  requestTimeoutMs = SEARCH_HISTORY_REQUEST_TIMEOUT_MS
): Promise<number> {
  return deleteSearchHistory("/api/search-history", fetcher, requestTimeoutMs);
}

export async function mergeServerSearchHistory(options: {
  mergeId: string;
  recentSearches: readonly StoredSearchHistoryItem[];
  defaultProviderId?: string;
  fetcher?: typeof fetch;
  requestTimeoutMs?: number;
}): Promise<SearchHistoryItem[]> {
  if (
    !UUID_PATTERN.test(options.mergeId) ||
    options.recentSearches.length > MAX_SEARCH_HISTORY_ITEMS
  ) {
    throw invalidResponseError();
  }

  const payload = await requestJson(
    "/api/user-data/merge",
    mutationInit("POST", {
      merge_id: options.mergeId,
      recent_searches: options.recentSearches.map((item) => ({
        query: item.query,
        searched_at: item.searched_at
      })),
      ...(options.defaultProviderId === undefined
        ? {}
        : { default_provider_id: options.defaultProviderId })
    }),
    options.fetcher ?? fetch,
    options.requestTimeoutMs ?? SEARCH_HISTORY_REQUEST_TIMEOUT_MS
  );

  if (!isMergePayload(payload)) {
    throw invalidResponseError();
  }
  return payload.recent_searches;
}

export function isUnauthenticatedSearchHistoryError(error: unknown): boolean {
  return error instanceof SearchHistoryClientError && error.status === 401;
}

type MutationMethod = "POST" | "DELETE";

function mutationInit(method: MutationMethod, body?: unknown): RequestInit {
  return {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-knf-request": "1"
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  };
}

async function deleteSearchHistory(
  url: string,
  fetcher: typeof fetch,
  requestTimeoutMs: number
): Promise<number> {
  const payload = await requestJson(
    url,
    mutationInit("DELETE"),
    fetcher,
    requestTimeoutMs
  );
  if (!isDeletePayload(payload)) {
    throw invalidResponseError();
  }
  return payload.deleted_count;
}

async function requestJson(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
  requestTimeoutMs: number
): Promise<unknown> {
  const request = createRequestTimeout(requestTimeoutMs);

  try {
    let response: Response;
    try {
      response = await fetcher(url, { ...init, signal: request.signal });
    } catch {
      throw new SearchHistoryClientError({
        code: "SEARCH_HISTORY_UNAVAILABLE",
        message: "최근 검색어 요청에 실패했습니다.",
        retryable: true
      });
    }

    const payload = await readJson(response);
    if (!response.ok) {
      const error = readErrorEnvelope(payload);
      throw new SearchHistoryClientError({
        code: error.code ?? "SEARCH_HISTORY_UNAVAILABLE",
        message: "최근 검색어 요청에 실패했습니다.",
        retryable: response.status >= 500 || response.status === 429,
        status: response.status
      });
    }

    return payload;
  } finally {
    request.clear();
  }
}

function isSearchHistoryListPayload(
  value: unknown
): value is Readonly<{ items: SearchHistoryItem[] }> {
  return (
    isExactObject(value, ["items"]) &&
    Array.isArray(value.items) &&
    value.items.length <= MAX_SEARCH_HISTORY_ITEMS &&
    value.items.every(isSearchHistoryItem)
  );
}

function isSearchHistoryItemPayload(
  value: unknown
): value is Readonly<{ item: SearchHistoryItem }> {
  return isExactObject(value, ["item"]) && isSearchHistoryItem(value.item);
}

function isDeletePayload(
  value: unknown
): value is Readonly<{ deleted_count: number }> {
  return (
    isExactObject(value, ["deleted_count"]) &&
    typeof value.deleted_count === "number" &&
    Number.isSafeInteger(value.deleted_count) &&
    value.deleted_count >= 0
  );
}

function isMergePayload(value: unknown): value is Readonly<{
  merged: true;
  recent_searches: SearchHistoryItem[];
  default_provider: unknown;
}> {
  return (
    isExactObject(value, ["merged", "recent_searches", "default_provider"]) &&
    value.merged === true &&
    Array.isArray(value.recent_searches) &&
    value.recent_searches.length <= MAX_SEARCH_HISTORY_ITEMS &&
    value.recent_searches.every(isSearchHistoryItem) &&
    isDefaultProviderReadModel(value.default_provider)
  );
}

function isSearchHistoryItem(value: unknown): value is SearchHistoryItem {
  if (
    !isExactObject(value, ["id", "query", "normalized_query", "searched_at"])
  ) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    UUID_PATTERN.test(value.id) &&
    typeof value.query === "string" &&
    value.query === value.query.trim() &&
    hasValidLength(value.query) &&
    typeof value.normalized_query === "string" &&
    value.normalized_query === normalizeSearchText(value.query) &&
    hasValidLength(value.normalized_query) &&
    typeof value.searched_at === "string" &&
    isCanonicalIsoDate(value.searched_at)
  );
}

function isDefaultProviderReadModel(value: unknown): boolean {
  if (!isExactObject(value, ["default_provider", "source"])) {
    return false;
  }
  if (
    value.source !== "user" &&
    value.source !== "operational_default" &&
    value.source !== "none"
  ) {
    return false;
  }
  if (value.default_provider === null) {
    return value.source === "none";
  }
  return value.source !== "none" && isProvider(value.default_provider);
}

function isProvider(value: unknown): value is ProviderListItem {
  return (
    isExactObject(value, [
      "id",
      "name",
      "country",
      "is_active",
      "display_order",
      "is_default",
      "last_catalog_updated_at"
    ]) &&
    isDefaultProviderId(value.id) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.country === "string" &&
    /^[A-Z]{2}$/u.test(value.country) &&
    value.is_active === true &&
    typeof value.display_order === "number" &&
    Number.isInteger(value.display_order) &&
    typeof value.is_default === "boolean" &&
    (value.last_catalog_updated_at === null ||
      (typeof value.last_catalog_updated_at === "string" &&
        /^\d{4}-\d{2}-\d{2}$/u.test(value.last_catalog_updated_at)))
  );
}

function isExactObject<T extends readonly string[]>(
  value: unknown,
  keys: T
): value is Record<T[number], unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}

function hasValidLength(value: string): boolean {
  const length = Array.from(value).length;
  return length > 0 && length <= MAX_SEARCH_HISTORY_QUERY_LENGTH;
}

function isCanonicalIsoDate(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function invalidResponseError(): SearchHistoryClientError {
  return new SearchHistoryClientError({
    code: "INVALID_SEARCH_HISTORY_RESPONSE",
    message: "최근 검색어 응답을 확인하지 못했습니다.",
    retryable: true
  });
}
