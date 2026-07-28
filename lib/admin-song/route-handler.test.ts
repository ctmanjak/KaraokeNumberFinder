import { describe, expect, it, vi } from "vitest";

import { createPersonalizationHandler } from "../personalization";
import {
  createAdminSongListHandler,
  createAdminSongOptionsHandler,
  createAdminSongPostHandler
} from "./route-handler";
import type { AdminSongService } from "./service";
import {
  ADMIN_AVAILABILITY_STATUSES,
  ADMIN_EDITABLE_ALIAS_TYPES
} from "./types";

const ORIGIN = "https://knf.example";

describe("admin song route handlers", () => {
  it("uses only the authenticated identity for options", async () => {
    const service = stubService();
    const response = await protectedHandler(
      createAdminSongOptionsHandler(service)
    )(new Request(`${ORIGIN}/api/admin/songs/options`));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(service.getOptions).toHaveBeenCalledWith("authenticated-user");
  });

  it("parses list search and returns the explicit list response", async () => {
    const service = stubService();
    const response = await protectedHandler(
      createAdminSongListHandler(service)
    )(new Request(`${ORIGIN}/api/admin/songs?query=%EF%BC%A1-B&limit=50`));

    expect(response.status).toBe(200);
    expect(service.list).toHaveBeenCalledWith(
      "authenticated-user",
      expect.objectContaining({
        query: "Ａ-B",
        normalizedQuery: "ab",
        limit: 50
      })
    );
    expect(await response.json()).toEqual({ items: [], next_cursor: null });
  });

  it.each([
    "?limit=0",
    "?limit=51",
    "?cursor=invalid",
    "?query=!!!",
    "?unknown=value"
  ])("returns the standard validation envelope for %s", async (search) => {
    const service = stubService();
    const response = await protectedHandler(
      createAdminSongListHandler(service)
    )(new Request(`${ORIGIN}/api/admin/songs${search}`));

    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatchObject({
      code: "VALIDATION_ERROR",
      request_id: "admin-request-id"
    });
    expect(service.list).not.toHaveBeenCalled();
  });

  it("validates before creating and returns 201", async () => {
    const service = stubService();
    const response = await protectedHandler(
      createAdminSongPostHandler(service)
    )(mutationRequest(validInput()));

    expect(response.status).toBe(201);
    expect(service.create).toHaveBeenCalledWith(
      "authenticated-user",
      expect.objectContaining({ canonical_title: "Lemon" })
    );
  });

  it("rejects forged identity, invalid input, query parameters, and cross-origin writes", async () => {
    for (const request of [
      mutationRequest({ ...validInput(), user_id: "another-user" }),
      mutationRequest({ ...validInput(), karaoke_entries: [] }),
      mutationRequest(validInput(), `${ORIGIN}/api/admin/songs?user_id=other`),
      mutationRequest(
        validInput(),
        `${ORIGIN}/api/admin/songs`,
        "https://evil.example"
      )
    ]) {
      const service = stubService();
      const response = await protectedHandler(
        createAdminSongPostHandler(service)
      )(request);
      expect([403, 422, 400]).toContain(response.status);
      expect(service.create).not.toHaveBeenCalled();
    }
  });
});

function protectedHandler(
  handler: Parameters<typeof createPersonalizationHandler>[0]
) {
  return createPersonalizationHandler(handler, {
    requireSession: async () => ({ user: { id: "authenticated-user" } }),
    trustedOrigin: ORIGIN,
    generateRequestId: () => "admin-request-id",
    writeSafeLog: () => undefined
  });
}

function stubService(): AdminSongService {
  return {
    getOptions: vi.fn(async () => ({
      alias_types: ADMIN_EDITABLE_ALIAS_TYPES,
      availability_statuses: ADMIN_AVAILABILITY_STATUSES,
      providers: [{ id: "tj", name: "TJ", country: "KR" }]
    })),
    list: vi.fn(async () => ({ items: [], next_cursor: null })),
    create: vi.fn(async () => ({
      song: {
        id: "song-a",
        display_title: "레몬",
        canonical_artist: "米津玄師"
      },
      alias_count: 4,
      karaoke_entry_count: 1
    }))
  };
}

function mutationRequest(
  body: unknown,
  url = `${ORIGIN}/api/admin/songs`,
  origin = ORIGIN
) {
  return new Request(url, {
    method: "POST",
    headers: {
      origin,
      "sec-fetch-site": origin === ORIGIN ? "same-origin" : "cross-site",
      "content-type": "application/json",
      "x-knf-request": "1"
    },
    body: JSON.stringify(body)
  });
}

function validInput() {
  return {
    original_language: "ja",
    canonical_title: "Lemon",
    display_title: "레몬",
    canonical_artist: "米津玄師",
    release_year: 2018,
    tie_in: null,
    source_url: "https://example.com",
    source_name: "Official",
    verification_note: null,
    aliases: [],
    karaoke_entries: [
      {
        provider_id: "tj",
        karaoke_number: "28822",
        version_info: "",
        availability_status: "available",
        last_verified_at: null
      }
    ]
  };
}
