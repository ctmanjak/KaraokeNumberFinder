import type { ProviderListItem } from "@/lib/providers/providers";
import type { SearchResponse } from "@/lib/search/search";

export type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

export type SearchRequest = {
  query: string;
  providerId?: string;
};

export async function fetchProviders(
  fetcher: typeof fetch = fetch
): Promise<ProviderListItem[]> {
  const fallback = "제공사 목록을 불러오지 못했습니다.";
  const response = await fetcher("/api/providers");

  if (!response.ok) {
    throw new Error(errorMessage(await readJson(response), fallback));
  }

  const payload = (await readJson(response)) as
    { items?: ProviderListItem[] } | null | undefined;

  if (payload === undefined || payload === null) {
    throw new Error(fallback);
  }

  return typeof payload === "object" &&
    "items" in payload &&
    Array.isArray(payload.items)
    ? payload.items
    : [];
}

export async function fetchSearchResults(
  request: SearchRequest,
  fetcher: typeof fetch = fetch
): Promise<SearchResponse> {
  const fallback = "검색 요청에 실패했습니다.";
  const params = new URLSearchParams({ q: request.query });

  if (request.providerId !== undefined && request.providerId.trim() !== "") {
    params.set("provider_id", request.providerId);
  }

  const response = await fetcher(`/api/search?${params.toString()}`);

  if (!response.ok) {
    throw new Error(errorMessage(await readJson(response), fallback));
  }

  const payload = (await readJson(response)) as
    SearchResponse | null | undefined;

  if (payload === undefined || payload === null) {
    throw new Error(fallback);
  }

  return payload;
}

export function selectInitialProvider(
  providers: ProviderListItem[]
): string | undefined {
  return (
    providers.find((provider) => provider.is_default && provider.is_active)
      ?.id ??
    providers.find((provider) => provider.is_active)?.id ??
    providers[0]?.id
  );
}

function errorMessage(payload: unknown, fallback: string): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }

  return fallback;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
