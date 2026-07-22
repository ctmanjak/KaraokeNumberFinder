import { describe, expect, it, vi } from "vitest";

import {
  PENDING_FAVORITE_STORAGE_KEY,
  PENDING_FAVORITE_TTL_MS,
  clearPendingFavoriteIntent,
  readPendingFavoriteIntent,
  writePendingFavoriteIntent,
  type PendingFavoriteStorage
} from "./pending-intent";

describe("pending favorite intent", () => {
  it("stores one versioned song for no longer than ten minutes", () => {
    const storage = memoryStorage();
    const now = 1_000_000;

    expect(
      writePendingFavoriteIntent("song-a", {
        storage,
        now: () => now,
        ttlMs: PENDING_FAVORITE_TTL_MS * 2
      })
    ).toBe(true);
    expect(JSON.parse(storage.value!)).toEqual({
      version: 1,
      song_id: "song-a",
      expires_at: now + PENDING_FAVORITE_TTL_MS
    });

    writePendingFavoriteIntent("song-b", { storage, now: () => now });
    expect(readPendingFavoriteIntent({ storage, now: () => now })).toEqual({
      version: 1,
      song_id: "song-b",
      expires_at: now + PENDING_FAVORITE_TTL_MS
    });
  });

  it.each([
    [
      "expired",
      JSON.stringify({ version: 1, song_id: "song-a", expires_at: 999 })
    ],
    [
      "wrong version",
      JSON.stringify({ version: 2, song_id: "song-a", expires_at: 2_000 })
    ],
    [
      "wrong song",
      JSON.stringify({ version: 1, song_id: 123, expires_at: 2_000 })
    ],
    [
      "extra data",
      JSON.stringify({
        version: 1,
        song_id: "song-a",
        expires_at: 2_000,
        user_id: "secret"
      })
    ],
    ["invalid JSON", "{"]
  ])("discards %s data", (_name, value) => {
    const storage = memoryStorage(value);

    expect(readPendingFavoriteIntent({ storage, now: () => 1_000 })).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(
      PENDING_FAVORITE_STORAGE_KEY
    );
    expect(storage.value).toBeNull();
  });

  it("contains get, set, and remove storage exceptions", () => {
    const getFailure = storageFailure("getItem");
    const setFailure = storageFailure("setItem");
    const removeFailure = storageFailure("removeItem");
    const allMutationFailure = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error("disabled");
      }),
      removeItem: vi.fn(() => {
        throw new Error("disabled");
      })
    } satisfies PendingFavoriteStorage;

    expect(readPendingFavoriteIntent({ storage: getFailure })).toBeNull();
    expect(writePendingFavoriteIntent("song-a", { storage: setFailure })).toBe(
      false
    );
    expect(clearPendingFavoriteIntent(removeFailure)).toBe(true);
    expect(removeFailure.setItem).toHaveBeenCalledWith(
      PENDING_FAVORITE_STORAGE_KEY,
      ""
    );
    expect(clearPendingFavoriteIntent(allMutationFailure)).toBe(false);
  });
});

function memoryStorage(initialValue: string | null = null) {
  let value = initialValue;
  return {
    get value() {
      return value;
    },
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
    removeItem: vi.fn(() => {
      value = null;
    })
  } satisfies PendingFavoriteStorage & { readonly value: string | null };
}

function storageFailure(
  operation: keyof PendingFavoriteStorage
): PendingFavoriteStorage {
  return {
    getItem: vi.fn(() => {
      if (operation === "getItem") throw new Error("disabled");
      return null;
    }),
    setItem: vi.fn(() => {
      if (operation === "setItem") throw new Error("disabled");
    }),
    removeItem: vi.fn(() => {
      if (operation === "removeItem") throw new Error("disabled");
    })
  };
}
