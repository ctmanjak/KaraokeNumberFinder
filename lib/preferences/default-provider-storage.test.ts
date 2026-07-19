import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PROVIDER_STORAGE_KEY,
  readStoredDefaultProvider,
  removeStoredDefaultProvider,
  type DefaultProviderStorage,
  writeStoredDefaultProvider
} from "./default-provider-storage";

describe("default provider local storage", () => {
  it("stores and restores the versioned provider schema", () => {
    const storage = memoryStorage();

    expect(writeStoredDefaultProvider(storage, "provider-local")).toBe(true);
    expect(storage.getItem(DEFAULT_PROVIDER_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 1, provider_id: "provider-local" })
    );
    expect(readStoredDefaultProvider(storage)).toBe("provider-local");
  });

  it.each([
    ["corrupt JSON", "{"],
    ["wrong version", JSON.stringify({ version: 2, provider_id: "p" })],
    ["missing field", JSON.stringify({ version: 1 })],
    ["wrong field type", JSON.stringify({ version: 1, provider_id: 42 })],
    [
      "unknown field",
      JSON.stringify({ version: 1, provider_id: "p", user_id: "secret" })
    ],
    [
      "oversized ID",
      JSON.stringify({ version: 1, provider_id: "p".repeat(129) })
    ]
  ])("discards %s without touching other keys", (_name, rawValue) => {
    const storage = memoryStorage({
      [DEFAULT_PROVIDER_STORAGE_KEY]: rawValue,
      "knf:v1:other": "preserve-me"
    });

    expect(readStoredDefaultProvider(storage)).toBeUndefined();
    expect(storage.getItem(DEFAULT_PROVIDER_STORAGE_KEY)).toBeNull();
    expect(storage.getItem("knf:v1:other")).toBe("preserve-me");
  });

  it("removes only the expected provider so a newer selection is preserved", () => {
    const storage = memoryStorage();
    writeStoredDefaultProvider(storage, "provider-new");

    expect(removeStoredDefaultProvider(storage, "provider-old")).toBe(false);
    expect(readStoredDefaultProvider(storage)).toBe("provider-new");
    expect(removeStoredDefaultProvider(storage, "provider-new")).toBe(true);
    expect(readStoredDefaultProvider(storage)).toBeUndefined();
  });

  it("contains get, set, and remove exceptions", () => {
    const storage: DefaultProviderStorage = {
      getItem: vi.fn(() => {
        throw new Error("get blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("set blocked");
      }),
      removeItem: vi.fn(() => {
        throw new Error("remove blocked");
      })
    };

    expect(readStoredDefaultProvider(storage)).toBeUndefined();
    expect(writeStoredDefaultProvider(storage, "provider-local")).toBe(false);
    expect(removeStoredDefaultProvider(storage)).toBe(false);
  });
});

function memoryStorage(
  initial: Record<string, string> = {}
): DefaultProviderStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}
