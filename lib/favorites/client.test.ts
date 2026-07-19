import { describe, expect, it, vi } from "vitest";

import {
  FAVORITE_LIST_MAX_PAGES,
  FavoriteClientError,
  deleteFavorite,
  fetchAllFavoriteSongIds,
  fetchFavoritePage,
  putFavorite
} from "./client";

describe("favorite client", () => {
  it("validates a favorite page at runtime", async () => {
    await expect(
      fetchFavoritePage({
        fetcher: fetchOnce(jsonResponse(favoritePage("song-a")))
      })
    ).resolves.toMatchObject({
      items: [{ song_id: "song-a" }],
      next_cursor: null
    });

    await expect(
      fetchFavoritePage({
        fetcher: fetchOnce(
          jsonResponse({ items: [{ song_id: "song-a" }], next_cursor: null })
        )
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<FavoriteClientError>>({
        code: "INVALID_FAVORITE_RESPONSE"
      })
    );
  });

  it("sends required mutation headers and validates add/delete responses", async () => {
    const putFetcher = fetchOnce(
      jsonResponse({ favorite: true, created_at: "2026-07-19T00:00:00.000Z" })
    );
    const deleteFetcher = fetchOnce(jsonResponse({ favorite: false }));

    await putFavorite("song 가", { fetcher: putFetcher });
    await deleteFavorite("song-a", { fetcher: deleteFetcher });

    expect(putFetcher).toHaveBeenCalledWith(
      "/api/favorites/song%20%EA%B0%80",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-KNF-Request": "1"
        })
      })
    );
    expect(deleteFetcher).toHaveBeenCalledWith(
      "/api/favorites/song-a",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("preserves 401 and SONG_NOT_FOUND error classifications", async () => {
    await expect(
      deleteFavorite("song-a", {
        fetcher: fetchOnce(
          jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401)
        )
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<FavoriteClientError>>({
        code: "UNAUTHENTICATED",
        status: 401,
        retryable: false
      })
    );
    await expect(
      putFavorite("missing", {
        fetcher: fetchOnce(
          jsonResponse({ error: { code: "SONG_NOT_FOUND" } }, 404)
        )
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<FavoriteClientError>>({
        code: "SONG_NOT_FOUND",
        status: 404,
        retryable: false
      })
    );
  });

  it("caps full-list cursor traversal even when every cursor is unique", async () => {
    let pageNumber = 0;
    const fetcher = vi.fn(async () => {
      pageNumber += 1;
      return jsonResponse(
        favoritePage(`song-${pageNumber}`, `cursor-${pageNumber}`)
      );
    }) as unknown as typeof fetch;

    await expect(fetchAllFavoriteSongIds({ fetcher })).rejects.toEqual(
      expect.objectContaining<Partial<FavoriteClientError>>({
        code: "INVALID_FAVORITE_RESPONSE"
      })
    );
    expect(fetcher).toHaveBeenCalledTimes(FAVORITE_LIST_MAX_PAGES);
  });
});

export function favoritePage(songId: string, nextCursor: string | null = null) {
  return {
    items: [
      {
        song_id: songId,
        created_at: "2026-07-19T00:00:00.000Z",
        song: {
          id: songId,
          original_language: "ja",
          canonical_title: `Canonical ${songId}`,
          display_title: `Display ${songId}`,
          canonical_artist: "Artist",
          release_year: 2026,
          tie_in: null,
          karaoke_entries: [
            {
              id: `entry-${songId}`,
              provider_id: "provider-a",
              karaoke_number: "12345",
              version_info: "",
              availability_status: "available",
              last_verified_at: "2026-07-01",
              is_stale: false,
              provider: {
                id: "provider-a",
                name: "Provider A",
                country: "KR",
                is_active: true,
                display_order: 1,
                is_default: true,
                last_catalog_updated_at: null
              }
            }
          ],
          distinguishing_labels: ["Artist", "2026"]
        }
      }
    ],
    next_cursor: nextCursor
  };
}

function fetchOnce(response: Response) {
  return vi.fn(async () => response) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}
