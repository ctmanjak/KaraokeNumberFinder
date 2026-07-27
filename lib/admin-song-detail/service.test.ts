import { describe, expect, it, vi } from "vitest";

import {
  AdminSongDetailRepositoryError,
  type AdminSongDetailRepository
} from "./repository";
import { createAdminSongDetailService } from "./service";

describe("administrator song detail service", () => {
  it.each([
    ["NOT_FOUND", 404, "SONG_NOT_FOUND"],
    ["STALE", 409, "STALE_SONG"],
    ["DUPLICATE_SONG", 409, "DUPLICATE_SONG"],
    [
      "POSSIBLE_DUPLICATE_CONFIRMATION_REQUIRED",
      409,
      "POSSIBLE_DUPLICATE_CONFIRMATION_REQUIRED"
    ],
    ["PROVIDER_NOT_FOUND", 422, "PROVIDER_NOT_FOUND"],
    ["TIMEOUT", 503, "DUPLICATE_CHECK_UNAVAILABLE"],
    ["SYSTEM_ALIAS_INVARIANT", 409, "CATALOG_INVARIANT_VIOLATION"],
    ["CONFLICT", 409, "SONG_CONFLICT"]
  ] as const)(
    "maps repository %s without leaking internals",
    async (repositoryCode, status, publicCode) => {
      const repository = stubRepository();
      repository.get.mockRejectedValueOnce(
        new AdminSongDetailRepositoryError(repositoryCode)
      );
      const service = createAdminSongDetailService(
        repository as AdminSongDetailRepository
      );

      await expect(service.get("admin-a", "song-a")).rejects.toMatchObject({
        code: publicCode,
        status
      });
    }
  );

  it("returns only the safe duplicate candidate projection in conflict details", async () => {
    const repository = stubRepository();
    repository.update.mockRejectedValueOnce(
      new AdminSongDetailRepositoryError("DUPLICATE_SONG", [
        {
          id: "song-b",
          display_title: "Candidate",
          canonical_title: "Candidate",
          canonical_artist: "Artist",
          original_language: "en",
          release_year: null,
          tie_in: null,
          provider_summary: [],
          match_evidence: [],
          admin_path: "/admin/songs/song-b"
        }
      ])
    );
    const service = createAdminSongDetailService(
      repository as AdminSongDetailRepository
    );

    await expect(
      service.update("admin-a", "song-a", {} as never)
    ).rejects.toMatchObject({
      code: "DUPLICATE_SONG",
      details: { candidates: [{ id: "song-b" }] }
    });
  });
});

function stubRepository() {
  return {
    get: vi.fn(),
    update: vi.fn()
  };
}
