import { describe, expect, it, vi } from "vitest";

import {
  AdminSongRepositoryError,
  type AdminSongRepository
} from "./repository";
import { decodeAdminSongCursor } from "./cursor";
import { createAdminSongService } from "./service";

describe("admin song service", () => {
  it("returns dynamic provider and enum options after authorization", async () => {
    const repository = stubRepository();
    const options =
      await createAdminSongService(repository).getOptions("admin-a");

    expect(repository.getOptions).toHaveBeenCalledWith("admin-a");
    expect(options.providers).toEqual([
      { id: "tj", name: "TJ", country: "KR" }
    ]);
    expect(options.alias_types).toContain("translated_title");
    expect(options.availability_statuses).toContain("not_available");
  });

  it.each([
    ["FORBIDDEN", "FORBIDDEN", 403],
    ["DUPLICATE_SONG", "DUPLICATE_SONG", 409],
    ["PROVIDER_NOT_FOUND", "PROVIDER_NOT_FOUND", 422],
    ["CONFLICT", "SONG_CONFLICT", 409]
  ] as const)("maps %s safely", async (repositoryCode, apiCode, status) => {
    const repository = stubRepository({
      create: vi.fn(async () => {
        throw new AdminSongRepositoryError(repositoryCode);
      })
    });

    await expect(
      createAdminSongService(repository).create("admin-a", {} as never)
    ).rejects.toMatchObject({ code: apiCode, status });
  });

  it("encodes the repository continuation key with the query scope", async () => {
    const nextCursorKey = {
      updatedAt: "2026-07-26T00:00:00.000123Z",
      id: "song-next"
    };
    const repository = stubRepository({
      list: vi.fn(async () => ({ items: [], nextCursorKey }))
    });
    const response = await createAdminSongService(repository).list("admin-a", {
      query: "Query",
      normalizedQuery: "query",
      cursor: null,
      limit: 20
    });

    expect(response.next_cursor).not.toBeNull();
    expect(
      decodeAdminSongCursor(response.next_cursor as string, "query")
    ).toEqual(nextCursorKey);
  });
});

function stubRepository(
  patch: Partial<AdminSongRepository> = {}
): AdminSongRepository {
  return {
    getOptions: vi.fn(async () => [{ id: "tj", name: "TJ", country: "KR" }]),
    list: vi.fn(async () => ({ items: [], nextCursorKey: null })),
    create: vi.fn(async () => ({
      song: { id: "song-a", display_title: "Song", canonical_artist: "Artist" },
      alias_count: 3,
      karaoke_entry_count: 1,
      created_counts: {
        songs: 1,
        administrator_aliases: 0,
        karaoke_entries: 1
      }
    })),
    ...patch
  };
}
