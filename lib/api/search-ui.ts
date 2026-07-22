import type { ProviderListItem } from "@/lib/providers/providers";
import { selectOperationalDefaultProvider } from "@/lib/preferences/default-provider";
import type { SearchResponse } from "@/lib/search/search";
import { createRequestTimeout } from "@/lib/http/client";

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

export const PROVIDER_REQUEST_TIMEOUT_MS = 5_000;

export async function fetchProviders(
  fetcher: typeof fetch = fetch,
  options: Readonly<{
    requestTimeoutMs?: number;
    signal?: AbortSignal;
  }> = {}
): Promise<ProviderListItem[]> {
  const fallback = "제공사 목록을 불러오지 못했습니다.";
  const request = createRequestTimeout(
    options.requestTimeoutMs ?? PROVIDER_REQUEST_TIMEOUT_MS,
    options.signal
  );

  try {
    const response = await fetcher("/api/providers", {
      signal: request.signal
    });

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
  } catch (error) {
    if (request.signal.aborted && options.signal?.aborted !== true) {
      throw new Error("제공사 목록 요청 시간이 초과되었습니다.");
    }
    throw error;
  } finally {
    request.clear();
  }
}

export async function fetchSearchResults(
  request: SearchRequest,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<SearchResponse> {
  const fallback = "검색 요청에 실패했습니다.";
  const params = new URLSearchParams({ q: request.query });

  if (request.providerId !== undefined && request.providerId.trim() !== "") {
    params.set("provider_id", request.providerId);
  }

  const url = `/api/search?${params.toString()}`;
  const response =
    signal === undefined ? await fetcher(url) : await fetcher(url, { signal });

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
  return selectOperationalDefaultProvider(providers)?.id;
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
