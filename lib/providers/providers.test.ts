import { describe, expect, it } from "vitest";

import {
  listProviders,
  parseProviderListQuery,
  type ProviderDbClient
} from "./providers";

describe("parseProviderListQuery", () => {
  it("defaults to active providers only", () => {
    expect(parseProviderListQuery(new URLSearchParams())).toEqual({
      ok: true,
      query: { activeOnly: true }
    });
  });

  it("accepts active_only=false", () => {
    expect(
      parseProviderListQuery(new URLSearchParams("active_only=false"))
    ).toEqual({
      ok: true,
      query: { activeOnly: false }
    });
  });

  it("accepts uppercase alpha-2 country filters", () => {
    expect(parseProviderListQuery(new URLSearchParams("country=KR"))).toEqual({
      ok: true,
      query: { activeOnly: true, country: "KR" }
    });
  });

  it("rejects invalid active_only values", () => {
    expect(
      parseProviderListQuery(new URLSearchParams("active_only=yes"))
    ).toEqual({
      ok: false,
      code: "INVALID_QUERY",
      message: "active_only must be either true or false."
    });
  });

  it("rejects invalid country values", () => {
    expect(parseProviderListQuery(new URLSearchParams("country=kr"))).toEqual({
      ok: false,
      code: "INVALID_COUNTRY",
      message: "country must be an ISO 3166-1 alpha-2 uppercase code."
    });
  });
});

describe("listProviders", () => {
  it("returns active providers by default", async () => {
    const db = new FakeProviderDb([
      provider({ id: "provider_alpha", isActive: true }),
      provider({ id: "provider_beta", isActive: false })
    ]);

    await expect(listProviders(db)).resolves.toEqual([
      expect.objectContaining({
        id: "provider_alpha",
        is_active: true
      })
    ]);
    expect(db.findManyArgs?.where).toEqual({ isActive: true });
  });

  it("includes inactive providers when activeOnly is false", async () => {
    const db = new FakeProviderDb([
      provider({ id: "provider_alpha", isActive: true }),
      provider({ id: "provider_beta", isActive: false })
    ]);

    await expect(
      listProviders(db, { activeOnly: false })
    ).resolves.toHaveLength(2);
    expect(db.findManyArgs?.where).toEqual({});
  });

  it("applies country filters", async () => {
    const db = new FakeProviderDb([
      provider({ id: "provider_alpha", country: "KR" }),
      provider({ id: "provider_beta", country: "JP" })
    ]);

    await expect(
      listProviders(db, { activeOnly: true, country: "KR" })
    ).resolves.toEqual([
      expect.objectContaining({
        id: "provider_alpha",
        country: "KR"
      })
    ]);
    expect(db.findManyArgs?.where).toEqual({
      country: "KR",
      isActive: true
    });
  });

  it("uses display order with stable name and id tie-breakers", async () => {
    const db = new FakeProviderDb([
      provider({
        id: "provider_delta",
        name: "Generic Provider Delta",
        displayOrder: 20
      }),
      provider({
        id: "provider_gamma_2",
        name: "Generic Provider Gamma",
        displayOrder: 10
      }),
      provider({
        id: "provider_gamma_1",
        name: "Generic Provider Gamma",
        displayOrder: 10
      })
    ]);

    await expect(listProviders(db)).resolves.toEqual([
      expect.objectContaining({ id: "provider_gamma_1" }),
      expect.objectContaining({ id: "provider_gamma_2" }),
      expect.objectContaining({ id: "provider_delta" })
    ]);
    expect(db.findManyArgs?.orderBy).toEqual([
      { displayOrder: "asc" },
      { name: "asc" },
      { id: "asc" }
    ]);
  });

  it("maps public response fields without provider-name-specific logic", async () => {
    const db = new FakeProviderDb([
      provider({
        id: "provider_custom",
        name: "Generic Provider Custom",
        lastCatalogUpdatedAt: new Date("2026-06-01T00:00:00.000Z")
      })
    ]);

    await expect(listProviders(db)).resolves.toEqual([
      {
        id: "provider_custom",
        name: "Generic Provider Custom",
        country: "KR",
        is_active: true,
        display_order: 10,
        is_default: true,
        last_catalog_updated_at: "2026-06-01"
      }
    ]);
  });
});

type ProviderRecord = {
  id: string;
  name: string;
  country: string;
  isActive: boolean;
  displayOrder: number;
  isDefault: boolean;
  lastCatalogUpdatedAt: Date | string | null;
};

type FindManyArgs = Parameters<
  ProviderDbClient["karaokeProvider"]["findMany"]
>[0];

class FakeProviderDb implements ProviderDbClient {
  findManyArgs?: FindManyArgs;

  constructor(private readonly providers: ProviderRecord[]) {}

  readonly karaokeProvider = {
    findMany: async (args: FindManyArgs) => {
      this.findManyArgs = args;

      return this.providers
        .filter((row) => {
          if (
            args.where.country !== undefined &&
            row.country !== args.where.country
          ) {
            return false;
          }

          if (
            args.where.isActive !== undefined &&
            row.isActive !== args.where.isActive
          ) {
            return false;
          }

          return true;
        })
        .sort((left, right) => {
          return (
            left.displayOrder - right.displayOrder ||
            left.name.localeCompare(right.name) ||
            left.id.localeCompare(right.id)
          );
        });
    }
  };
}

function provider(overrides: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    id: "provider_alpha",
    name: "Generic Provider Alpha",
    country: "KR",
    isActive: true,
    displayOrder: 10,
    isDefault: true,
    lastCatalogUpdatedAt: null,
    ...overrides
  };
}
