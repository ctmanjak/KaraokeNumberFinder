import { isDefaultProviderId } from "./default-provider";

export const DEFAULT_PROVIDER_STORAGE_KEY = "knf:v1:default-provider";
export const DEFAULT_PROVIDER_STORAGE_VERSION = 1;

export type DefaultProviderStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

type StoredDefaultProvider = Readonly<{
  version: typeof DEFAULT_PROVIDER_STORAGE_VERSION;
  provider_id: string;
}>;

export function getBrowserDefaultProviderStorage():
  DefaultProviderStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readStoredDefaultProvider(
  storage: DefaultProviderStorage | undefined
): string | undefined {
  if (storage === undefined) {
    return undefined;
  }

  let rawValue: string | null;
  try {
    rawValue = storage.getItem(DEFAULT_PROVIDER_STORAGE_KEY);
  } catch {
    return undefined;
  }

  if (rawValue === null) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (!isStoredDefaultProvider(parsed)) {
      safelyRemove(storage);
      return undefined;
    }

    return parsed.provider_id;
  } catch {
    safelyRemove(storage);
    return undefined;
  }
}

export function writeStoredDefaultProvider(
  storage: DefaultProviderStorage | undefined,
  providerId: string
): boolean {
  if (storage === undefined || !isDefaultProviderId(providerId)) {
    return false;
  }

  const value: StoredDefaultProvider = {
    version: DEFAULT_PROVIDER_STORAGE_VERSION,
    provider_id: providerId
  };

  try {
    storage.setItem(DEFAULT_PROVIDER_STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeStoredDefaultProvider(
  storage: DefaultProviderStorage | undefined,
  expectedProviderId?: string
): boolean {
  if (storage === undefined) {
    return false;
  }

  if (
    expectedProviderId !== undefined &&
    readStoredDefaultProvider(storage) !== expectedProviderId
  ) {
    return false;
  }

  return safelyRemove(storage);
}

function isStoredDefaultProvider(
  value: unknown
): value is StoredDefaultProvider {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    "version" in value &&
    value.version === DEFAULT_PROVIDER_STORAGE_VERSION &&
    "provider_id" in value &&
    isDefaultProviderId(value.provider_id)
  );
}

function safelyRemove(storage: DefaultProviderStorage): boolean {
  try {
    storage.removeItem(DEFAULT_PROVIDER_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
