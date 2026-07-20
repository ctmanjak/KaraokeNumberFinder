import { describe, expect, it, vi } from "vitest";

import type { ProviderListItem } from "../providers/providers";
import {
  bootstrapDefaultProvider,
  fetchUserPreference,
  putDefaultProviderPreference,
  resolveDefaultProviderBootstrap,
  saveDefaultProviderSelection,
  syncDefaultProviderSelectionResult
} from "./default-provider-client";
import {
  DEFAULT_PROVIDER_STORAGE_KEY,
  type DefaultProviderStorage,
  writeStoredDefaultProvider
} from "./default-provider-storage";

const providers = [
  provider("provider-default", "Default", 20, true),
  provider("provider-local", "Local", 10, false),
  provider("provider-server", "Server", 30, false)
];

describe("default provider client", () => {
  it("gives a valid server user setting precedence over local state", () => {
    expect(
      resolveDefaultProviderBootstrap({
        providers,
        localProviderId: "provider-local",
        server: {
          status: "authenticated",
          preference: preference("provider-server", "user")
        }
      })
    ).toEqual({
      mode: "authenticated",
      selectedProviderId: "provider-server",
      removeLocalProviderId: "provider-local"
    });
  });

  it("seeds the server only when no user setting exists and local state is active", () => {
    expect(
      resolveDefaultProviderBootstrap({
        providers,
        localProviderId: "provider-local",
        server: {
          status: "authenticated",
          preference: preference("provider-default", "operational_default")
        }
      })
    ).toEqual({
      mode: "authenticated",
      selectedProviderId: "provider-local",
      persistLocalProviderId: "provider-local"
    });
  });

  it("restores guest local state and leaves it in storage", async () => {
    const storage = memoryStorage();
    writeStoredDefaultProvider(storage, "provider-local");
    const fetcher = vi.fn(async () => jsonResponse({}, 401)) as typeof fetch;

    await expect(
      bootstrapDefaultProvider({ providers, fetcher, storage })
    ).resolves.toEqual({
      mode: "guest",
      selectedProviderId: "provider-local",
      serverSync: "not_needed"
    });
    expect(storage.getItem(DEFAULT_PROVIDER_STORAGE_KEY)).not.toBeNull();
  });

  it("removes inactive local state and falls back to the operational default", async () => {
    const storage = memoryStorage();
    writeStoredDefaultProvider(storage, "provider-removed");
    const fetcher = vi.fn(async () => jsonResponse({}, 401)) as typeof fetch;

    await expect(
      bootstrapDefaultProvider({ providers, fetcher, storage })
    ).resolves.toEqual({
      mode: "guest",
      selectedProviderId: "provider-default",
      serverSync: "not_needed"
    });
    expect(storage.getItem(DEFAULT_PROVIDER_STORAGE_KEY)).toBeNull();
  });

  it("removes local state only after a successful server seed", async () => {
    const storage = memoryStorage();
    writeStoredDefaultProvider(storage, "provider-local");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(preference("provider-default", "operational_default"))
      )
      .mockResolvedValueOnce(
        jsonResponse(preference("provider-local", "user"))
      ) as typeof fetch;

    await expect(
      bootstrapDefaultProvider({ providers, fetcher, storage })
    ).resolves.toEqual({
      mode: "authenticated",
      selectedProviderId: "provider-local",
      serverSync: "succeeded"
    });
    expect(storage.getItem(DEFAULT_PROVIDER_STORAGE_KEY)).toBeNull();
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/user-preference/default-provider",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ provider_id: "provider-local" })
      })
    );
  });

  it("keeps local state and selection when the server seed fails", async () => {
    const storage = memoryStorage();
    writeStoredDefaultProvider(storage, "provider-local");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(preference("provider-default", "operational_default"))
      )
      .mockResolvedValueOnce(jsonResponse({}, 500)) as typeof fetch;

    await expect(
      bootstrapDefaultProvider({ providers, fetcher, storage })
    ).resolves.toEqual({
      mode: "authenticated",
      selectedProviderId: "provider-local",
      serverSync: "failed"
    });
    expect(storage.getItem(DEFAULT_PROVIDER_STORAGE_KEY)).not.toBeNull();
  });

  it("keeps local state when preference access is unavailable", async () => {
    const storage = memoryStorage();
    writeStoredDefaultProvider(storage, "provider-local");
    const fetcher = vi.fn(async () => {
      throw new Error("auth database unavailable");
    }) as typeof fetch;

    await expect(
      bootstrapDefaultProvider({ providers, fetcher, storage })
    ).resolves.toMatchObject({
      mode: "unavailable",
      selectedProviderId: "provider-local"
    });
    expect(storage.getItem(DEFAULT_PROVIDER_STORAGE_KEY)).not.toBeNull();
  });

  it("keeps an optimistic authenticated selection on PUT failure", async () => {
    const storage = memoryStorage();
    const fetcher = vi.fn(async () => jsonResponse({}, 500)) as typeof fetch;

    await expect(
      saveDefaultProviderSelection({
        providerId: "provider-server",
        mode: "authenticated",
        fetcher,
        storage
      })
    ).resolves.toBe(false);
    expect(storage.getItem(DEFAULT_PROVIDER_STORAGE_KEY)).not.toBeNull();
  });

  it("treats malformed successful preference payloads as unavailable", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ source: "user", default_provider: { id: "only-id" } })
    ) as typeof fetch;

    await expect(fetchUserPreference(fetcher)).resolves.toEqual({
      status: "unavailable"
    });
  });

  it("rejects a non-string preference source instead of coercing it", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        source: ["user"],
        default_provider: providers[0]
      })
    ) as typeof fetch;

    await expect(fetchUserPreference(fetcher)).resolves.toEqual({
      status: "unavailable"
    });
  });

  it("times out a pending preference read as unavailable", async () => {
    vi.useFakeTimers();

    try {
      const fetcher = abortablePendingFetch();
      const result = fetchUserPreference(fetcher, 25);

      await vi.advanceTimersByTimeAsync(25);

      await expect(result).resolves.toEqual({ status: "unavailable" });
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a pending preference write without removing local state", async () => {
    vi.useFakeTimers();

    try {
      const storage = memoryStorage();
      writeStoredDefaultProvider(storage, "provider-server");
      const fetcher = abortablePendingFetch();
      const result = putDefaultProviderPreference(
        "provider-server",
        fetcher,
        25
      );

      await vi.advanceTimersByTimeAsync(25);

      await expect(result).resolves.toBeUndefined();
      expect(storage.getItem(DEFAULT_PROVIDER_STORAGE_KEY)).not.toBeNull();
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a stale successful write remove local state", async () => {
    const storage = memoryStorage();
    writeStoredDefaultProvider(storage, "provider-server");
    const response = deferred<Response>();
    const fetcher = vi.fn(() => response.promise) as typeof fetch;
    let isCurrentRequest = true;

    const result = syncDefaultProviderSelectionResult({
      providerId: "provider-server",
      fetcher,
      storage,
      shouldApplyStorageMutation: () => isCurrentRequest
    });
    isCurrentRequest = false;
    response.resolve(jsonResponse(preference("provider-server", "user")));

    await expect(result).resolves.toBe("succeeded");
    expect(storage.getItem(DEFAULT_PROVIDER_STORAGE_KEY)).not.toBeNull();
  });
});

function provider(
  id: string,
  name: string,
  displayOrder: number,
  isDefault: boolean
): ProviderListItem {
  return {
    id,
    name,
    country: "KR",
    is_active: true,
    display_order: displayOrder,
    is_default: isDefault,
    last_catalog_updated_at: null
  };
}

function preference(
  providerId: string,
  source: "user" | "operational_default"
) {
  return {
    default_provider: providers.find(({ id }) => id === providerId) ?? null,
    source
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function memoryStorage(): DefaultProviderStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

function abortablePendingFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("request aborted")),
          { once: true }
        );
      })
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}
