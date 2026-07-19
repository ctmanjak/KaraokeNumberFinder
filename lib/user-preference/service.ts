import { personalizationDomainError } from "../personalization";
import { selectOperationalDefaultProvider } from "../preferences/default-provider";

export type UserPreferenceOwner = Readonly<{ userId: string }>;
export type UserPreferenceDefaultProviderInput = Readonly<{
  userId: string;
  providerId: string | null;
}>;

export type UserPreferenceProviderRecord = Readonly<{
  id: string;
  name: string;
  country: string;
  isActive: boolean;
  displayOrder: number;
  isDefault: boolean;
  lastCatalogUpdatedAt: Date | string | null;
}>;

export type UserPreferenceRecord = Readonly<{
  defaultProvider: UserPreferenceProviderRecord | null;
}>;

export interface UserPreferenceRepository {
  find(owner: UserPreferenceOwner): Promise<UserPreferenceRecord | null>;
  listActiveProviders(): Promise<UserPreferenceProviderRecord[]>;
  setDefaultProvider(input: {
    userId: string;
    providerId: string;
  }): Promise<boolean>;
  clearDefaultProvider(owner: UserPreferenceOwner): Promise<void>;
}

export type UserPreferenceProvider = Readonly<{
  id: string;
  name: string;
  country: string;
  is_active: true;
  display_order: number;
  is_default: boolean;
  last_catalog_updated_at: string | null;
}>;

export type UserPreferenceReadModel = Readonly<{
  default_provider: UserPreferenceProvider | null;
  source: "user" | "operational_default" | "none";
}>;

export interface UserPreferenceService {
  get(owner: UserPreferenceOwner): Promise<UserPreferenceReadModel>;
  setDefaultProvider(
    input: UserPreferenceDefaultProviderInput
  ): Promise<UserPreferenceReadModel>;
}

export function createUserPreferenceService(
  repository: UserPreferenceRepository
): UserPreferenceService {
  const service: UserPreferenceService = {
    async get(owner) {
      const preference = await repository.find(owner);
      if (preference?.defaultProvider?.isActive) {
        return {
          default_provider: toProvider(preference.defaultProvider),
          source: "user"
        };
      }

      const operationalDefault = selectOperationalDefaultProvider(
        (await repository.listActiveProviders()).map(toCandidate)
      );

      if (operationalDefault === undefined) {
        return { default_provider: null, source: "none" };
      }

      return {
        default_provider: toProvider(operationalDefault.record),
        source: "operational_default"
      };
    },

    async setDefaultProvider(input) {
      if (input.providerId === null) {
        await repository.clearDefaultProvider({ userId: input.userId });
      } else {
        const stored = await repository.setDefaultProvider({
          userId: input.userId,
          providerId: input.providerId
        });

        if (!stored) {
          throw invalidProviderError();
        }
      }

      return service.get({ userId: input.userId });
    }
  };

  return service;
}

function toCandidate(record: UserPreferenceProviderRecord) {
  return {
    id: record.id,
    name: record.name,
    is_active: record.isActive,
    display_order: record.displayOrder,
    is_default: record.isDefault,
    record
  };
}

function toProvider(
  provider: UserPreferenceProviderRecord
): UserPreferenceProvider {
  return {
    id: provider.id,
    name: provider.name,
    country: provider.country,
    is_active: true,
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

function invalidProviderError() {
  return personalizationDomainError({
    code: "INVALID_PROVIDER",
    status: 422,
    publicMessage: "Provider is unavailable."
  });
}
