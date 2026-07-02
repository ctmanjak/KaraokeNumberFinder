export type ProviderListQuery = {
  activeOnly: boolean;
  country?: string;
};

export type ProviderListItem = {
  id: string;
  name: string;
  country: string;
  is_active: boolean;
  display_order: number;
  is_default: boolean;
  last_catalog_updated_at: string | null;
};

export type ProviderQueryErrorCode = "INVALID_QUERY" | "INVALID_COUNTRY";

export type ProviderQueryParseResult =
  | { ok: true; query: ProviderListQuery }
  | { ok: false; code: ProviderQueryErrorCode; message: string };

type ProviderRecord = {
  id: string;
  name: string;
  country: string;
  isActive: boolean;
  displayOrder: number;
  isDefault: boolean;
  lastCatalogUpdatedAt: Date | string | null;
};

export type ProviderDbClient = {
  karaokeProvider: {
    findMany(args: {
      where: {
        country?: string;
        isActive?: boolean;
      };
      orderBy: Array<{ displayOrder: "asc" } | { name: "asc" } | { id: "asc" }>;
      select: {
        id: true;
        name: true;
        country: true;
        isActive: true;
        displayOrder: true;
        isDefault: true;
        lastCatalogUpdatedAt: true;
      };
    }): Promise<ProviderRecord[]>;
  };
};

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

export function parseProviderListQuery(
  searchParams: URLSearchParams
): ProviderQueryParseResult {
  const activeOnlyValue = searchParams.get("active_only");
  const countryValue = searchParams.get("country");

  if (
    activeOnlyValue !== null &&
    activeOnlyValue !== "true" &&
    activeOnlyValue !== "false"
  ) {
    return {
      ok: false,
      code: "INVALID_QUERY",
      message: "active_only must be either true or false."
    };
  }

  if (countryValue !== null && !COUNTRY_CODE_PATTERN.test(countryValue)) {
    return {
      ok: false,
      code: "INVALID_COUNTRY",
      message: "country must be an ISO 3166-1 alpha-2 uppercase code."
    };
  }

  return {
    ok: true,
    query: {
      activeOnly: activeOnlyValue !== "false",
      ...(countryValue === null ? {} : { country: countryValue })
    }
  };
}

export async function listProviders(
  db: ProviderDbClient,
  query: ProviderListQuery = { activeOnly: true }
): Promise<ProviderListItem[]> {
  const providers = await db.karaokeProvider.findMany({
    where: {
      ...(query.country === undefined ? {} : { country: query.country }),
      ...(query.activeOnly ? { isActive: true } : {})
    },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      country: true,
      isActive: true,
      displayOrder: true,
      isDefault: true,
      lastCatalogUpdatedAt: true
    }
  });

  return providers.map(toProviderListItem);
}

function toProviderListItem(provider: ProviderRecord): ProviderListItem {
  return {
    id: provider.id,
    name: provider.name,
    country: provider.country,
    is_active: provider.isActive,
    display_order: provider.displayOrder,
    is_default: provider.isDefault,
    last_catalog_updated_at: formatNullableDate(provider.lastCatalogUpdatedAt)
  };
}

function formatNullableDate(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value;
}
