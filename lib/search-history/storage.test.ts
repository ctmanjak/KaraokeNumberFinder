import { describe, expect, it, vi } from "vitest";

import {
  SEARCH_HISTORY_STORAGE_KEY,
  addStoredSearchHistory,
  clearStoredSearchHistory,
  readStoredSearchHistory,
  removeStoredSearchHistoryItem,
  replaceStoredSearchHistory,
  type SearchHistoryStorage,
  type StoredSearchHistoryItem
} from "./storage";

describe("search history local storage", () => {
  it("reads and writes the versioned minimal payload", () => {
    const storage = memoryStorage();
    const searchedAt = new Date("2026-07-20T01:00:00.000Z");

    const items = addStoredSearchHistory("  Love (Live)!  ", {
      storage: storage.value,
      searchedAt
    });

    expect(items).toEqual([
      {
        query: "Love (Live)!",
        normalized_query: "lovelive",
        searched_at: searchedAt.toISOString()
      }
    ]);
    expect(
      JSON.parse(storage.data.get(SEARCH_HISTORY_STORAGE_KEY) ?? "")
    ).toEqual({ version: 1, items });
    expect(readStoredSearchHistory(storage.value)).toEqual(items);
  });

  it.each([
    ["malformed JSON", "{"],
    ["wrong version", JSON.stringify({ version: 2, items: [] })],
    [
      "wrong type",
      JSON.stringify({
        version: 1,
        items: [{ query: 42, normalized_query: "hello", searched_at: "x" }]
      })
    ],
    [
      "query over 200 code points",
      storedPayload({
        query: "가".repeat(201),
        normalized_query: "가".repeat(201)
      })
    ],
    ["invalid date", storedPayload({ searched_at: "not-a-date" })],
    ["non-canonical date", storedPayload({ searched_at: "2026-07-20" })]
  ])("discards %s by removing only its key", (_name, rawValue) => {
    const storage = memoryStorage();
    storage.data.set(SEARCH_HISTORY_STORAGE_KEY, rawValue);

    expect(readStoredSearchHistory(storage.value)).toEqual([]);
    expect(storage.removeItem).toHaveBeenCalledWith(SEARCH_HISTORY_STORAGE_KEY);
    expect(storage.data.has(SEARCH_HISTORY_STORAGE_KEY)).toBe(false);
  });

  it("contains get, set, and remove failures without throwing", () => {
    const getFailure = failingStorage("get");
    const setFailure = failingStorage("set");
    const removeFailure = failingStorage("remove");

    expect(readStoredSearchHistory(getFailure)).toEqual([]);
    expect(
      addStoredSearchHistory("Hello", { storage: setFailure })
    ).toBeUndefined();
    expect(clearStoredSearchHistory(removeFailure)).toBe(false);
    expect(() =>
      removeStoredSearchHistoryItem("hello", removeFailure)
    ).not.toThrow();
  });

  it("updates normalized duplicates with the latest display query and timestamp", () => {
    const storage = memoryStorage();
    addStoredSearchHistory("Love (Live)!", {
      storage: storage.value,
      searchedAt: new Date("2026-07-20T01:00:00.000Z")
    });

    const items = addStoredSearchHistory("LOVE LIVE", {
      storage: storage.value,
      searchedAt: new Date("2026-07-20T02:00:00.000Z")
    });

    expect(items).toEqual([
      {
        query: "LOVE LIVE",
        normalized_query: "lovelive",
        searched_at: "2026-07-20T02:00:00.000Z"
      }
    ]);
  });

  it("keeps only ten items in newest-first order", () => {
    const storage = memoryStorage();
    for (let index = 0; index < 12; index += 1) {
      addStoredSearchHistory(`Query ${index}`, {
        storage: storage.value,
        searchedAt: new Date(Date.UTC(2026, 6, 20, 0, index))
      });
    }

    const items = readStoredSearchHistory(storage.value);
    expect(items).toHaveLength(10);
    expect(items.map(({ query }) => query)).toEqual([
      "Query 11",
      "Query 10",
      "Query 9",
      "Query 8",
      "Query 7",
      "Query 6",
      "Query 5",
      "Query 4",
      "Query 3",
      "Query 2"
    ]);
  });

  it("supports individual and full local deletion", () => {
    const storage = memoryStorage();
    const items = [
      item("New", "new", "2026-07-20T02:00:00.000Z"),
      item("Old", "old", "2026-07-20T01:00:00.000Z")
    ];
    expect(replaceStoredSearchHistory(items, storage.value)).toBe(true);

    expect(removeStoredSearchHistoryItem("new", storage.value)).toEqual([
      items[1]
    ]);
    expect(clearStoredSearchHistory(storage.value)).toBe(true);
    expect(readStoredSearchHistory(storage.value)).toEqual([]);
  });
});

function memoryStorage() {
  const data = new Map<string, string>();
  const getItem = vi.fn((key: string) => data.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => data.set(key, value));
  const removeItem = vi.fn((key: string) => data.delete(key));
  return {
    data,
    getItem,
    setItem,
    removeItem,
    value: { getItem, setItem, removeItem } satisfies SearchHistoryStorage
  };
}

function failingStorage(operation: "get" | "set" | "remove") {
  return {
    getItem:
      operation === "get"
        ? () => {
            throw new Error("get disabled");
          }
        : () => null,
    setItem:
      operation === "set"
        ? () => {
            throw new Error("set disabled");
          }
        : () => undefined,
    removeItem:
      operation === "remove"
        ? () => {
            throw new Error("remove disabled");
          }
        : () => undefined
  } satisfies SearchHistoryStorage;
}

function storedPayload(overrides: Partial<StoredSearchHistoryItem>): string {
  return JSON.stringify({
    version: 1,
    items: [
      {
        query: "Hello",
        normalized_query: "hello",
        searched_at: "2026-07-20T01:00:00.000Z",
        ...overrides
      }
    ]
  });
}

function item(
  query: string,
  normalized_query: string,
  searched_at: string
): StoredSearchHistoryItem {
  return { query, normalized_query, searched_at };
}
