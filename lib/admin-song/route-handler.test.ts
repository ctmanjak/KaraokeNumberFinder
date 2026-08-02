import { describe, expect, it, vi } from "vitest";

import { createPersonalizationHandler } from "../personalization";
import {
  createAdminSongListHandler,
  createAdminSongOptionsHandler,
  createAdminSongPostHandler
} from "./route-handler";
import {
  AdminSongRepositoryError,
  type AdminSongRepository
} from "./repository";
import { createAdminSongService, type AdminSongService } from "./service";
import {
  ADMIN_AVAILABILITY_STATUSES,
  ADMIN_EDITABLE_ALIAS_TYPES,
  ADMIN_SONG_POST_BODY_LIMIT_BYTES
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

  it("preserves the safe candidate DTO in a final create conflict response", async () => {
    const candidate = {
      id: "song-candidate",
      display_title: "레몬",
      canonical_title: "Lemon",
      canonical_artist: "米津玄師",
      original_language: "ja",
      release_year: 2018,
      tie_in: null,
      provider_summary: [
        {
          provider_id: "tj",
          provider_name: "TJ",
          karaoke_number: "28822",
          version_info: ""
        }
      ],
      match_evidence: [
        {
          role: "title",
          strength: "exact",
          input_field: "canonical_title",
          candidate_field: "song.canonical_title",
          matched_value: "Lemon"
        }
      ],
      admin_path: "/admin/songs/song-candidate"
    } as const;
    const repository: AdminSongRepository = {
      getOptions: vi.fn(async () => []),
      list: vi.fn(async () => ({ items: [], nextCursorKey: null })),
      create: vi.fn(async () => {
        throw new AdminSongRepositoryError(
          "POSSIBLE_DUPLICATE_CONFIRMATION_REQUIRED",
          [candidate]
        );
      })
    };
    const response = await protectedHandler(
      createAdminSongPostHandler(createAdminSongService(repository))
    )(mutationRequest(validInput()));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({
      error: {
        code: "POSSIBLE_DUPLICATE_CONFIRMATION_REQUIRED"
      }
    });
    expect(body.error.details.candidates).toEqual([candidate]);
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

  it("enforces the 524288/524289 actual UTF-8 byte boundary before validation", async () => {
    const service = stubService();
    const exactBody = JSON.stringify(
      "a".repeat(ADMIN_SONG_POST_BODY_LIMIT_BYTES - 2)
    );
    const overBody = `${exactBody} `;

    const exact = await protectedHandler(createAdminSongPostHandler(service))(
      rawMutationRequest(exactBody)
    );
    expect(exact.status).toBe(422);

    const over = await protectedHandler(createAdminSongPostHandler(service))(
      rawMutationRequest(overBody)
    );
    expect(over.status).toBe(413);
    expect((await over.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(service.create).not.toHaveBeenCalled();
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
      karaoke_entry_count: 1,
      created_counts: {
        songs: 1,
        administrator_aliases: 1,
        karaoke_entries: 1
      }
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

function rawMutationRequest(body: string) {
  return new Request(`${ORIGIN}/api/admin/songs`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-knf-request": "1"
    },
    body
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
    aliases: [],
    karaoke_entries: [
      {
        provider_id: "tj",
        karaoke_number: "28822",
        version_info: "",
        availability_status: "available",
        last_verified_at: "2026-07-22",
        source_name: "TJ",
        source_url: null,
        verification_note: null
      }
    ]
  };
}
