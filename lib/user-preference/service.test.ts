import { describe, expect, it, vi } from "vitest";

import { PersonalizationApiError } from "../personalization";
import {
  createUserPreferenceService,
  type UserPreferenceProviderRecord,
  type UserPreferenceRepository
} from "./service";

describe("user preference service", () => {
  it("returns the authenticated user's active stored provider", async () => {
    const stored = provider("provider-user", "User Provider", 99, false);
    const repository = repositoryStub({
      find: vi.fn(async () => ({ defaultProvider: stored }))
    });
    const service = createUserPreferenceService(repository);

    await expect(service.get({ userId: "user-a" })).resolves.toEqual({
      default_provider: apiProvider(stored),
      source: "user"
    });
    expect(repository.find).toHaveBeenCalledWith({ userId: "user-a" });
    expect(repository.listActiveProviders).not.toHaveBeenCalled();
  });

  it("falls back without persisting when the stored provider is inactive", async () => {
    const fallback = provider("provider-default", "Default", 10, true);
    const repository = repositoryStub({
      find: vi.fn(async () => ({
        defaultProvider: provider(
          "provider-disabled",
          "Disabled",
          1,
          true,
          false
        )
      })),
      listActiveProviders: vi.fn(async () => [fallback])
    });
    const service = createUserPreferenceService(repository);

    await expect(service.get({ userId: "user-a" })).resolves.toEqual({
      default_provider: apiProvider(fallback),
      source: "operational_default"
    });
    expect(repository.setDefaultProvider).not.toHaveBeenCalled();
    expect(repository.clearDefaultProvider).not.toHaveBeenCalled();
  });

  it("selects among multiple active defaults deterministically", async () => {
    const repository = repositoryStub({
      listActiveProviders: vi.fn(async () => [
        provider("provider-z", "Zulu", 5, true),
        provider("provider-b", "Beta", 1, true),
        provider("provider-a", "Alpha", 1, true),
        provider("provider-first", "First", 0, false)
      ])
    });
    const service = createUserPreferenceService(repository);

    const response = await service.get({ userId: "user-a" });

    expect(response.default_provider?.id).toBe("provider-a");
    expect(response.source).toBe("operational_default");
  });

  it("uses the first active provider when no default exists", async () => {
    const repository = repositoryStub({
      listActiveProviders: vi.fn(async () => [
        provider("provider-z", "Zulu", 20, false),
        provider("provider-a", "Alpha", 10, false)
      ])
    });
    const service = createUserPreferenceService(repository);

    await expect(service.get({ userId: "user-a" })).resolves.toMatchObject({
      default_provider: { id: "provider-a" },
      source: "operational_default"
    });
  });

  it("returns none when no active provider exists", async () => {
    const service = createUserPreferenceService(repositoryStub());

    await expect(service.get({ userId: "user-a" })).resolves.toEqual({
      default_provider: null,
      source: "none"
    });
  });

  it("stores an active provider and then returns the latest read model", async () => {
    const stored = provider("provider-selected", "Selected", 10, false);
    const repository = repositoryStub({
      setDefaultProvider: vi.fn(async () => true),
      find: vi.fn().mockResolvedValueOnce({ defaultProvider: stored })
    });
    const service = createUserPreferenceService(repository);

    await expect(
      service.setDefaultProvider({
        userId: "user-a",
        providerId: "provider-selected"
      })
    ).resolves.toEqual({
      default_provider: apiProvider(stored),
      source: "user"
    });
    expect(repository.setDefaultProvider).toHaveBeenCalledWith({
      userId: "user-a",
      providerId: "provider-selected"
    });
  });

  it("clears an explicit setting and returns fallback without recreating it", async () => {
    const fallback = provider("provider-default", "Default", 10, true);
    const repository = repositoryStub({
      listActiveProviders: vi.fn(async () => [fallback])
    });
    const service = createUserPreferenceService(repository);

    await expect(
      service.setDefaultProvider({ userId: "user-a", providerId: null })
    ).resolves.toMatchObject({
      default_provider: { id: "provider-default" },
      source: "operational_default"
    });
    expect(repository.clearDefaultProvider).toHaveBeenCalledWith({
      userId: "user-a"
    });
    expect(repository.setDefaultProvider).not.toHaveBeenCalled();
  });

  it("maps missing or inactive providers to the fixed domain error", async () => {
    const repository = repositoryStub({
      setDefaultProvider: vi.fn(async () => false)
    });
    const service = createUserPreferenceService(repository);

    await expect(
      service.setDefaultProvider({
        userId: "user-a",
        providerId: "provider-invalid"
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<PersonalizationApiError>>({
        code: "INVALID_PROVIDER",
        status: 422,
        message: "Provider is unavailable."
      })
    );
    expect(repository.find).not.toHaveBeenCalled();
  });
});

function repositoryStub(
  overrides: Partial<UserPreferenceRepository> = {}
): UserPreferenceRepository {
  return {
    find: vi.fn(async () => null),
    listActiveProviders: vi.fn(async () => []),
    setDefaultProvider: vi.fn(async () => true),
    clearDefaultProvider: vi.fn(async () => undefined),
    ...overrides
  };
}

function provider(
  id: string,
  name: string,
  displayOrder: number,
  isDefault: boolean,
  isActive = true
): UserPreferenceProviderRecord {
  return {
    id,
    name,
    country: "KR",
    isActive,
    displayOrder,
    isDefault,
    lastCatalogUpdatedAt: new Date("2026-07-01T00:00:00.000Z")
  };
}

function apiProvider(record: UserPreferenceProviderRecord) {
  return {
    id: record.id,
    name: record.name,
    country: record.country,
    is_active: true,
    display_order: record.displayOrder,
    is_default: record.isDefault,
    last_catalog_updated_at: "2026-07-01"
  };
}
