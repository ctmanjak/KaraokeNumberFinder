import { describe, expect, it, vi } from "vitest";

import {
  createPersonalizationHandler,
  personalizationDomainError
} from "../personalization";
import {
  createFavoriteDeleteHandler,
  createFavoritePutHandler,
  createFavoritesGetHandler,
  parseFavoriteListQuery
} from "./route-handler";
import type { FavoriteService } from "./service";

const ORIGIN = "https://knf.example";
const REQUEST_ID = "favorite-request-id";

describe("favorite route handlers", () => {
  it("uses defaults and only the authenticated user for list ownership", async () => {
    const service = serviceStub();
    const handler = protectedHandler(createFavoritesGetHandler(service));
    const response = await handler(
      new Request(`${ORIGIN}/api/favorites?cursor=&limit=`)
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(service.list).toHaveBeenCalledWith(
      { userId: "authenticated-user" },
      { limit: 20 }
    );
  });

  it.each(["0", "51", "1.5", "NaN"])(
    "rejects invalid limit %s",
    async (limit) => {
      const service = serviceStub();
      const handler = protectedHandler(createFavoritesGetHandler(service));
      const response = await handler(
        new Request(`${ORIGIN}/api/favorites?limit=${limit}`)
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "INVALID_REQUEST", request_id: REQUEST_ID }
      });
      expect(service.list).not.toHaveBeenCalled();
    }
  );

  it("rejects user IDs and unknown list query input", async () => {
    expect(() =>
      parseFavoriteListQuery(new URLSearchParams("user_id=another-user"))
    ).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it("allows same-origin PUT and DELETE with path-only song identity", async () => {
    const service = serviceStub();
    const put = protectedHandler(createFavoritePutHandler(service));
    const remove = protectedHandler(createFavoriteDeleteHandler(service));

    const putResponse = await put(mutationRequest("PUT", "song_ja_0001"));
    const deleteResponse = await remove(
      mutationRequest("DELETE", "song_ja_0001")
    );

    expect(putResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(service.add).toHaveBeenCalledWith({
      userId: "authenticated-user",
      songId: "song_ja_0001"
    });
    expect(service.delete).toHaveBeenCalledWith({
      userId: "authenticated-user",
      songId: "song_ja_0001"
    });
  });

  it("never accepts a user ID from mutation query or body", async () => {
    const service = serviceStub();
    const handler = protectedHandler(createFavoritePutHandler(service));
    const response = await handler(
      new Request(`${ORIGIN}/api/favorites/song_ja_0001?user_id=another-user`, {
        method: "PUT",
        headers: {
          origin: ORIGIN,
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
          "x-knf-request": "1"
        },
        body: JSON.stringify({
          user_id: "another-user",
          email: "singer@example.com"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(service.add).toHaveBeenCalledWith({
      userId: "authenticated-user",
      songId: "song_ja_0001"
    });
  });

  it("uses the common envelope for SONG_NOT_FOUND", async () => {
    const service = serviceStub({
      add: vi.fn(async () => {
        throw personalizationDomainError({
          code: "SONG_NOT_FOUND",
          status: 404,
          publicMessage: "Song was not found."
        });
      })
    });
    const response = await protectedHandler(createFavoritePutHandler(service))(
      mutationRequest("PUT", "missing")
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "SONG_NOT_FOUND",
        message: "Song was not found.",
        request_id: REQUEST_ID
      }
    });
  });

  it("maps an invalid song path to VALIDATION_ERROR", async () => {
    const service = serviceStub();
    const response = await protectedHandler(createFavoritePutHandler(service))(
      mutationRequest("PUT", "nested%2Fsong")
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" }
    });
    expect(service.add).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong origin", { origin: "https://evil.example", "x-knf-request": "1" }],
    ["wrong marker", { origin: ORIGIN, "x-knf-request": "0" }]
  ])("rejects %s before the favorite domain", async (_name, headers) => {
    const service = serviceStub();
    const handler = protectedHandler(createFavoritePutHandler(service));
    const response = await handler(
      mutationRequest("PUT", "song_ja_0001", headers)
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      error: { code: "CSRF_REJECTED" }
    });
    expect(service.add).not.toHaveBeenCalled();
  });

  it("maps repository failures to a safe no-store response and safe log", async () => {
    const secretValues = [
      "oauth-token-secret",
      "raw-cookie-secret",
      "singer@example.com",
      "raw-request-body",
      "postgres-password"
    ];
    const service = serviceStub({
      add: vi.fn(async () => {
        throw new Error(secretValues[4]);
      })
    });
    const events: unknown[] = [];
    const handler = createPersonalizationHandler(
      createFavoritePutHandler(service),
      {
        requireSession: async () => ({ user: { id: "authenticated-user" } }),
        trustedOrigin: ORIGIN,
        generateRequestId: () => REQUEST_ID,
        writeSafeLog: (event) => events.push(event)
      }
    );
    const response = await handler(
      new Request(`${ORIGIN}/api/favorites/song_ja_0001`, {
        method: "PUT",
        headers: {
          origin: ORIGIN,
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
          "x-knf-request": "1",
          cookie: `knf.session=${secretValues[1]}`,
          authorization: `Bearer ${secretValues[0]}`
        },
        body: JSON.stringify({
          email: secretValues[2],
          note: secretValues[3]
        })
      })
    );
    const responseText = await response.text();
    const serializedEvents = JSON.stringify(events);

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(responseText).toContain("PERSONALIZATION_UNAVAILABLE");
    expect(events).toEqual([
      {
        event: "personalization_api_failure",
        code: "PERSONALIZATION_UNAVAILABLE",
        request_id: REQUEST_ID,
        status: 500
      }
    ]);
    for (const secret of secretValues) {
      expect(responseText).not.toContain(secret);
      expect(serializedEvents).not.toContain(secret);
    }
  });
});

function protectedHandler(
  handler: Parameters<typeof createPersonalizationHandler>[0]
) {
  return createPersonalizationHandler(handler, {
    requireSession: async () => ({ user: { id: "authenticated-user" } }),
    trustedOrigin: ORIGIN,
    generateRequestId: () => REQUEST_ID,
    writeSafeLog: () => undefined
  });
}

function mutationRequest(
  method: "PUT" | "DELETE",
  songId: string,
  overrides: Record<string, string> = {}
): Request {
  return new Request(`${ORIGIN}/api/favorites/${songId}`, {
    method,
    headers: {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-knf-request": "1",
      ...overrides
    }
  });
}

function serviceStub(
  overrides: Partial<FavoriteService> = {}
): FavoriteService {
  return {
    list: vi.fn(async () => ({ items: [], next_cursor: null })),
    add: vi.fn(async () => ({
      favorite: true as const,
      created_at: "2026-07-19T00:00:00.000Z"
    })),
    delete: vi.fn(async () => ({ favorite: false as const })),
    ...overrides
  };
}
