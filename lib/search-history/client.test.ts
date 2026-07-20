import { describe, expect, it, vi } from "vitest";

import {
  SearchHistoryClientError,
  clearServerSearchHistory,
  createSearchHistoryMergeId,
  deleteServerSearchHistoryItem,
  fetchServerSearchHistory,
  isUnauthenticatedSearchHistoryError,
  mergeServerSearchHistory,
  postServerSearchHistory
} from "./client";

const MERGE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const ITEM_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const SEARCHED_AT = "2026-07-20T01:00:00.000Z";

describe("search history client", () => {
  it("validates authenticated GET and POST payloads at runtime", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [serverItem()] }))
      .mockResolvedValueOnce(jsonResponse({ item: serverItem() }));

    await expect(fetchServerSearchHistory(fetcher)).resolves.toEqual([
      serverItem()
    ]);
    await expect(postServerSearchHistory("Hello", fetcher)).resolves.toEqual(
      serverItem()
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/search-history",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-knf-request": "1"
        }),
        body: JSON.stringify({ query: "Hello" }),
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("does not interpret 503 or malformed JSON as a guest session", async () => {
    const unavailable = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errorResponse(503, "PERSONALIZATION_UNAVAILABLE"));
    const malformed = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ items: [{ ...serverItem(), searched_at: "invalid" }] })
      );

    const unavailableError = await fetchServerSearchHistory(unavailable).catch(
      (error: unknown) => error
    );
    expect(unavailableError).toBeInstanceOf(SearchHistoryClientError);
    expect(unavailableError).toMatchObject({ status: 503, retryable: true });
    expect(isUnauthenticatedSearchHistoryError(unavailableError)).toBe(false);
    await expect(fetchServerSearchHistory(malformed)).rejects.toMatchObject({
      code: "INVALID_SEARCH_HISTORY_RESPONSE"
    });
  });

  it("interprets only 401 as unauthenticated or expired", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errorResponse(401, "UNAUTHENTICATED"));

    const error = await fetchServerSearchHistory(fetcher).catch(
      (caught: unknown) => caught
    );
    expect(isUnauthenticatedSearchHistoryError(error)).toBe(true);
    expect(error).toMatchObject({ status: 401, retryable: false });
  });

  it("sends one merge request with the stable merge id and original timestamps", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        merged: true,
        recent_searches: [serverItem()],
        default_provider: { default_provider: null, source: "none" }
      })
    );
    const local = [
      {
        query: "Hello",
        normalized_query: "hello",
        searched_at: SEARCHED_AT
      }
    ];

    await expect(
      mergeServerSearchHistory({
        mergeId: MERGE_ID,
        recentSearches: local,
        fetcher
      })
    ).resolves.toEqual([serverItem()]);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/user-data/merge",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          merge_id: MERGE_ID,
          recent_searches: [{ query: "Hello", searched_at: SEARCHED_AT }]
        })
      })
    );
    expect(createSearchHistoryMergeId(() => MERGE_ID)).toBe(MERGE_ID);
  });

  it("validates individual and full delete responses", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ deleted_count: 1 }))
      .mockResolvedValueOnce(jsonResponse({ deleted_count: 4 }));

    await expect(deleteServerSearchHistoryItem(ITEM_ID, fetcher)).resolves.toBe(
      1
    );
    await expect(clearServerSearchHistory(fetcher)).resolves.toBe(4);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      `/api/search-history/${ITEM_ID}`,
      expect.objectContaining({ method: "DELETE" })
    );
  });
});

function serverItem() {
  return {
    id: ITEM_ID,
    query: "Hello",
    normalized_query: "hello",
    searched_at: SEARCHED_AT
  };
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body
  } as Response;
}

function errorResponse(status: number, code: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code, message: "safe" } })
  } as Response;
}
