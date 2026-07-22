import type { ProviderListItem } from "../providers/providers";
import { createRequestTimeout, readJson } from "../http/client";
import {
  findActiveProviderById,
  isDefaultProviderId,
  selectOperationalDefaultProvider
} from "./default-provider";
import {
  getBrowserDefaultProviderStorage,
  readStoredDefaultProvider,
  removeStoredDefaultProvider,
  type DefaultProviderStorage,
  writeStoredDefaultProvider
} from "./default-provider-storage";

export type DefaultProviderPersistenceMode =
  "authenticated" | "guest" | "unavailable";

export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 5_000;

export type UserPreferenceReadModel = Readonly<{
  default_provider: ProviderListItem | null;
  source: "user" | "operational_default" | "none";
}>;

export type UserPreferenceFetchResult =
  | Readonly<{
      status: "authenticated";
      preference: UserPreferenceReadModel;
    }>
  | Readonly<{ status: "guest" | "unavailable" }>;

export type UserPreferenceMutationResult = UserPreferenceFetchResult;

export type DefaultProviderBootstrapDecision = Readonly<{
  mode: DefaultProviderPersistenceMode;
  selectedProviderId: string | undefined;
  persistLocalProviderId?: string;
  removeLocalProviderId?: string;
}>;

export type DefaultProviderBootstrapResult = Readonly<{
  mode: DefaultProviderPersistenceMode;
  selectedProviderId: string | undefined;
  serverSync: "not_needed" | "succeeded" | "failed";
}>;

export async function bootstrapDefaultProvider(options: {
  providers: readonly ProviderListItem[];
  authStatus?: "authenticated" | "guest" | "unavailable" | "expired";
  fetcher?: typeof fetch;
  storage?: DefaultProviderStorage;
  requestTimeoutMs?: number;
  shouldApplyStorageMutation?: () => boolean;
}): Promise<DefaultProviderBootstrapResult> {
  const fetcher = options.fetcher ?? fetch;
  const storage = options.storage ?? getBrowserDefaultProviderStorage();
  const storedProviderId = readStoredDefaultProvider(storage);
  const activeStoredProvider = findActiveProviderById(
    options.providers,
    storedProviderId
  );

  if (storedProviderId !== undefined && activeStoredProvider === undefined) {
    removeStoredDefaultProvider(storage, storedProviderId);
  }

  const activeLocalProviderId = activeStoredProvider?.id;
  const server =
    options.authStatus === "guest" || options.authStatus === "expired"
      ? ({ status: "guest" } as const)
      : options.authStatus === "unavailable"
        ? ({ status: "unavailable" } as const)
        : await fetchUserPreference(
            fetcher,
            options.requestTimeoutMs ?? DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS
          );
  const decision = resolveDefaultProviderBootstrap({
    providers: options.providers,
    localProviderId: activeLocalProviderId,
    server
  });

  if (
    decision.removeLocalProviderId !== undefined &&
    (options.shouldApplyStorageMutation?.() ?? true)
  ) {
    removeStoredDefaultProvider(storage, decision.removeLocalProviderId);
  }

  if (decision.persistLocalProviderId === undefined) {
    return {
      mode: decision.mode,
      selectedProviderId: decision.selectedProviderId,
      serverSync: "not_needed"
    };
  }

  const persisted = await putDefaultProviderPreferenceResult(
    decision.persistLocalProviderId,
    fetcher,
    options.requestTimeoutMs ?? DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS
  );

  if (
    persisted.status === "authenticated" &&
    persisted.preference.source === "user" &&
    persisted.preference.default_provider?.id ===
      decision.persistLocalProviderId
  ) {
    if (options.shouldApplyStorageMutation?.() ?? true) {
      removeStoredDefaultProvider(storage, decision.persistLocalProviderId);
    }
    return {
      mode: "authenticated",
      selectedProviderId: decision.persistLocalProviderId,
      serverSync: "succeeded"
    };
  }

  return {
    mode: persisted.status === "guest" ? "guest" : "authenticated",
    selectedProviderId: decision.persistLocalProviderId,
    serverSync: "failed"
  };
}

export function resolveDefaultProviderBootstrap(options: {
  providers: readonly ProviderListItem[];
  localProviderId: string | undefined;
  server: UserPreferenceFetchResult;
}): DefaultProviderBootstrapDecision {
  const operationalDefault = selectOperationalDefaultProvider(
    options.providers
  );
  const localProvider = findActiveProviderById(
    options.providers,
    options.localProviderId
  );

  if (options.server.status !== "authenticated") {
    return {
      mode: options.server.status,
      selectedProviderId: localProvider?.id ?? operationalDefault?.id
    };
  }

  const serverPreference = options.server.preference;
  const serverProvider = findActiveProviderById(
    options.providers,
    serverPreference.default_provider?.id
  );

  if (serverPreference.source === "user") {
    if (serverProvider === undefined) {
      return {
        mode: "unavailable",
        selectedProviderId: localProvider?.id ?? operationalDefault?.id
      };
    }

    return {
      mode: "authenticated",
      selectedProviderId: serverProvider.id,
      ...(localProvider === undefined
        ? {}
        : { removeLocalProviderId: localProvider.id })
    };
  }

  if (localProvider !== undefined) {
    return {
      mode: "authenticated",
      selectedProviderId: localProvider.id,
      persistLocalProviderId: localProvider.id
    };
  }

  return {
    mode: "authenticated",
    selectedProviderId: serverProvider?.id ?? operationalDefault?.id
  };
}

