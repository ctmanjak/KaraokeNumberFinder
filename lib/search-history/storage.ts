import { normalizeSearchText } from "../search/normalize";
import {
  MAX_SEARCH_HISTORY_ITEMS,
  MAX_SEARCH_HISTORY_QUERY_LENGTH
} from "./service";

export const SEARCH_HISTORY_STORAGE_KEY = "knf:v1:recent-searches";
export const SEARCH_HISTORY_STORAGE_VERSION = 1;

export type SearchHistoryStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

export type StoredSearchHistoryItem = Readonly<{
  query: string;
  normalized_query: string;
  searched_at: string;
}>;

type StoredSearchHistory = Readonly<{
  version: typeof SEARCH_HISTORY_STORAGE_VERSION;
  items: StoredSearchHistoryItem[];
}>;

type StorageReadResult =
  | Readonly<{ status: "available"; items: StoredSearchHistoryItem[] }>
  | Readonly<{ status: "unavailable" }>;

export function getBrowserSearchHistoryStorage():
  SearchHistoryStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readStoredSearchHistory(
  storage: SearchHistoryStorage | undefined = getBrowserSearchHistoryStorage()
): StoredSearchHistoryItem[] {
  const result = readStorage(storage);
  return result.status === "available" ? result.items : [];
}

export function addStoredSearchHistory(
  queryInput: string,
  options: {
    storage?: SearchHistoryStorage;
    searchedAt?: Date;
  } = {}
): StoredSearchHistoryItem[] | undefined {
  const storage = options.storage ?? getBrowserSearchHistoryStorage();
  const stored = readStorage(storage);
  const query = queryInput.trim();
  const normalizedQuery = normalizeSearchText(query);
  const searchedAt = options.searchedAt ?? new Date();

  if (
    stored.status === "unavailable" ||
    !hasValidLength(query) ||
    !hasValidLength(normalizedQuery) ||
    Number.isNaN(searchedAt.getTime())
  ) {
    return undefined;
  }

  const next = canonicalize([
    {
      query,
      normalized_query: normalizedQuery,
      searched_at: searchedAt.toISOString()
    },
    ...stored.items.filter((item) => item.normalized_query !== normalizedQuery)
  ]);

  return writeItems(storage, next) ? next : undefined;
}

export function removeStoredSearchHistoryItem(
  normalizedQuery: string,
  storage: SearchHistoryStorage | undefined = getBrowserSearchHistoryStorage()
): StoredSearchHistoryItem[] | undefined {
  const stored = readStorage(storage);
  if (stored.status === "unavailable") {
    return undefined;
  }

  const next = stored.items.filter(
    (item) => item.normalized_query !== normalizedQuery
  );
  return writeItems(storage, next) ? next : undefined;
}

export function clearStoredSearchHistory(
  storage: SearchHistoryStorage | undefined = getBrowserSearchHistoryStorage()
): boolean {
  if (storage === undefined) {
    return false;
  }

  return safelyRemove(storage);
}

export function replaceStoredSearchHistory(
  items: readonly StoredSearchHistoryItem[],
  storage: SearchHistoryStorage | undefined = getBrowserSearchHistoryStorage()
): boolean {
  if (
    storage === undefined ||
    items.length > MAX_SEARCH_HISTORY_ITEMS ||
    !items.every(isStoredSearchHistoryItem)
  ) {
    return false;
  }

  return writeItems(storage, canonicalize(items));
}

function readStorage(
  storage: SearchHistoryStorage | undefined
): StorageReadResult {
  if (storage === undefined) {
    return { status: "unavailable" };
  }

  let rawValue: string | null;
  try {
    rawValue = storage.getItem(SEARCH_HISTORY_STORAGE_KEY);
  } catch {
    return { status: "unavailable" };
  }

  if (rawValue === null) {
    return { status: "available", items: [] };
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (!isStoredSearchHistory(parsed)) {
      safelyRemove(storage);
      return { status: "available", items: [] };
    }

    return { status: "available", items: canonicalize(parsed.items) };
  } catch {
    safelyRemove(storage);
    return { status: "available", items: [] };
  }
}

function writeItems(
  storage: SearchHistoryStorage | undefined,
  items: readonly StoredSearchHistoryItem[]
): boolean {
  if (storage === undefined) {
    return false;
  }

  if (items.length === 0) {
    return safelyRemove(storage);
  }

  const value: StoredSearchHistory = {
    version: SEARCH_HISTORY_STORAGE_VERSION,
    items: [...items]
  };

  try {
    storage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function isStoredSearchHistory(value: unknown): value is StoredSearchHistory {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    "version" in value &&
    value.version === SEARCH_HISTORY_STORAGE_VERSION &&
    "items" in value &&
    Array.isArray(value.items) &&
    value.items.length <= MAX_SEARCH_HISTORY_ITEMS &&
    value.items.every(isStoredSearchHistoryItem)
  );
}

function isStoredSearchHistoryItem(
  value: unknown
): value is StoredSearchHistoryItem {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 3
  ) {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    typeof item.query === "string" &&
    item.query === item.query.trim() &&
    hasValidLength(item.query) &&
    typeof item.normalized_query === "string" &&
    hasValidLength(item.normalized_query) &&
    item.normalized_query === normalizeSearchText(item.query) &&
    typeof item.searched_at === "string" &&
    isCanonicalIsoDate(item.searched_at)
  );
}

function canonicalize(
  items: readonly StoredSearchHistoryItem[]
): StoredSearchHistoryItem[] {
  const sorted = [...items].sort((left, right) => {
    const timeDifference =
      new Date(right.searched_at).getTime() -
      new Date(left.searched_at).getTime();
    return timeDifference !== 0
      ? timeDifference
      : right.normalized_query.localeCompare(left.normalized_query);
  });
  const seen = new Set<string>();

  return sorted
    .filter((item) => {
      if (seen.has(item.normalized_query)) {
        return false;
      }
      seen.add(item.normalized_query);
      return true;
    })
    .slice(0, MAX_SEARCH_HISTORY_ITEMS);
}

function isCanonicalIsoDate(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function hasValidLength(value: string): boolean {
  const length = Array.from(value).length;
  return length > 0 && length <= MAX_SEARCH_HISTORY_QUERY_LENGTH;
}

function safelyRemove(storage: SearchHistoryStorage): boolean {
  try {
    storage.removeItem(SEARCH_HISTORY_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
