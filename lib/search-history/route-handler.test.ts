import { describe, expect, it, vi } from "vitest";

import {
  createPersonalizationHandler,
  personalizationError,
  type RequireSession
} from "../personalization";
import {
  createSearchHistoryDeleteAllHandler,
  createSearchHistoryDeleteOneHandler,
  createSearchHistoryGetHandler,
  createSearchHistoryPostHandler
} from "./route-handler";
import type { SearchHistoryService } from "./service";

const ORIGIN = "https://knf.example";
const REQUEST_ID = "search-history-request-id";
const ITEM_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

describe("search history route handlers", () => {
  it("lists only the authenticated user's history without pagination", async () => {
    const service = serviceStub();
    const response = await protectedHandler(
      createSearchHistoryGetHandler(service)
    )(new Request(`${ORIGIN}/api/search-history`));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(service.list).toHaveBeenCalledWith({
      userId: "authenticated-user"
    });

    const invalid = await protectedHandler(
      createSearchHistoryGetHandler(service)
    )(new Request(`${ORIGIN}/api/search-history?limit=10`));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" }
    });
  });

  it("accepts a same-origin POST with query as the only body field", async () => {
    const service = serviceStub();
    const response = await protectedHandler(
      createSearchHistoryPostHandler(service)
    )(mutationRequest("/api/search-history", "POST", '{"query":"  Hello  "}'));

    expect(response.status).toBe(200);
    expect(service.save).toHaveBeenCalledWith({
      userId: "authenticated-user",
      query: "  Hello  "
    });
  });

  it("separates malformed JSON from invalid and reserved body fields", async () => {
    for (const [body, status, code] of [
      ["{", 400, "INVALID_REQUEST"],
      ['{"query":42}', 422, "VALIDATION_ERROR"],
      ['{"query":"hello","user_id":"other-user"}', 422, "VALIDATION_ERROR"],
      [
        '{"query":"hello","normalized_query":"attacker-value"}',
        422,
        "VALIDATION_ERROR"
      ],
      ['{"query":"hello","searched_at":"2000-01-01"}', 422, "VALIDATION_ERROR"]
    ] as const) {
      const service = serviceStub();
      const response = await protectedHandler(
        createSearchHistoryPostHandler(service)
      )(mutationRequest("/api/search-history", "POST", body));

      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
      expect(service.save).not.toHaveBeenCalled();
    }
  });

  it("uses owner-scoped idempotent individual and bulk deletion", async () => {
    const service = serviceStub({
      delete: vi.fn(async () => ({ deleted_count: 0 })),
      clear: vi.fn(async () => ({ deleted_count: 3 }))
    });
    const deleteOne = await protectedHandler(
      createSearchHistoryDeleteOneHandler(service)
    )(mutationRequest(`/api/search-history/${ITEM_ID}`, "DELETE"));
    const deleteAll = await protectedHandler(
      createSearchHistoryDeleteAllHandler(service)
    )(mutationRequest("/api/search-history", "DELETE"));

    expect(await deleteOne.json()).toEqual({ deleted_count: 0 });
    expect(await deleteAll.json()).toEqual({ deleted_count: 3 });
    expect(service.delete).toHaveBeenCalledWith({
      userId: "authenticated-user",
      id: ITEM_ID
    });
    expect(service.clear).toHaveBeenCalledWith({
      userId: "authenticated-user"
    });
  });

  it.each([
    "not-a-uuid",
    "nested%2Fid",
    "00000000-0000-0000-0000-000000000000"
  ])("maps invalid item id %s to VALIDATION_ERROR", async (id) => {
    const service = serviceStub();
    const response = await protectedHandler(
      createSearchHistoryDeleteOneHandler(service)
    )(mutationRequest(`/api/search-history/${id}`, "DELETE"));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" }
    });
    expect(service.delete).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong origin", { origin: "https://evil.example", "x-knf-request": "1" }],
    ["wrong marker", { origin: ORIGIN, "x-knf-request": "0" }]
  ])(
    "rejects %s before session, parsing, normalization, or DB",
    async (_name, headers) => {
      const service = serviceStub();
      const requireSession = vi.fn(async () => ({
        user: { id: "authenticated-user" }
      }));
      const response = await protectedHandler(
        createSearchHistoryPostHandler(service),
        requireSession
      )(
        mutationRequest(
          "/api/search-history",
          "POST",
          '{"query":"raw secret query"}',
          headers
        )
      );

      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({
        error: { code: "CSRF_REJECTED" }
      });
      expect(requireSession).not.toHaveBeenCalled();
      expect(service.save).not.toHaveBeenCalled();
    }
  );

  it.each(["missing", "forged", "expired", "revoked"])(
    "returns the shared 401 contract for a %s session",
    async () => {
      const service = serviceStub();
      const response = await protectedHandler(
        createSearchHistoryGetHandler(service),
        async () => {
          throw personalizationError("UNAUTHENTICATED");
        }
      )(new Request(`${ORIGIN}/api/search-history`));

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Session");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(service.list).not.toHaveBeenCalled();
    }
  );

  it("maps repository failures to a safe response and safe log", async () => {
    const secrets = [
      "raw search query",
      "normalized-secret-query",
      "session-cookie-secret",
      "oauth-token-secret",
      "singer@example.com",
      "SQLSTATE 40001 database detail"
    ];
    const events: unknown[] = [];
    const service = serviceStub({
      save: vi.fn(async () => {
        throw new Error(secrets[5]);
      })
    });
    const handler = createPersonalizationHandler(
      createSearchHistoryPostHandler(service),
      {
        requireSession: async () => ({ user: { id: "authenticated-user" } }),
        trustedOrigin: ORIGIN,
        generateRequestId: () => REQUEST_ID,
        writeSafeLog: (event) => events.push(event)
      }
    );
    const response = await handler(
      mutationRequest(
        "/api/search-history",
        "POST",
        JSON.stringify({ query: secrets[0] }),
        {
          cookie: `knf.session=${secrets[2]}`,
          authorization: `Bearer ${secrets[3]}`,
          "x-user-email": secrets[4]
        }
      )
    );
    const responseText = await response.text();
    const logText = JSON.stringify(events);

    expect(response.status).toBe(500);
    expect(responseText).toContain("PERSONALIZATION_UNAVAILABLE");
    expect(events).toEqual([
      {
        event: "personalization_api_failure",
        code: "PERSONALIZATION_UNAVAILABLE",
        request_id: REQUEST_ID,
        status: 500
      }
    ]);
    for (const secret of secrets) {
      expect(responseText).not.toContain(secret);
      expect(logText).not.toContain(secret);
    }
  });
});

function protectedHandler(
  handler: Parameters<typeof createPersonalizationHandler>[0],
  requireSession: RequireSession = async () => ({
    user: { id: "authenticated-user" }
  })
) {
  return createPersonalizationHandler(handler, {
    requireSession,
    trustedOrigin: ORIGIN,
    generateRequestId: () => REQUEST_ID,
    writeSafeLog: () => undefined
  });
}

function mutationRequest(
  path: string,
  method: "POST" | "DELETE",
  body?: string,
  overrides: Record<string, string> = {}
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-knf-request": "1",
      ...overrides
    },
    ...(body === undefined ? {} : { body })
  });
}

function serviceStub(
  overrides: Partial<SearchHistoryService> = {}
): SearchHistoryService {
  return {
    list: vi.fn(async () => ({ items: [] })),
    save: vi.fn(async () => ({
      item: {
        id: ITEM_ID,
        query: "Hello",
        normalized_query: "hello",
        searched_at: "2026-07-19T00:00:00.000Z"
      }
    })),
    delete: vi.fn(async () => ({ deleted_count: 0 })),
    clear: vi.fn(async () => ({ deleted_count: 0 })),
    ...overrides
  };
}
