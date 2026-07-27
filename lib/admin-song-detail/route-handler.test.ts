import { describe, expect, it, vi } from "vitest";

import { createAdminCatalogHandler } from "../admin-catalog/guard";
import {
  createAdminSongDetailGetHandler,
  createAdminSongDetailPatchHandler
} from "./route-handler";
import type { AdminSongDetailService } from "./service";

const ORIGIN = "https://knf.example";

describe("administrator song detail route handlers", () => {
  it("passes only the authenticated actor and validated song id to GET", async () => {
    const service = stubService();
    const response = await protectedGet(
      service,
      "song-a"
    )(new Request(`${ORIGIN}/api/admin/songs/song-a`));

    expect(response.status).toBe(200);
    expect(service.get).toHaveBeenCalledWith("admin-a", "song-a");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects invalid GET ids and query strings before repository work", async () => {
    for (const [songId, search] of [
      ["../secret", ""],
      ["song-a", "?include=entity"]
    ]) {
      const service = stubService();
      const response = await protectedGet(
        service,
        songId
      )(new Request(`${ORIGIN}/api/admin/songs/song-a${search}`));
      expect([400, 422]).toContain(response.status);
      expect(service.get).not.toHaveBeenCalled();
    }
  });

  it("accepts the exact aggregate PATCH contract", async () => {
    const service = stubService();
    const response = await protectedPatch(
      service,
      "song-a"
    )(patchRequest(validPatch()));

    expect(response.status).toBe(200);
    expect(service.update).toHaveBeenCalledWith(
      "admin-a",
      "song-a",
      expect.objectContaining({
        expected_updated_at: "2026-07-26T00:00:00.000Z",
        aliases: [expect.objectContaining({ id: "alias-a" })],
        karaoke_entries: [expect.objectContaining({ id: "entry-a" })]
      })
    );
  });

  it.each([
    [
      "non JSON",
      patchRequest(validPatch(), "text/plain"),
      415,
      "UNSUPPORTED_MEDIA_TYPE"
    ],
    [
      "unknown normalized field",
      patchRequest({
        ...validPatch(),
        normalized_canonical_title: "forged"
      }),
      422,
      "VALIDATION_ERROR"
    ],
    ["524289-byte body", boundaryRequest(524_289), 413, "PAYLOAD_TOO_LARGE"]
  ])(
    "rejects %s before starting the aggregate service",
    async (_name, request, status, code) => {
      const service = stubService();
      const response = await protectedPatch(service, "song-a")(request);

      expect(response.status).toBe(status);
      expect((await response.json()).error).toMatchObject({
        code,
        request_id: "detail-request-id"
      });
      expect(service.update).not.toHaveBeenCalled();
    }
  );
});

function protectedGet(service: ReturnType<typeof stubService>, songId: string) {
  return createAdminCatalogHandler(
    "song_detail_api",
    createAdminSongDetailGetHandler(service as AdminSongDetailService, songId),
    guardDependencies()
  );
}

function protectedPatch(
  service: ReturnType<typeof stubService>,
  songId: string
) {
  return createAdminCatalogHandler(
    "song_update_api",
    createAdminSongDetailPatchHandler(
      service as AdminSongDetailService,
      songId
    ),
    { ...guardDependencies(), requireJsonInCsrf: false }
  );
}

function guardDependencies() {
  return {
    requireSession: async () => ({ user: { id: "admin-a" } }),
    readActorRole: async () => "admin" as const,
    isCatalogEnabled: () => true,
    trustedOrigin: ORIGIN,
    generateRequestId: () => "detail-request-id",
    writeSafeLog: () => undefined
  };
}

function stubService() {
  return {
    get: vi.fn(async () => detail()),
    update: vi.fn(async () => ({
      detail: detail(),
      change_counts: {
        song_fields: 1,
        aliases_added: 0,
        aliases_updated: 0,
        aliases_deleted: 0,
        karaoke_entries_added: 0,
        karaoke_entries_updated: 0
      }
    }))
  };
}

function patchRequest(body: unknown, contentType = "application/json") {
  return new Request(`${ORIGIN}/api/admin/songs/song-a`, {
    method: "PATCH",
    headers: {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "x-knf-request": "1",
      "content-type": contentType
    },
    body: JSON.stringify(body)
  });
}

function boundaryRequest(byteLength: number) {
  return new Request(`${ORIGIN}/api/admin/songs/song-a`, {
    method: "PATCH",
    headers: {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "x-knf-request": "1",
      "content-type": "application/json",
      "content-length": "1"
    },
    body: `"${"a".repeat(byteLength - 2)}"`
  });
}

function validPatch() {
  return {
    expected_updated_at: "2026-07-26T00:00:00.000Z",
    song: {
      original_language: "ja",
      canonical_title: "Lemon",
      display_title: "레몬",
      canonical_artist: "米津玄師",
      release_year: 2018,
      tie_in: null
    },
    aliases: [
      {
        id: "alias-a",
        alias: "Lemon OST",
        language: "en",
        alias_type: "translated_title"
      }
    ],
    karaoke_entries: [
      {
        id: "entry-a",
        provider_id: "tj",
        karaoke_number: "28822",
        version_info: "",
        availability_status: "available"
      }
    ],
    possible_duplicate_acknowledged_song_ids: []
  };
}

function detail() {
  return {
    song: {
      id: "song-a",
      original_language: "ja",
      canonical_title: "Lemon",
      display_title: "레몬",
      canonical_artist: "米津玄師",
      release_year: 2018,
      tie_in: null,
      source_name: "Official",
      source_url: null,
      verification_note: null,
      updated_at: "2026-07-26T00:00:00.000Z"
    },
    system_aliases: [],
    aliases: [],
    karaoke_entries: [],
    limits: { aliases: 30, karaoke_entries: 20 }
  };
}
