export const DEFAULT_PROVIDER_ID_MAX_LENGTH = 128;

export type DefaultProviderCandidate = Readonly<{
  id: string;
  name: string;
  is_active: boolean;
  display_order: number;
  is_default: boolean;
}>;

export function isDefaultProviderId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    Array.from(value).length > 0 &&
    Array.from(value).length <= DEFAULT_PROVIDER_ID_MAX_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

export function findActiveProviderById<T extends DefaultProviderCandidate>(
  providers: readonly T[],
  providerId: string | undefined
): T | undefined {
  if (providerId === undefined) {
    return undefined;
  }

  return providers.find(
    (provider) => provider.is_active && provider.id === providerId
  );
}

export function selectOperationalDefaultProvider<
  T extends DefaultProviderCandidate
>(providers: readonly T[]): T | undefined {
  return [...providers]
    .filter((provider) => provider.is_active)
    .sort(compareOperationalProviders)[0];
}

function compareOperationalProviders(
  left: DefaultProviderCandidate,
  right: DefaultProviderCandidate
): number {
  if (left.is_default !== right.is_default) {
    return left.is_default ? -1 : 1;
  }

  return (
    left.display_order - right.display_order ||
    compareText(left.name, right.name) ||
    compareText(left.id, right.id)
  );
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}
