import { describe, expect, it, vi } from "vitest";

import { PersonalizationApiError } from "../personalization";
import { decodeFavoriteCursor } from "./cursor";
import {
  createFavoriteService,
  type FavoriteListRecord,
  type FavoriteRepository
} from "./service";

describe("favorite service", () => {
  it("creates a stable cursor when JavaScript dates cannot distinguish DB precision", async () => {
    const records = [
      favoriteRecord(
        "ffffffff-ffff-4fff-bfff-ffffffffffff",
        "song-c",
        "2026-07-19T03:00:00.123Z"
      ),
      favoriteRecord(
        "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
        "song-b",
        "2026-07-19T03:00:00.123Z"
      ),
      favoriteRecord(
        "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        "song-a",
        "2026-07-19T01:00:00.000Z"
      )
    ];
    const repository = repositoryStub({ listPage: vi.fn(async () => records) });
    const service = createFavoriteService(repository, {
      now: () => new Date("2026-07-19T00:00:00.000Z")
    });

    const response = await service.list({ userId: "user-a" }, { limit: 2 });

    expect(repository.listPage).toHaveBeenCalledWith({
      owner: { userId: "user-a" },
      take: 3
    });
    expect(response.items.map((item) => item.song_id)).toEqual([
      "song-c",
      "song-b"
    ]);
    expect(response.items[0]).toMatchObject({
      created_at: "2026-07-19T03:00:00.123Z",
      song: {
        id: "song-c",
        original_language: "ja",
        canonical_title: "Canonical song-c",
        display_title: "Display song-c",
        canonical_artist: "Artist",
        karaoke_entries: [
          {
            provider_id: "provider-a",
            last_verified_at: "2026-01-01",
            is_stale: true,
            provider: {
              id: "provider-a",
              is_active: true,
              display_order: 1
            }
          }
        ],
        distinguishing_labels: ["Artist", "Anime", "2026"]
      }
    });
    expect(response.next_cursor).not.toBeNull();
    expect(decodeFavoriteCursor(response.next_cursor!)).toEqual({
      id: records[1].id
    });
  });

  it("decodes the cursor before the repository query and ends the last page", async () => {
    const first = favoriteRecord(
      "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      "song-b",
      "2026-07-19T02:00:00.000Z"
    );
    const repository = repositoryStub({ listPage: vi.fn(async () => [first]) });
    const service = createFavoriteService(repository);
    const firstPageRepository = repositoryStub({
      listPage: vi.fn(async () => [
        first,
        favoriteRecord(
          "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
          "song-a",
          "2026-07-19T01:00:00.000Z"
        )
      ])
    });
    const cursor = (
      await createFavoriteService(firstPageRepository).list(
        { userId: "user-a" },
        { limit: 1 }
      )
    ).next_cursor!;

    const response = await service.list(
      { userId: "user-a" },
      { limit: 20, cursor }
    );

    expect(repository.listPage).toHaveBeenCalledWith({
      owner: { userId: "user-a" },
      cursor: {
        id: first.id
      },
      take: 21
    });
    expect(response.next_cursor).toBeNull();
  });

  it("returns the same successful representation for repeated adds", async () => {
    const createdAt = new Date("2026-07-19T04:00:00.000Z");
    const repository = repositoryStub({
      add: vi.fn(async () => ({
        status: "ok" as const,
        favorite: { createdAt }
      }))
    });
    const service = createFavoriteService(repository);
    const identity = { userId: "user-a", songId: "song-a" };

    const [first, second] = await Promise.all([
      service.add(identity),
      service.add(identity)
    ]);

    expect(first).toEqual({
      favorite: true,
      created_at: createdAt.toISOString()
    });
    expect(second).toEqual(first);
  });

  it("maps a missing song to the fixed SONG_NOT_FOUND domain error", async () => {
    const service = createFavoriteService(
      repositoryStub({
        add: vi.fn(async () => ({ status: "song_not_found" as const }))
      })
    );

    await expect(
      service.add({ userId: "user-a", songId: "missing" })
    ).rejects.toEqual(
      expect.objectContaining<Partial<PersonalizationApiError>>({
        code: "SONG_NOT_FOUND",
        status: 404,
        message: "Song was not found."
      })
    );
  });

  it("keeps delete idempotent", async () => {
    const repository = repositoryStub({ delete: vi.fn(async () => undefined) });
    const service = createFavoriteService(repository);
    const identity = { userId: "user-a", songId: "song-a" };

    await expect(service.delete(identity)).resolves.toEqual({
      favorite: false
    });
    await expect(service.delete(identity)).resolves.toEqual({
      favorite: false
    });
    expect(repository.delete).toHaveBeenCalledTimes(2);
  });
});

function repositoryStub(
  overrides: Partial<FavoriteRepository> = {}
): FavoriteRepository {
  return {
    listPage: vi.fn(async () => []),
    add: vi.fn(async () => ({
      status: "ok" as const,
      favorite: { createdAt: new Date("2026-07-19T00:00:00.000Z") }
    })),
    delete: vi.fn(async () => undefined),
    ...overrides
  };
}

function favoriteRecord(
  id: string,
  songId: string,
  createdAt: string
): FavoriteListRecord {
  return {
    id,
    songId,
    createdAt: new Date(createdAt),
    song: {
      id: songId,
      originalLanguage: "ja",
      canonicalTitle: `Canonical ${songId}`,
      displayTitle: `Display ${songId}`,
      canonicalArtist: "Artist",
      releaseYear: 2026,
      tieIn: "Anime",
      karaokeEntries: [
        {
          id: `entry-${songId}`,
          providerId: "provider-a",
          karaokeNumber: "12345",
          versionInfo: "",
          availabilityStatus: "available",
          lastVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
          provider: {
            id: "provider-a",
            name: "Provider A",
            country: "KR",
            isActive: true,
            displayOrder: 1,
            isDefault: true,
            lastCatalogUpdatedAt: new Date("2026-06-01T00:00:00.000Z")
          }
        }
      ]
    }
  };
}