export async function saveDefaultProviderSelection(options: {
  providerId: string;
  mode: DefaultProviderPersistenceMode | "unknown";
  fetcher?: typeof fetch;
  storage?: DefaultProviderStorage;
  requestTimeoutMs?: number;
}): Promise<boolean> {
  const storage = options.storage ?? getBrowserDefaultProviderStorage();
  saveDefaultProviderSelectionLocally(options.providerId, storage);

  if (options.mode !== "authenticated") {
    return options.mode !== "unavailable";
  }

  return syncDefaultProviderSelection({
    providerId: options.providerId,
    fetcher: options.fetcher,
    storage,
    requestTimeoutMs: options.requestTimeoutMs
  });
}

export function saveDefaultProviderSelectionLocally(
  providerId: string,
  storage:
    DefaultProviderStorage | undefined = getBrowserDefaultProviderStorage()
): boolean {
  return writeStoredDefaultProvider(storage, providerId);
}

export async function syncDefaultProviderSelection(options: {
  providerId: string;
  fetcher?: typeof fetch;
  storage?: DefaultProviderStorage;
  requestTimeoutMs?: number;
  shouldApplyStorageMutation?: () => boolean;
}): Promise<boolean> {
  return (await syncDefaultProviderSelectionResult(options)) === "succeeded";
}

export async function syncDefaultProviderSelectionResult(options: {
  providerId: string;
  fetcher?: typeof fetch;
  storage?: DefaultProviderStorage;
  requestTimeoutMs?: number;
  shouldApplyStorageMutation?: () => boolean;
}): Promise<"succeeded" | "guest" | "unavailable"> {
  const storage = options.storage ?? getBrowserDefaultProviderStorage();
  const persisted = await putDefaultProviderPreferenceResult(
    options.providerId,
    options.fetcher ?? fetch,
    options.requestTimeoutMs ?? DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS
  );
  const succeeded =
    persisted.status === "authenticated" &&
    persisted.preference.source === "user" &&
    persisted.preference.default_provider?.id === options.providerId;

  if (succeeded && (options.shouldApplyStorageMutation?.() ?? true)) {
    removeStoredDefaultProvider(storage, options.providerId);
  }

  return succeeded
    ? "succeeded"
    : persisted.status === "guest"
      ? "guest"
      : "unavailable";
}

export async function fetchUserPreference(
  fetcher: typeof fetch = fetch,
  requestTimeoutMs = DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS
): Promise<UserPreferenceFetchResult> {
  const request = createRequestTimeout(requestTimeoutMs);

  try {
    const response = await fetcher("/api/user-preference", {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: request.signal
    });

    if (response.status === 401) {
      return { status: "guest" };
    }

    if (!response.ok) {
      return { status: "unavailable" };
    }

    const payload = await readJson(response);
    return isUserPreferenceReadModel(payload)
      ? { status: "authenticated", preference: payload }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  } finally {
    request.clear();
  }
}

export async function putDefaultProviderPreference(
  providerId: string | null,
  fetcher: typeof fetch = fetch,
  requestTimeoutMs = DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS
): Promise<UserPreferenceReadModel | undefined> {
  const result = await putDefaultProviderPreferenceResult(
    providerId,
    fetcher,
    requestTimeoutMs
  );
  return result.status === "authenticated" ? result.preference : undefined;
}

export async function putDefaultProviderPreferenceResult(
  providerId: string | null,
  fetcher: typeof fetch = fetch,
  requestTimeoutMs = DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS
): Promise<UserPreferenceMutationResult> {
  const request = createRequestTimeout(requestTimeoutMs);

  try {
    const response = await fetcher("/api/user-preference/default-provider", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-knf-request": "1"
      },
      body: JSON.stringify({ provider_id: providerId }),
      signal: request.signal
    });

    if (response.status === 401) {
      return { status: "guest" };
    }

    if (!response.ok) {
      return { status: "unavailable" };
    }

    const payload = await readJson(response);
    return isUserPreferenceReadModel(payload)
      ? { status: "authenticated", preference: payload }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  } finally {
    request.clear();
  }
}

function isUserPreferenceReadModel(
  value: unknown
): value is UserPreferenceReadModel {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !("source" in value) ||
    typeof value.source !== "string" ||
    !["user", "operational_default", "none"].includes(value.source) ||
    !("default_provider" in value)
  ) {
    return false;
  }

  if (value.default_provider === null) {
    return value.source === "none";
  }

  return isProvider(value.default_provider) && value.source !== "none";
}

function isProvider(value: unknown): value is ProviderListItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const provider = value as Record<string, unknown>;
  return (
    Object.keys(provider).length === 7 &&
    isDefaultProviderId(provider.id) &&
    typeof provider.name === "string" &&
    provider.name.trim().length > 0 &&
    typeof provider.country === "string" &&
    /^[A-Z]{2}$/u.test(provider.country) &&
    provider.is_active === true &&
    typeof provider.display_order === "number" &&
    Number.isInteger(provider.display_order) &&
    typeof provider.is_default === "boolean" &&
    (provider.last_catalog_updated_at === null ||
      (typeof provider.last_catalog_updated_at === "string" &&
        /^\d{4}-\d{2}-\d{2}$/u.test(provider.last_catalog_updated_at)))
  );
}
